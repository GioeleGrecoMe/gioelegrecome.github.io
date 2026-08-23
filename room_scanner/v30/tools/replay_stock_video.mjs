#!/usr/bin/env node
/**
 * Replay a real video through the exact V30 Alva frontend + SlamEngine cadence.
 *
 * This deliberately stops before RGB/MVS/Deep: if tracking/keyframe authority
 * already collapses here, later reconstruction stages cannot repair it.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {AlvaAR} from '../vendor/alva_ar.js';
import {WasmVisionFrontend} from '../js/slam/wasm_frontend.js';
import {SlamEngine} from '../js/slam/slam_engine.js';
import {CONFIG} from '../js/config.js';
import {StablePhotoBank} from '../js/reconstruction/stable_photo_bank.js';
import {buildUnifiedPostScanKeyframePlan} from '../js/reconstruction/postscan_mvs_plan.js';
import {buildSparseDepthAnchors} from '../js/dense/sparse_depth_anchors.js';

const [videoPath,fpsArg=String(CONFIG.analysisFps||8),fovArg=String(CONFIG.cameraFovDeg||62),maxFramesArg='1200']=process.argv.slice(2);
if(!videoPath||!fs.existsSync(videoPath)){
  console.error('Usage: node tools/replay_stock_video.mjs <video> [fps=8] [fovDeg=62] [maxFrames=1200]');
  process.exit(2);
}

const W=CONFIG.analysisWidth||320,H=CONFIG.analysisHeight||480,fps=Math.max(1,Number(fpsArg)||8),fovDeg=Math.max(20,Math.min(100,Number(fovArg)||62)),maxFrames=Math.max(1,Number(maxFramesArg)||1200),tracker=await AlvaAR.Initialize(W,H,fovDeg),frontend=new WasmVisionFrontend({alva:tracker});
await frontend.init({width:W,height:H,fovDeg,requireAlva:true});frontend.beginTrackingEpoch({reason:'stock-replay'});
const K={fx:W/(2*Math.tan(fovDeg*Math.PI/360)),fy:W/(2*Math.tan(fovDeg*Math.PI/360)),cx:W/2,cy:H/2,width:W,height:H},slam=new SlamEngine({frontend,K,keyframeIntervalMs:CONFIG.keyframeIntervalMs||900,observationIntervalMs:CONFIG.alvaObservationIntervalMs||900,maxObservations:CONFIG.alvaHeartbeatBufferFrames||8}),photoBank=new StablePhotoBank({maxFrames:CONFIG.sharpArchiveMaxFrames||1600,maxBytes:CONFIG.sharpArchiveMaxBytes||367001600,minIntervalMs:CONFIG.sharpArchiveMinIntervalMs||110,maxSide:Math.max(W,H),maxTranslationSpeedMetric:CONFIG.sharpArchiveMaxTranslationSpeedMetric||.34,maxTranslationSpeedAlva:CONFIG.sharpArchiveMaxTranslationSpeedAlva||.52,maxAngularSpeedRad:CONFIG.sharpArchiveMaxAngularSpeedRad||.72,minDetail:CONFIG.sharpArchiveMinDetail||4.2,jumpTranslation:CONFIG.sharpArchiveJumpTranslation||.8,jumpRotationRad:CONFIG.sharpArchiveJumpRotationRad||.78,jumpWindowMs:CONFIG.sharpArchiveJumpWindowMs||2200});

const vf=`fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-i',videoPath,'-vf',vf,'-an','-sn','-dn','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{stdio:['ignore','pipe','pipe']}),errors=[];
ff.stderr.on('data',d=>errors.push(String(d)));
const frameBytes=W*H*4,rows=[];let pending=Buffer.alloc(0),stoppedEarly=false;
for await(const chunk of ff.stdout){
  pending=Buffer.concat([pending,chunk]);
  while(pending.length>=frameBytes){
    const raw=pending.subarray(0,frameBytes);pending=pending.subarray(frameBytes);const rgba=new Uint8ClampedArray(raw.buffer,raw.byteOffset,raw.byteLength),gray=new Uint8Array(W*H);
    for(let i=0;i<gray.length;i++)gray[i]=(rgba[i*4]*77+rgba[i*4+1]*150+rgba[i*4+2]*29)>>8;
    const index=rows.length,at=index*1000/fps,frame={frameId:`stock-${index}`,captureSeq:index,at,width:W,height:H,rgba,gray,imageData:{data:rgba,width:W,height:H}},result=slam.process(frame);
    const archived=photoBank.consider(frame,{...result,pose:result.rawPose},K,{metricLocked:false});
    rows.push({index,at,trackingValid:result.trackingValid,trackingMode:result.trackingMode,pose:result.rawPose,framePoints:result.alvaPoints||0,features:result.features||0,matches:result.matches||0,newKeyframe:!!result.newKeyframe});
    if(rows.length>=maxFrames){stoppedEarly=true;ff.kill('SIGTERM');break;}
  }
  if(stoppedEarly)break;
}
const exitCode=await new Promise(resolve=>{if(ff.exitCode!==null||ff.signalCode!==null)resolve(ff.exitCode??0);else ff.once('close',code=>resolve(code??0));});
if(!stoppedEarly&&exitCode!==0)throw new Error(`ffmpeg failed (${exitCode}): ${errors.join('').trim()}`);

const valid=rows.filter(r=>r.trackingValid),keyframes=rows.filter(r=>r.newKeyframe),pointCounts=rows.map(r=>r.framePoints),steps=[];
for(let i=1;i<valid.length;i++){const a=valid[i-1],b=valid[i];if(b.index-a.index>1)continue;steps.push({translation:Math.hypot(b.pose.p[0]-a.pose.p[0],b.pose.p[1]-a.pose.p[1],b.pose.p[2]-a.pose.p[2]),rotation:quatAngle(a.pose.q,b.pose.q)});}
const runs=booleanRuns(rows.map(r=>r.trackingValid)),validRuns=runs.filter(r=>r.value),lostRuns=runs.filter(r=>!r.value),archive=photoBank.exportState(),plan=buildUnifiedPostScanKeyframePlan(archive.frames,{maxJobs:CONFIG.postScanClosureKeyframes||28,minSources:CONFIG.postScanArchiveMvsMinSources||2,maxSources:CONFIG.postScanMvsSourcePool||4,minBaseline:CONFIG.denseMinBaselineAlva||.014,maxBaseline:CONFIG.denseMaxBaselineAlva||1.5,maxAngleRad:CONFIG.denseMaxViewAngleRad||.38}),anchorRows=[];
for(const job of plan.jobs||[]){const sparse=buildSparseDepthAnchors(job.ref,job.sources||[],{maxReprojectionPx:CONFIG.denseSeedMaxReprojectionPx||2.8,minAngleRad:CONFIG.denseSeedMinAngleRad||.006,maxGapBaselineRatio:CONFIG.denseSeedMaxGapBaselineRatio||.14});anchorRows.push({frameId:job.ref?.frameId,sources:job.sources?.length||0,seeds:sparse.seeds?.length||0,candidates:sparse.stats?.candidates||0,rejected:sparse.stats?.rejected||0,medianReprojectionPx:sparse.stats?.medianReprojectionPx??null,medianAngleDeg:sparse.stats?.medianAngleDeg??null});}
const summary={video:videoPath,raster:[W,H],fps,fovDeg,frames:rows.length,validPoses:valid.length,poseRatio:valid.length/Math.max(1,rows.length),firstPoseFrame:valid[0]?.index??-1,lastPoseFrame:valid.at(-1)?.index??-1,keyframes:keyframes.length,keyframeIndices:keyframes.map(r=>r.index),validRuns:validRuns.length,longestValidRun:Math.max(0,...validRuns.map(r=>r.length)),lostRuns:lostRuns.length,longestLostRun:Math.max(0,...lostRuns.map(r=>r.length)),medianFramePoints:quantile(pointCounts,.5),p10FramePoints:quantile(pointCounts,.1),medianConsecutiveTranslation:quantile(steps.map(x=>x.translation),.5),p90ConsecutiveTranslation:quantile(steps.map(x=>x.translation),.9),maxConsecutiveTranslation:Math.max(0,...steps.map(x=>x.translation)),medianConsecutiveRotationRad:quantile(steps.map(x=>x.rotation),.5),p90ConsecutiveRotationRad:quantile(steps.map(x=>x.rotation),.9),photoArchive:archive.stats,unifiedPlanner:{inputFrames:archive.frames.length,jobs:plan.jobs?.length||0,rejected:plan.rejected?.length||0,reasons:countBy((plan.rejected||[]).map(x=>x.reason||'unknown'))},sparseAnchors:{jobs:anchorRows.length,totalSeeds:anchorRows.reduce((n,x)=>n+x.seeds,0),jobsWithSeeds:anchorRows.filter(x=>x.seeds>0).length,medianSeedsPerJob:quantile(anchorRows.map(x=>x.seeds),.5),maxSeedsPerJob:Math.max(0,...anchorRows.map(x=>x.seeds)),details:anchorRows}};
console.log(JSON.stringify(summary,null,2));

function quatAngle(a,b){const d=Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]);return 2*Math.acos(Math.max(-1,Math.min(1,d)));}
function quantile(xs,q){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;return a[Math.min(a.length-1,Math.max(0,Math.floor(q*(a.length-1))))];}
function booleanRuns(values){const out=[];for(let i=0;i<values.length;){let j=i+1;while(j<values.length&&values[j]===values[i])j++;out.push({value:values[i],start:i,end:j-1,length:j-i});i=j;}return out;}
function countBy(values){const out={};for(const value of values)out[value]=(out[value]||0)+1;return out;}
