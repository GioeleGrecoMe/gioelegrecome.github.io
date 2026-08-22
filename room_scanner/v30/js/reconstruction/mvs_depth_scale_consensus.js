/**
 * Build one scan-wide depth search envelope for post-scan MVS.
 *
 * Alva poses already live in one shared world coordinate system. A plane-sweep
 * job must therefore never acquire an independent depth "scale" merely because
 * its local sparse triangulation is weak. Optimized RGB landmarks are the
 * preferred global scale scaffold; per-view triangulations remain local priors.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function buildPostScanMvsDepthConsensus(payloads,{metricLocked=false,fallbackNear=.18,fallbackFar=5,trajectoryDiagonal=null,minReliableSeeds=18,minReliableFrames=2,maxSeedsPerFrame=96,optimizerSnapshot=null,minLandmarkSeeds=24,maxLandmarksPerFrame=128}={}){
  const local=collectLocalDepths(payloads,maxSeedsPerFrame),landmark=collectOptimizedLandmarkDepths(payloads,optimizerSnapshot,maxLandmarksPerFrame);
  // The optimized landmark cloud is already constrained by multiple RGB views
  // in the common Alva world. When it is sufficiently populated, use it as the
  // scale authority rather than allowing weak local triangulations to rescale
  // a view. Local seeds are still sent to plane sweep as pixel-specific priors.
  const useLandmarks=landmark.rows.length>=Math.max(minLandmarkSeeds,minReliableSeeds)&&landmark.perFrame.length>=minReliableFrames,primary=useLandmarks?landmark:local,rows=primary.rows.slice(),perFrame=local.perFrame;
  const td=Number(trajectoryDiagonal),trajFallback=Number.isFinite(td)&&td>1e-5?{near:Math.max(.015,td*.045),far:Math.max(.25,td*6)}:null;
  const fbNear=Math.max(1e-5,Number(fallbackNear)||.18,trajFallback?.near||0),fbFar=Math.max(fbNear*2,Number(fallbackFar)||5,trajFallback?.far||0);
  if(rows.length<minReliableSeeds||primary.perFrame.length<minReliableFrames){
    return {ready:false,mode:'shared-fallback',scaleSource:'fallback',near:fbNear,far:fbFar,median:null,q10:null,q90:null,reliableSeeds:local.rows.length,reliableFrames:local.perFrame.length,landmarkSeeds:landmark.rows.length,landmarkFrames:landmark.perFrame.length,perFrame,landmarkPerFrame:landmark.perFrame,trajectoryDiagonal:Number.isFinite(td)?td:null};
  }
  rows.sort((a,b)=>a-b);
  const q10=quantileSorted(rows,.10),median=quantileSorted(rows,.50),q90=quantileSorted(rows,.90);
  // Keep the range broad enough for walls/furniture while preventing a handful
  // of nearly-parallel tracks from stretching a single view to tens/hundreds of
  // times the scan-wide depth scale.
  let near=Math.max(1e-5,q10*.55,median/40),far=Math.max(near*2,q90*1.75);
  far=Math.min(far,median*14);
  if(metricLocked){
    // Metric scans still benefit from one common envelope; the explicit metric
    // limits remain hard physical guards rather than per-view scale choices.
    near=Math.max(Math.min(fbNear,median*.75),near);
    far=Math.min(Math.max(fbFar,median*1.5),far);
    if(!(far>near*1.5)){near=Math.max(1e-5,Math.min(near,median*.55));far=Math.max(near*2,median*2.5);}
  }
  if(!(far>near*1.5)){near=fbNear;far=fbFar;}
  return {ready:true,mode:useLandmarks?'shared-landmark-consensus':'shared-sparse-consensus',scaleSource:useLandmarks?'optimized-rgb-landmarks':'view-balanced-sparse',near,far,median,q10,q90,reliableSeeds:local.rows.length,reliableFrames:local.perFrame.length,landmarkSeeds:landmark.rows.length,landmarkFrames:landmark.perFrame.length,perFrame,landmarkPerFrame:landmark.perFrame,trajectoryDiagonal:Number.isFinite(td)?td:null};
}

export function applyPostScanMvsDepthConsensus(payload,consensus){
  if(!payload||!consensus)return payload;
  const localNear=Number(payload.localSparseRange?.near??payload.near),localFar=Number(payload.localSparseRange?.far??payload.far),localMedian=Number(payload.localSparseRange?.median),ratio=Number.isFinite(localMedian)&&consensus.median>0?localMedian/consensus.median:null,localScaleOutlier=!!(consensus.ready&&Number.isFinite(localMedian)&&((Number.isFinite(consensus.q10)&&localMedian<consensus.q10*.65)||(Number.isFinite(consensus.q90)&&localMedian>consensus.q90*1.8)));
  payload.near=consensus.near;payload.far=consensus.far;
  // Sparse tracks remain local priors, not scale authorities. Remove only the
  // extreme tails that contradict the scan-wide distribution; for a whole-view
  // scale outlier use the central global band so weak-baseline triangulations do
  // not pin plane sweep to a false near/far solution.
  const before=payload.sparseSeeds?.length||0;if(consensus.ready&&before&&Number.isFinite(consensus.q10)&&Number.isFinite(consensus.q90)){
    const lo=localScaleOutlier?consensus.q10*.85:consensus.q10*.45,hi=localScaleOutlier?consensus.q90*1.25:consensus.q90*1.35;
    payload.sparseSeeds=payload.sparseSeeds.filter(s=>Number(s?.depth)>=lo&&Number(s?.depth)<=hi);
  }
  payload.depthScaleConsensus={mode:consensus.mode,scaleSource:consensus.scaleSource||null,ready:!!consensus.ready,near:consensus.near,far:consensus.far,median:consensus.median,localNear:Number.isFinite(localNear)?localNear:null,localFar:Number.isFinite(localFar)?localFar:null,localMedian:Number.isFinite(localMedian)?localMedian:null,localToGlobalMedianRatio:ratio,localScaleOutlier,sparseSeedsBefore:before,sparseSeedsAfter:payload.sparseSeeds?.length||0};
  return payload;
}

export function cameraTrajectoryDiagonal(payloads){
  const ps=[];for(const payload of payloads||[])for(const f of [payload?.ref,...(payload?.sources||[])])if(f?.pose?.p?.length>=3&&f.pose.p.slice(0,3).every(Number.isFinite))ps.push(f.pose.p);
  if(!ps.length)return null;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of ps)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}return Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]);
}

export function collectOptimizedLandmarkDepths(payloads,snapshot,maxPerFrame=128){
  const landmarks=(snapshot?.landmarks||[]).filter(l=>finite3(l?.point)&&Number(l?.probability??1)>=.025);if(!landmarks.length)return {rows:[],perFrame:[]};const rows=[],perFrame=[];
  for(const payload of payloads||[]){const f=payload?.ref;if(!f?.pose?.p||!f?.pose?.q||!f?.K)continue;const depths=[];for(const l of landmarks){const q=projectDepth(f.pose,f.K,l.point);if(!q)continue;const w=Number(f.width||f.K.width)||0,h=Number(f.height||f.K.height)||0;if(w>0&&h>0&&(q.u<0||q.v<0||q.u>=w||q.v>=h))continue;depths.push(q.z);}if(!depths.length)continue;const picked=balancedValues(depths,maxPerFrame);rows.push(...picked);perFrame.push({frameId:String(f.frameId||f.id||''),count:picked.length,median:quantile(picked,.5)});}
  return {rows,perFrame};
}

function collectLocalDepths(payloads,maxSeedsPerFrame){const rows=[],perFrame=[];for(const payload of payloads||[]){const fid=String(payload?.ref?.frameId||payload?.ref?.id||''),all=(payload?.sparseSeeds||[]).filter(validDepthSeed),strict=all.filter(reliableDepthSeed),usable=strict.length>=4?strict:all.filter(looseDepthSeed),picked=balancedSample(usable,maxSeedsPerFrame);if(picked.length){rows.push(...picked.map(s=>s.depth));perFrame.push({frameId:fid,count:picked.length,median:quantile(picked.map(s=>s.depth),.5),strict:strict.length});}}return {rows,perFrame};}
function projectDepth(pose,K,p){const d=[p[0]-pose.p[0],p[1]-pose.p[1],p[2]-pose.p[2]],c=qRotate(qConj(pose.q),d),z=Number(c[2]);if(!(z>1e-5))return null;return {u:K.fx*c[0]/z+K.cx,v:K.fy*c[1]/z+K.cy,z};}
function qConj(q){return [-Number(q[0]||0),-Number(q[1]||0),-Number(q[2]||0),Number(q[3]??1)];}
function qRotate(q,v){const x=Number(q[0]||0),y=Number(q[1]||0),z=Number(q[2]||0),w=Number(q[3]??1),vx=v[0],vy=v[1],vz=v[2],tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}
function finite3(v){return Array.isArray(v)&&v.length>=3&&v.slice(0,3).every(Number.isFinite);}
function validDepthSeed(s){return Number.isFinite(Number(s?.depth))&&Number(s.depth)>1e-6;}
function reliableDepthSeed(s){if(!validDepthSeed(s))return false;const rp=Number(s.reprojectionPx),ang=Number(s.angle),rs=Number(s.relativeDepthSigma),p=Number(s.geometryProbability??s.confidence);return (!Number.isFinite(rp)||rp<=3.0)&&(!Number.isFinite(ang)||ang>=.006)&&(!Number.isFinite(rs)||rs<=.22)&&(!Number.isFinite(p)||p>=.06);}
function looseDepthSeed(s){if(!validDepthSeed(s))return false;const rp=Number(s.reprojectionPx),ang=Number(s.angle),rs=Number(s.relativeDepthSigma);return (!Number.isFinite(rp)||rp<=3.8)&&(!Number.isFinite(ang)||ang>=.003)&&(!Number.isFinite(rs)||rs<=.40);}
function balancedSample(rows,max){if(rows.length<=max)return rows.slice();const sorted=rows.slice().sort((a,b)=>a.depth-b.depth),out=[];for(let i=0;i<max;i++)out.push(sorted[Math.round(i*(sorted.length-1)/Math.max(1,max-1))]);return out;}
function balancedValues(rows,max){if(rows.length<=max)return rows.slice();const sorted=rows.slice().sort((a,b)=>a-b),out=[];for(let i=0;i<max;i++)out.push(sorted[Math.round(i*(sorted.length-1)/Math.max(1,max-1))]);return out;}
function quantile(a,q){if(!a.length)return null;return quantileSorted(a.slice().sort((x,y)=>x-y),q);}
function quantileSorted(a,q){if(!a.length)return null;const t=clamp(q,0,1)*(a.length-1),i=Math.floor(t),u=t-i;return a[i]*(1-u)+a[Math.min(a.length-1,i+1)]*u;}
