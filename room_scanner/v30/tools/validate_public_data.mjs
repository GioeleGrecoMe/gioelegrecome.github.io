import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {matchProbabilisticFeatures} from '../js/probabilistic/feature_tracker.js';
import {ProbabilisticJointOptimizer} from '../js/probabilistic/joint_optimizer.js';
import {projectPoint,qRotate} from '../js/slam/math.js';
import {ViewPuzzleGraph} from '../js/reconstruction/view_puzzle.js';
import {LivePhotoPuzzleMap} from '../js/reconstruction/live_photo_puzzle.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function parsePgm(file){
  const b=fs.readFileSync(file);let i=0;
  const token=()=>{while(i<b.length&&isWs(b[i]))i++;if(b[i]===35){while(i<b.length&&b[i]!==10)i++;return token();}let s='';while(i<b.length&&!isWs(b[i]))s+=String.fromCharCode(b[i++]);return s;};
  if(token()!=='P5')throw new Error('expected binary PGM P5');const width=+token(),height=+token(),max=+token();if(max!==255)throw new Error(`unsupported PGM max ${max}`);while(i<b.length&&isWs(b[i]))i++;if(b.length-i<width*height)throw new Error('truncated PGM');return {width,height,gray:new Uint8Array(b.buffer,b.byteOffset+i,width*height)};
}
export function parseTumGroundTruth(file){
  return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(x=>x.trim()&&!x.startsWith('#')).map(line=>line.trim().split(/\s+/).map(Number)).filter(x=>x.length>=8&&x.every(Number.isFinite));
}
export function validateTumPublicData(){
  const pgm=parsePgm(path.join(ROOT,'test/online-data/tum_freiburg1_xyz_rgb_preview_gray.pgm'));
  if(pgm.width!==320||pgm.height!==240)throw new Error(`unexpected TUM preview size ${pgm.width}x${pgm.height}`);
  const gt=parseTumGroundTruth(path.join(ROOT,'test/online-data/tum_freiburg1_xyz_groundtruth.txt'));if(gt.length<2500)throw new Error(`TUM trajectory too short ${gt.length}`);
  const duration=gt.at(-1)[0]-gt[0][0],pathLength=gt.slice(1).reduce((s,r,i)=>s+Math.hypot(r[1]-gt[i][1],r[2]-gt[i][2],r[3]-gt[i][3]),0),qNormMean=gt.reduce((s,r)=>s+Math.hypot(r[4],r[5],r[6],r[7]),0)/gt.length;
  if(!(duration>29&&duration<31&&pathLength>7&&pathLength<12&&Math.abs(qNormMean-1)<.01))throw new Error(`invalid TUM trajectory duration=${duration} length=${pathLength} q=${qNormMean}`);

  // Real-texture association test. The second view is a deterministic 5-pixel
  // horizontal warp of the official TUM RGB preview. The pose baseline is chosen
  // so the warp is exactly the epipolar motion of a 2 m fronto-parallel surface.
  const {width:w,height:h,gray}=pgm,shift=-5,warped=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=x-shift;warped[y*w+x]=sx>=0&&sx<w?gray[y*w+sx]:0;}
  const candidates=[];for(let y=12;y<h-12;y+=8)for(let x=12;x<w-12;x+=8){const gx=gray[y*w+x+1]-gray[y*w+x-1],gy=gray[(y+1)*w+x]-gray[(y-1)*w+x],g=Math.hypot(gx,gy);if(g>35)candidates.push({x,y,g});}candidates.sort((a,b)=>b.g-a.g);const chosen=[];for(const c of candidates){if(chosen.some(d=>Math.hypot(c.x-d.x,c.y-d.y)<12))continue;chosen.push(c);if(chosen.length>=90)break;}
  const K={fx:517.3/2,fy:516.5/2,cx:318.6/2,cy:255.3/2,width:w,height:h},z=2,baseline=-shift*z/K.fx,refFeatures=chosen.map(c=>({x:c.x,y:c.y,score:c.g,source:'alva-track'})),corresponding=chosen.filter(c=>c.x+shift>10&&c.x+shift<w-10).map(c=>({x:c.x+shift,y:c.y,score:c.g,source:'alva-track'})),decoys=[];for(let y=20;y<h-20;y+=24)for(let x=20;x<w-20;x+=28)decoys.push({x,y,score:60,source:'mvs'});
  const ref={gray,width:w,height:h,K,pose:{p:[0,0,0],q:[0,0,0,1]},features:refFeatures},src={gray:warped,width:w,height:h,K,pose:{p:[baseline,0,0],q:[0,0,0,1]},features:[...corresponding,...decoys]},matches=matchProbabilisticFeatures(ref,src,{maxFeatures:300,maxMatches:150,maxEpipolarPx:3,maxHamming:64,minProbability:.02});
  let correct=0;for(const m of matches){const a=ref.features[m.i],b=src.features[m.j];if(Math.abs(b.x-(a.x+shift))<.25&&Math.abs(b.y-a.y)<.25)correct++;}const precision=matches.length?correct/matches.length:0,recall=corresponding.length?correct/corresponding.length:0;if(precision<.94||recall<.88)throw new Error(`TUM association weak precision=${precision} recall=${recall}`);

  // V30.29 photo-puzzle validation on the same public TUM texture. We create a
  // deterministic short camera walk by translating the official preview; the
  // texture is real public data while the warp is controlled so connectivity
  // and loop closure have an exact expected answer. This is deliberately not
  // claimed as a full TUM reconstruction benchmark.
  const shifts=[0,-3,-6,-9,-6,-1],puzzleFrames=shifts.map((sh,i)=>{const im=warpX(gray,w,h,sh),feats=chosen.filter(c=>c.x+sh>10&&c.x+sh<w-10).map((c,k)=>({index:k,x:c.x+sh,y:c.y,originalU:c.x+sh,originalV:c.y,score:c.g,source:'alva-track'})),tx=-sh*z/K.fx;return {frameId:`puz-${i}`,posePrior:{p:[tx,0,0],q:[0,0,0,1]},poseEstimate:{p:[tx,0,0],q:[0,0,0,1]},K,width:w,height:h,photo:{width:w,height:h,K,gray:im,rgb:grayRgb(im),features:feats}};}),photoPuzzle=new ViewPuzzleGraph({format:'ROOMSCAN-PROB-GRAPH-1',frames:puzzleFrames},{temporalRadius:1,maxLoopCandidates:4,minEdgeMatches:6,minEdgeProbability:.08}).build();
  if(photoPuzzle.stats.connectedFraction<.99||photoPuzzle.stats.edges<5||photoPuzzle.stats.loops<1)throw new Error(`TUM photo puzzle weak ${JSON.stringify(photoPuzzle.stats)}`);

  // V30.30 live atlas validation on the same public TUM texture. The controlled
  // translation corresponds to a 2 m fronto-parallel surface, so the metric
  // depth is exact and the live pose-aware reprojection has a known solution.
  const liveMap=new LivePhotoPuzzleMap({width:320,height:160,maxFrames:12,maxRenderFrames:12,photoMaxSide:320,depthMaxSide:160,minEdgeMatches:6,minEdgeProbability:.08,maxPhotoSamples:180000,maxDepthSamples:120000});
  const metricPlane=new Float32Array(w*h);metricPlane.fill(z);
  for(const f of puzzleFrames){liveMap.addFrame(f);liveMap.updateDepth(f.frameId,{depth:metricPlane,width:w,height:h,confidence:.98,mode:'public-tum-plane'});}
  const liveStats=liveMap.stats(),livePhoto=liveMap.renderPhotoAtlas(),liveDepth=liveMap.renderDepthAtlas();
  if(liveStats.connectedFraction<.99||liveStats.edges<5||livePhoto.coverage<.015||liveDepth.coverage<.015)throw new Error(`TUM live atlas weak ${JSON.stringify({liveStats,photoCoverage:livePhoto.coverage,depthCoverage:liveDepth.coverage})}`);

  // Exercise the post-scan factor optimiser on a real public camera motion.
  // Measurements are synthetic projections of a small static cloud, but the
  // camera trajectory itself is the official TUM motion and the Alva-like priors
  // are deliberately perturbed. This isolates whether the optimiser can recover
  // consistency without assuming a toy straight-line trajectory.
  const sel=[0,5,10,15,20,25,30,35].map(i=>gt[i]),Kt={fx:517.3,fy:516.5,cx:318.6,cy:255.3,width:640,height:480},truth=sel.map((r,i)=>({frameId:`tum-${i}`,pose:{p:r.slice(1,4),q:r.slice(4,8)}})),f0=truth[0],pts=[];
  for(let yy=-.5;yy<=.5;yy+=.2)for(let xx=-.7;xx<=.7;xx+=.25){const zc=2.8+.15*Math.sin(xx*3),d=qRotate(f0.pose.q,[xx,yy,zc]);pts.push([f0.pose.p[0]+d[0],f0.pose.p[1]+d[1],f0.pose.p[2]+d[2]]);}
  const landmarkFactors=[];let lid=0;for(const p of pts){const ms=[];for(const f of truth){const q=projectPoint(f.pose,Kt,p);if(q&&q.u>8&&q.u<632&&q.v>8&&q.v<472)ms.push({frameId:f.frameId,u:q.u,v:q.v,probability:.99});}if(ms.length>=6)landmarkFactors.push({id:`tum-l${lid++}`,point:[p[0]+.01*Math.sin(lid),p[1]+.008*Math.cos(lid),p[2]+.012*Math.sin(lid*.7)],covariance:[.0009,0,0,.0009,0,.0025],probability:.92,relativeDepthSigma:.04,measurements:ms});}
  const frames=truth.map((f,i)=>{const e=i===0?[0,0,0]:[.012*Math.sin(i),.007*Math.cos(i*1.3),.006*Math.sin(i*.7)];return {frameId:f.frameId,posePrior:{p:f.pose.p.map((v,k)=>v+e[k]),q:f.pose.q.slice()},poseEstimate:{p:f.pose.p.map((v,k)=>v+e[k]),q:f.pose.q.slice()},poseCov:{diag:[4e-4,4e-4,4e-4,1e-4,1e-4,1e-4]},K:Kt,width:640,height:480};}),opt=new ProbabilisticJointOptimizer({format:'ROOMSCAN-PROB-GRAPH-1',frames,landmarkFactors,deepFactors:[],mvsFactors:[]},{posePriorScale:.3}),before=opt.computeStats();opt.step(10);const after=opt.computeStats();if(!(after.reprojectionRmse<before.reprojectionRmse*.12&&after.poseShiftMean<.025))throw new Error(`TUM factor optimisation weak ${before.reprojectionRmse}->${after.reprojectionRmse}`);
  return {dataset:'TUM RGB-D freiburg1_xyz',groundTruthSamples:gt.length,durationSec:duration,pathLengthM:pathLength,quaternionNormMean:qNormMean,realTextureFeatures:refFeatures.length,matches:matches.length,correct,precision,recall,baselineM:baseline,tumFactorFrames:frames.length,tumFactorLandmarks:landmarkFactors.length,reprojectionBeforePx:before.reprojectionRmse,reprojectionAfterPx:after.reprojectionRmse,poseCorrectionMeanM:after.poseShiftMean,photoPuzzleFrames:photoPuzzle.stats.frames,photoPuzzleEdges:photoPuzzle.stats.edges,photoPuzzleLoops:photoPuzzle.stats.loops,photoPuzzleConnectedFraction:photoPuzzle.stats.connectedFraction,liveAtlasEdges:liveStats.edges,liveAtlasConnectedFraction:liveStats.connectedFraction,livePhotoCoverage:livePhoto.coverage,liveDepthCoverage:liveDepth.coverage};
}
function warpX(src,w,h,shift){const out=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=x-shift;out[y*w+x]=sx>=0&&sx<w?src[y*w+sx]:0;}return out;}
function grayRgb(g){const out=new Uint8Array(g.length*3);for(let i=0;i<g.length;i++){out[i*3]=g[i];out[i*3+1]=g[i];out[i*3+2]=g[i];}return out;}
function isWs(x){return x===9||x===10||x===13||x===32;}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const r=validateTumPublicData();console.log('PASS public-data validation');console.log(JSON.stringify(r,null,2));
}
