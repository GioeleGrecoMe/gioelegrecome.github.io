import {projectPoint} from '../slam/math.js';

/*
 * Room Scanner V30.8 camera-only metric hand-off.
 *
 * V30.8 calibrations contain USER-SELECTED object groups. Each object provides
 * several metric 3D micro-landmarks and each micro-landmark owns appearance
 * templates collected from multiple WebXR poses. The very last WebXR frame is
 * a "common view" in which all selected objects are visible together.
 *
 * During the getUserMedia hand-off we therefore:
 *   - search around the common-view UV, not around arbitrary historical UVs;
 *   - try the final common-view template first;
 *   - fall back to a few strong multi-view templates if appearance changed;
 *   - solve metric PnP from the distinct 3D micro-landmarks;
 *   - bind accepted image locations to unique SLAM features.
 */
function statsPatch(a){let s=0,s2=0;for(const v of a){s+=v;s2+=v*v;}const n=a.length,m=s/n,sd=Math.sqrt(Math.max(1,s2/n-m*m));return {m,sd};}
function samplePatch(gray,w,h,cx,cy,sourceSize,outSize){const out=new Uint8Array(outSize*outSize),half=sourceSize*.5;for(let y=0;y<outSize;y++)for(let x=0;x<outSize;x++){const sx=Math.round(cx-half+(x+.5)*sourceSize/outSize),sy=Math.round(cy-half+(y+.5)*sourceSize/outSize);if(sx<0||sy<0||sx>=w||sy>=h)return null;out[y*outSize+x]=gray[sy*w+sx];}return out;}
function zncc(a,b,sa=null){if(!a||!b||a.length!==b.length)return -1;sa=sa||statsPatch(a);const sb=statsPatch(b);if(sa.sd<3||sb.sd<3)return -1;let num=0;for(let i=0;i<a.length;i++)num+=(a[i]-sa.m)*(b[i]-sb.m);return num/(a.length*sa.sd*sb.sd);}

/* Single-template matcher retained as a public primitive and regression target. */
export function locateAnchor(gray,w,h,anchor,{searchFrac=.085,minScore=.46}={}){
  const template=Uint8Array.from(anchor.patch),N=anchor.patchSize||Math.round(Math.sqrt(template.length)),ts=statsPatch(template),base=Math.max(8,(anchor.patchRel||.08)*Math.min(w,h)),cx0=anchor.uv[0]*w,cy0=anchor.uv[1]*h,rx=Math.max(12,w*searchFrac),ry=Math.max(12,h*searchFrac);let best={score:-2},second=-2;
  for(const scale of [.80,.92,1,1.10,1.22]){const sourceSize=base*scale,step=Math.max(2,Math.round(sourceSize/7));for(let cy=cy0-ry;cy<=cy0+ry;cy+=step)for(let cx=cx0-rx;cx<=cx0+rx;cx+=step){const p=samplePatch(gray,w,h,cx,cy,sourceSize,N);if(!p)continue;const score=zncc(template,p,ts);if(score>best.score){second=best.score;best={score,u:cx,v:cy,sourceSize};}else if(score>second)second=score;}}
  best.uniqueness=best.score-second;best.ok=best.score>=minScore&&(best.uniqueness>.014||best.score>.78);return best;
}

function templatesForAnchor(anchor,maxTemplates=4){
  const out=[{patch:anchor.patch,patchSize:anchor.patchSize,patchRel:anchor.patchRel,kind:'common',strength:(anchor.detail||0)+(anchor.variance||0)*.002}];
  const obs=(anchor.observations||[]).filter(o=>o?.patch?.length).map(o=>({patch:o.patch,patchSize:o.patchSize||anchor.patchSize,patchRel:o.patchRel||anchor.patchRel,kind:'multiview',strength:(o.detail||0)+(o.variance||0)*.002+(o.score||0)*5})).sort((a,b)=>b.strength-a.strength);
  for(const o of obs){out.push(o);if(out.length>=maxTemplates)break;}return out;
}
export function locateMultiTemplateAnchor(gray,w,h,anchor,opts={}){
  const templates=templatesForAnchor(anchor,opts.maxTemplates||4);let best={ok:false,score:-2,templateIndex:-1};
  for(let i=0;i<templates.length;i++){
    const t=templates[i],candidate={...anchor,uv:anchor.uv,patch:t.patch,patchSize:t.patchSize,patchRel:t.patchRel},r=locateAnchor(gray,w,h,candidate,opts);
    if(r.score>best.score)best={...r,templateIndex:i,templateKind:t.kind};
    // The final common-view template is intentionally privileged. A strong
    // match here avoids spending CPU on historical templates.
    if(i===0&&r.ok&&r.score>.70)break;
  }
  return best;
}

