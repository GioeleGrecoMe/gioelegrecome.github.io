#!/usr/bin/env node
/**
 * Replay a real video through the exact V30 Alva frontend + SlamEngine cadence.
 *
 * It exercises the exact tracking path, RGB-first photo graph, unified MVS/Deep
 * planner, sparse triangulation and final RGB scaffold gate. It deliberately
 * stops before neural Deep inference and dense TSDF fusion.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {AlvaAR} from '../vendor/alva_ar.js';
import {WasmVisionFrontend} from '../js/slam/wasm_frontend.js';
import {SlamEngine} from '../js/slam/slam_engine.js';
import {CONFIG} from '../js/config.js';
import {StablePhotoBank} from '../js/reconstruction/stable_photo_bank.js';
import {buildUnifiedPostScanKeyframePlan} from '../js/reconstruction/postscan_mvs_plan.js';
import {buildSparseDepthAnchors} from '../js/dense/sparse_depth_anchors.js';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {SingleOptimizerRuntime} from '../js/probabilistic/single_optimizer_runtime.js';
import {LivePhotoPuzzleMap} from '../js/reconstruction/live_photo_puzzle.js';
import {selectGeometricPhotoSubset} from '../js/reconstruction/adaptive_deep_scheduler.js';

const [videoPath,fpsArg=String(CONFIG.analysisFps||8),fovArg=String(CONFIG.cameraFovDeg||62),maxFramesArg='1200',outputDirArg='']=process.argv.slice(2);
if(!videoPath||!fs.existsSync(videoPath)){
  console.error('Usage: node tools/replay_stock_video.mjs <video> [fps=8] [fovDeg=62] [maxFrames=1200] [outputDir]');
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
const runs=booleanRuns(rows.map(r=>r.trackingValid)),validRuns=runs.filter(r=>r.value),lostRuns=runs.filter(r=>!r.value),archive=photoBank.exportState(),eligibleFrames=archive.frames.filter(x=>!x.stability?.jumpSuspect),processingFrames=selectGeometricPhotoSubset(eligibleFrames,Math.max(16,Number(CONFIG.sharpArchiveProcessMaxFrames)||60)),photoMap=new LivePhotoPuzzleMap({width:CONFIG.livePuzzleAtlasWidth||640,height:CONFIG.livePuzzleAtlasHeight||320,maxFrames:CONFIG.livePuzzleMaxFrames||280,maxRenderFrames:CONFIG.livePuzzleRenderFrames||80,temporalRadius:CONFIG.livePuzzleTemporalRadius||4,maxLoopCandidates:CONFIG.livePuzzleLoopCandidates||2,minEdgeMatches:CONFIG.livePuzzleMinEdgeMatches||6,minEdgeProbability:CONFIG.livePuzzleMinEdgeProbability||.10,maxWorldSamples:CONFIG.livePuzzleWorldSamples||12000,photoMaxSide:CONFIG.livePuzzlePhotoMaxSide||256,depthMaxSide:CONFIG.livePuzzleDepthMaxSide||168,depthMinPairs:CONFIG.livePuzzleDepthMinPairs||6,depthRegularizeIterations:CONFIG.livePuzzleDepthRegularizeIterations||8,maxPhotoSamples:CONFIG.livePuzzleMaxPhotoSamples||260000,maxDepthSamples:CONFIG.livePuzzleMaxDepthSamples||190000});
for(const frame of processingFrames)photoMap.addDepthPlannedFrame(frame,{source:'stock-replay-rgb-first'});
const panorama=photoMap.exportState(),plan=buildUnifiedPostScanKeyframePlan(processingFrames,{maxJobs:CONFIG.postScanClosureKeyframes||28,minSources:CONFIG.postScanArchiveMvsMinSources||2,maxSources:CONFIG.postScanMvsSourcePool||4,minBaseline:CONFIG.denseMinBaselineAlva||.014,maxBaseline:CONFIG.denseMaxBaselineAlva||1.5,maxAngleRad:CONFIG.denseMaxViewAngleRad||.38}),anchorRows=[],graph=new ProbabilisticFactorGraph(),graphFrames=new Map(processingFrames.map(x=>[String(x.frameId),x]));
for(const index of keyframes.map(x=>x.index)){const frame=archive.frames.find(x=>String(x.frameId)===`stock-${index}`);if(frame)graphFrames.set(String(frame.frameId),frame);}
for(const frame of [...graphFrames.values()].sort((a,b)=>(Number(a.at)||0)-(Number(b.at)||0)))graph.addFrame(frame);
for(const job of plan.jobs||[]){const sparse=buildSparseDepthAnchors(job.ref,job.sources||[],{maxReprojectionPx:CONFIG.denseSeedMaxReprojectionPx||2.8,minAngleRad:CONFIG.denseSeedMinAngleRad||.006,maxGapBaselineRatio:CONFIG.denseSeedMaxGapBaselineRatio||.14});graph.addSparseAnchors(job.ref,sparse.seeds);anchorRows.push({frameId:job.ref?.frameId,sources:job.sources?.length||0,seeds:sparse.seeds?.length||0,matched:sparse.stats?.matched||0,triangulated:sparse.stats?.triangulated||0,medianReprojectionPx:sparse.stats?.medianReprojectionPx??null,medianAngleDeg:sparse.stats?.medianAngleDeg??null});}
graph.addPhotoEdges(panorama.edges||[]);
const graphBefore=graph.summary(),runtime=new SingleOptimizerRuntime(),rgb=await runtime.reconcileRgbScaffold(graph.exportState(),{passes:CONFIG.postScanRgbScaffoldPasses||18,globalLinePasses:CONFIG.postScanRgbGlobalLinePasses||36,optimizer:{localWindowSize:CONFIG.postOptimizeLocalWindowFrames||20,localWindowOverlap:CONFIG.postOptimizeLocalWindowOverlap||6}}),rgbSnapshot=rgb?.snapshot||null;
const summary={video:videoPath,raster:[W,H],fps,fovDeg,frames:rows.length,validPoses:valid.length,poseRatio:valid.length/Math.max(1,rows.length),firstPoseFrame:valid[0]?.index??-1,lastPoseFrame:valid.at(-1)?.index??-1,keyframes:keyframes.length,keyframeIndices:keyframes.map(r=>r.index),validRuns:validRuns.length,longestValidRun:Math.max(0,...validRuns.map(r=>r.length)),lostRuns:lostRuns.length,longestLostRun:Math.max(0,...lostRuns.map(r=>r.length)),medianFramePoints:quantile(pointCounts,.5),p10FramePoints:quantile(pointCounts,.1),medianConsecutiveTranslation:quantile(steps.map(x=>x.translation),.5),p90ConsecutiveTranslation:quantile(steps.map(x=>x.translation),.9),maxConsecutiveTranslation:Math.max(0,...steps.map(x=>x.translation)),medianConsecutiveRotationRad:quantile(steps.map(x=>x.rotation),.5),p90ConsecutiveRotationRad:quantile(steps.map(x=>x.rotation),.9),photoArchive:archive.stats,processingFrames:processingFrames.length,photoMosaic:panorama.stats,unifiedPlanner:{inputFrames:processingFrames.length,jobs:plan.jobs?.length||0,rejected:plan.rejected?.length||0,reasons:countBy((plan.rejected||[]).map(x=>x.reason||'unknown'))},sparseAnchors:{jobs:anchorRows.length,totalSeeds:anchorRows.reduce((n,x)=>n+x.seeds,0),jobsWithSeeds:anchorRows.filter(x=>x.seeds>0).length,medianSeedsPerJob:quantile(anchorRows.map(x=>x.seeds),.5),maxSeedsPerJob:Math.max(0,...anchorRows.map(x=>x.seeds)),details:anchorRows},rgbGraph:{before:graphBefore,accepted:!!rgb?.accepted,selection:rgb?.selection||'none',confirmedPoses:rgbSnapshot?.frames?.length||0,baselinePolicy:rgb?.baselinePolicy||null,candidatePolicy:rgb?.candidatePolicy||null,baselineStats:compactRgbStats(rgb?.baselineStats),candidateStats:compactRgbStats(rgb?.candidateStats),stats:compactRgbStats(rgb?.stats)}};
if(outputDirArg)summary.artifacts=exportArtifacts(path.resolve(outputDirArg),summary,photoMap,rgbSnapshot||{frames:[],landmarks:[]});
console.log(JSON.stringify(summary,null,2));

function quatAngle(a,b){const d=Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]);return 2*Math.acos(Math.max(-1,Math.min(1,d)));}
function quantile(xs,q){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;return a[Math.min(a.length-1,Math.max(0,Math.floor(q*(a.length-1))))];}
function booleanRuns(values){const out=[];for(let i=0;i<values.length;){let j=i+1;while(j<values.length&&values[j]===values[i])j++;out.push({value:values[i],start:i,end:j-1,length:j-i});i=j;}return out;}
function countBy(values){const out={};for(const value of values)out[value]=(out[value]||0)+1;return out;}
function compactRgbStats(s){return s?{iterations:s.iterations??null,reprojectionMedianPx:s.reprojectionMedianPx??null,reprojectionP90Px:s.reprojectionP90Px??null,reprojectionValidatedP90Px:s.reprojectionValidatedP90Px??null,reprojectionInlierFraction4px:s.reprojectionInlierFraction4px??null,reprojectionRobustRmse:s.reprojectionRobustRmse??null,rgbConsensusCommitReady:s.rgbConsensusCommitReady??null,rgbConsensusCollapsed:s.rgbConsensusCollapsed??null,edgeSwitches:s.edgeSwitches||null,alvaSwitches:s.alvaSwitches||null}:null;}

function exportArtifacts(dir,summary,photoMap,snapshot){
  fs.mkdirSync(dir,{recursive:true});
  const mosaic=photoMap.renderPhotoAtlas(),pngPath=path.join(dir,'rgb-mosaic.png'),plyPath=path.join(dir,'rgb-sparse-cloud.ply'),svgPath=path.join(dir,'rgb-scaffold-report.svg'),jsonPath=path.join(dir,'result.json');
  fs.writeFileSync(pngPath,encodePng(mosaic.width,mosaic.height,mosaic.rgba));
  fs.writeFileSync(plyPath,makePly(snapshot));
  fs.writeFileSync(svgPath,makeScaffoldSvg(summary,snapshot));
  const artifacts={resultJson:jsonPath,rgbMosaicPng:pngPath,rgbSparseCloudPly:plyPath,rgbScaffoldSvg:svgPath};fs.writeFileSync(jsonPath,JSON.stringify({...summary,artifacts},null,2));return artifacts;
}
function makePly(snapshot){
  const points=(snapshot.landmarks||[]).filter(x=>x?.point?.length>=3&&x.point.every(Number.isFinite)),lines=['ply','format ascii 1.0',`element vertex ${points.length}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue','property float confidence','end_header'];
  for(const x of points){const q=Math.max(0,Math.min(1,Number(x.probability)||0)),r=Math.round(60+195*q),g=Math.round(190+50*q),b=Math.round(255-190*q);lines.push(`${x.point[0]} ${x.point[1]} ${x.point[2]} ${r} ${g} ${b} ${q}`);}return `${lines.join('\n')}\n`;
}
function makeScaffoldSvg(summary,snapshot){
  const points=(snapshot.landmarks||[]).filter(x=>x?.point?.length>=3&&x.point.every(Number.isFinite)),cameras=(snapshot.frames||[]).map(x=>x.poseEstimate?.p).filter(p=>p?.length>=3&&p.every(Number.isFinite)),views=[{title:'Vista dall’alto',axes:[0,2]},{title:'Vista frontale',axes:[0,1]},{title:'Vista laterale',axes:[2,1]}],W0=1200,H0=780,panelW=360,panelH=430,pad=34;
  const project=(rows,axes,x0,y0)=>{const xs=rows.map(p=>p[axes[0]]),ys=rows.map(p=>p[axes[1]]),loX=quantile(xs,.02)??0,hiX=quantile(xs,.98)??1,loY=quantile(ys,.02)??0,hiY=quantile(ys,.98)??1,s=Math.min((panelW-2*pad)/Math.max(1e-6,hiX-loX),(panelH-2*pad)/Math.max(1e-6,hiY-loY)),ox=x0+(panelW-(hiX-loX)*s)/2,oy=y0+(panelH-(hiY-loY)*s)/2;return p=>[ox+(p[axes[0]]-loX)*s,oy+(hiY-p[axes[1]])*s];};
  let body='';for(let i=0;i<views.length;i++){const v=views[i],x0=30+i*390,y0=235,all=[...points.map(x=>x.point),...cameras],p=project(all.length?all:[[0,0,0],[1,1,1]],v.axes,x0,y0);body+=`<rect x="${x0}" y="${y0}" width="${panelW}" height="${panelH}" rx="14" fill="#0b1220" stroke="#24344d"/><text x="${x0+18}" y="${y0+28}" class="panel">${v.title}</text>`;for(const x of points){const [cx,cy]=p(x.point),q=Math.max(.08,Math.min(1,Number(x.probability)||.1));if(cx<x0||cx>x0+panelW||cy<y0||cy>y0+panelH)continue;body+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(.65+q*.85).toFixed(2)}" fill="rgb(${Math.round(70+185*q)},${Math.round(185+60*q)},${Math.round(255-180*q)})" opacity="${(.28+.65*q).toFixed(2)}"/>`;};if(cameras.length){body+=`<polyline points="${cameras.map(c=>p(c).map(n=>n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#ff5bbd" stroke-width="2.4" opacity=".9"/>`;for(const c of cameras){const [cx,cy]=p(c);body+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="#fff" stroke="#ff5bbd"/>`;}}}
  const m=summary.photoMosaic||{},g=summary.rgbGraph||{},a=summary.sparseAnchors||{},cards=[['Pose confermate',g.confirmedPoses||0],['Edge RGB',m.edges||0],['Foto connesse',`${m.connectedFrames||0}/${m.frames||0}`],['Loop',m.loops||0],['Anchor triangolati',a.totalSeeds||0],['Robust RMSE',`${Number(g.stats?.reprojectionRobustRmse||0).toFixed(2)} px`]];let card='';for(let i=0;i<cards.length;i++){const x=30+i*190;card+=`<rect x="${x}" y="112" width="170" height="82" rx="12" fill="#111b2d" stroke="#263a57"/><text x="${x+14}" y="140" class="label">${cards[i][0]}</text><text x="${x+14}" y="178" class="value">${cards[i][1]}</text>`;}
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W0}" height="${H0}" viewBox="0 0 ${W0} ${H0}"><rect width="100%" height="100%" fill="#07101d"/><style>text{font-family:Inter,system-ui,sans-serif;fill:#eaf4ff}.title{font-size:28px;font-weight:750}.sub{font-size:14px;fill:#9cb2cc}.label{font-size:12px;fill:#96abc5}.value{font-size:27px;font-weight:750}.panel{font-size:15px;font-weight:650}</style><text x="30" y="45" class="title">V30 · replay stock · scaffold RGB/Alva</text><text x="30" y="72" class="sub">Nuvola sparse prima di Deep/MVS/TSDF · linea magenta = traiettoria camera · scala Alva non metrica</text>${card}${body}<text x="30" y="735" class="sub">Video: ${escapeXml(path.basename(summary.video||''))} · ${summary.frames} frame @ ${summary.fps} fps · planner ${summary.unifiedPlanner?.jobs||0} job</text></svg>`;
}
function encodePng(width,height,rgba){const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++){const o=y*(width*4+1);scan[o]=0;Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(scan,o+1);}const sig=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([sig,pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(scan,{level:8})),pngChunk('IEND',Buffer.alloc(0))]);}
function pngChunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data]))>>>0);return Buffer.concat([length,name,data,crc]);}
function crc32(buf){let c=0xffffffff;for(const x of buf){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function escapeXml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
