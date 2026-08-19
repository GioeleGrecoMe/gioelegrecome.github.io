import {clamp,projectPoint} from '../slam/math.js';

/* Camera-only hand-off after WebXR.
 * Stored Raw-Camera patches are matched against the first getUserMedia frames.
 * Their 3D coordinates came from WebXR hit-test, therefore a robust WASM PnP
 * directly recovers a metric camera pose without IMU or monocular depth AI. */
function statsPatch(a){let s=0,s2=0;for(const v of a){s+=v;s2+=v*v;}const n=a.length,m=s/n,sd=Math.sqrt(Math.max(1,s2/n-m*m));return {m,sd};}
function samplePatch(gray,w,h,cx,cy,sourceSize,outSize){const out=new Uint8Array(outSize*outSize),half=sourceSize*.5;for(let y=0;y<outSize;y++)for(let x=0;x<outSize;x++){const sx=Math.round(cx-half+(x+.5)*sourceSize/outSize),sy=Math.round(cy-half+(y+.5)*sourceSize/outSize);if(sx<0||sy<0||sx>=w||sy>=h)return null;out[y*outSize+x]=gray[sy*w+sx];}return out;}
function zncc(a,b,sa=null){if(!a||!b||a.length!==b.length)return -1;sa=sa||statsPatch(a);const sb=statsPatch(b);if(sa.sd<3||sb.sd<3)return -1;let num=0;for(let i=0;i<a.length;i++)num+=(a[i]-sa.m)*(b[i]-sb.m);return num/(a.length*sa.sd*sb.sd);}
export function locateAnchor(gray,w,h,anchor,{searchFrac=.105,minScore=.48}={}){
  const template=Uint8Array.from(anchor.patch),N=anchor.patchSize||Math.round(Math.sqrt(template.length)),ts=statsPatch(template),base=Math.max(8,(anchor.patchRel||.08)*Math.min(w,h)),cx0=anchor.uv[0]*w,cy0=anchor.uv[1]*h,rx=Math.max(12,w*searchFrac),ry=Math.max(12,h*searchFrac);let best={score:-2},second=-2;
  for(const scale of [.78,.92,1,1.10,1.24]){const sourceSize=base*scale,step=Math.max(2,Math.round(sourceSize/7));for(let cy=cy0-ry;cy<=cy0+ry;cy+=step)for(let cx=cx0-rx;cx<=cx0+rx;cx+=step){const p=samplePatch(gray,w,h,cx,cy,sourceSize,N);if(!p)continue;const score=zncc(template,p,ts);if(score>best.score){second=best.score;best={score,u:cx,v:cy,sourceSize};}else if(score>second)second=score;}}
  best.uniqueness=best.score-second;best.ok=best.score>=minScore&&(best.uniqueness>.018||best.score>.80);return best;
}
export function locateCalibrationTemplates(calibration,frame){const found=[];for(const a of calibration.anchors||[]){const m=locateAnchor(frame.gray,frame.width,frame.height,a);if(m.ok)found.push({anchor:a,...m});}return found;}
export function calibrationIntrinsics(calibration,width,height,fallback=null){const n=calibration?.intrinsicsNorm;if(!n)return fallback;return {fx:n.fxN*width,fy:n.fyN*height,cx:n.cxN*width,cy:n.cyN*height,width,height};}
export function bindMatchesToFeatures(found,analysis,maxPx=22){const out=[];for(const f of found){let best=-1,bd=maxPx;for(let i=0;i<analysis.features.count;i++){const d=Math.hypot(analysis.features.xs[i]-f.u,analysis.features.ys[i]-f.v);if(d<bd){bd=d;best=i;}}if(best>=0)out.push({anchor:f.anchor,trackId:analysis.trackIds[best],featureIndex:best,u:analysis.features.xs[best],v:analysis.features.ys[best],score:f.score});}return out;}
export function bridgeMetricPose({calibration,frame,analysis,frontend}){
  const found=locateCalibrationTemplates(calibration,frame),K=analysis.K,correspondences=found.map(f=>({world:f.anchor.p,u:f.u,v:f.v}));
  if(correspondences.length<8)return {ok:false,reason:'few-visual-anchors',found,K,inliers:0,rmse:Infinity};
  const seed=calibration.pose||analysis.pose,result=frontend.optimizePose(seed,correspondences,K,{iterations:8,maxPoints:40,minInliers:8});
  if(!result?.ok||!Number.isFinite(result.rmse)||result.rmse>7.5)return {ok:false,reason:'pnp-rejected',found,K,inliers:result?.inliers||0,rmse:result?.rmse??Infinity,pose:result?.pose};
  const bindings=bindMatchesToFeatures(found,analysis);return {ok:bindings.length>=6,reason:bindings.length>=6?'ok':'few-feature-bindings',found,bindings,K,...result};
}

/* Debug helper: projects calibration anchors from a proposed metric pose. */
export function bridgeResiduals(calibration,pose,K){return (calibration.anchors||[]).map(a=>({id:a.id,projection:projectPoint(pose,a.p,K)}));}