/* V30.7 calibrations remain readable. V30.8 simply adds objectId + observations. */
export function calibrationAnchors(calibration){return (calibration?.anchors||[]).filter(a=>a?.p&&a?.patch?.length&&a?.uv?.length===2);}
export function locateCalibrationTemplates(calibration,frame){
  const raw=[];for(const a of calibrationAnchors(calibration)){const m=locateMultiTemplateAnchor(frame.gray,frame.width,frame.height,a,{searchFrac:calibration?.format==='ROOMSCAN-V30-XR-CALIBRATION-2'?.075:.105,minScore:.44,maxTemplates:4});if(m.ok)raw.push({anchor:a,...m});}
  // Prevent one visual peak from being reused by several 3D points. The radius
  // is intentionally small because points from one selected object cluster can
  // legitimately be only ~10-20 px apart.
  raw.sort((a,b)=>b.score-a.score);const found=[];for(const r of raw){if(found.some(f=>Math.hypot(f.u-r.u,f.v-r.v)<4))continue;found.push(r);}return found;
}
export function calibrationIntrinsics(calibration,width,height,fallback=null){const n=calibration?.intrinsicsNorm;if(!n)return fallback;return {fx:n.fxN*width,fy:n.fyN*height,cx:n.cxN*width,cy:n.cyN*height,width,height};}

export function bindMatchesToFeatures(found,analysis,maxPx=24){
  // Greedy globally sorted assignment prevents two metric landmarks from being
  // attached to the same feature track during the seed hand-off.
  const proposals=[];for(let fi=0;fi<found.length;fi++)for(let i=0;i<analysis.features.count;i++){const d=Math.hypot(analysis.features.xs[i]-found[fi].u,analysis.features.ys[i]-found[fi].v);if(d<=maxPx)proposals.push({fi,i,d});}
  proposals.sort((a,b)=>a.d-b.d);const usedFound=new Set(),usedFeatures=new Set(),out=[];
  for(const p of proposals){if(usedFound.has(p.fi)||usedFeatures.has(p.i))continue;const f=found[p.fi];usedFound.add(p.fi);usedFeatures.add(p.i);out.push({anchor:f.anchor,trackId:analysis.trackIds[p.i],featureIndex:p.i,u:analysis.features.xs[p.i],v:analysis.features.ys[p.i],score:f.score,templateKind:f.templateKind});}
  return out;
}

export function bridgeMetricPose({calibration,frame,analysis,frontend}){
  const found=locateCalibrationTemplates(calibration,frame),K=analysis.K,correspondences=found.map(f=>({world:f.anchor.p,u:f.u,v:f.v}));
  if(correspondences.length<8)return {ok:false,reason:'few-visual-anchors',found,K,inliers:0,rmse:Infinity,needed:8};
  const seed=calibration.commonView?.pose||calibration.pose||analysis.pose,result=frontend.optimizePose(seed,correspondences,K,{iterations:10,maxPoints:60,minInliers:8});
  if(!result?.ok||!Number.isFinite(result.rmse)||result.rmse>7.0)return {ok:false,reason:'pnp-rejected',found,K,inliers:result?.inliers||0,rmse:result?.rmse??Infinity,pose:result?.pose};
  const bindings=bindMatchesToFeatures(found,analysis);return {ok:bindings.length>=6,reason:bindings.length>=6?'ok':'few-feature-bindings',found,bindings,K,...result};
}

/* Debug helper: projects calibration anchors from a proposed metric pose. */
export function bridgeResiduals(calibration,pose,K){return calibrationAnchors(calibration).map(a=>({id:a.id,objectId:a.objectId,projection:projectPoint(pose,a.p,K)}));}
