import {clamp,dist3,median,multiply4,norm3,transformDirection4,transformPoint4} from './math_v20_2_0.js';

/**
 * Register independent WebXR local-floor segments with persistent markpoints.
 * Gravity is already common, so the fit is restricted to yaw + translation.
 * No scale fitting is allowed: one WebXR metre remains one metre.
 */
export function estimateSegmentTransforms(segments=[],markpoints=[]){
  const segmentIds=(segments.length?segments.map(s=>s.id):[...new Set(markpoints.map(m=>m.segmentId))]).filter(Boolean);const reference=segmentIds[0]||'segment-0',byLogical=new Map();for(const m of markpoints){if(!m.logicalId||!m.segmentId||!Array.isArray(m.position))continue;if(!byLogical.has(m.logicalId))byLogical.set(m.logicalId,new Map());const per=byLogical.get(m.logicalId),existing=per.get(m.segmentId);if(!existing||(m.quality||0)>(existing.quality||0))per.set(m.segmentId,m);}
  const result={[reference]:{segmentId:reference,referenceSegmentId:reference,matrix:Array.from(identity4()),registered:true,method:'reference',matches:0,residualM:0,confidence:1}};
  for(const sid of segmentIds){if(sid===reference)continue;const pairs=[];for(const [logical,per] of byLogical){const a=per.get(reference),b=per.get(sid);if(a&&b)pairs.push({logical,reference:a.position,moving:b.position,weight:Math.max(.1,Math.min(a.quality||.5,b.quality||.5))});}result[sid]=fitYawTranslation(sid,reference,pairs);}
  return {referenceSegmentId:reference,transforms:result,unregistered:segmentIds.filter(id=>!result[id]?.registered),markpointGroups:byLogical.size};
}

export function fitYawTranslation(segmentId,referenceSegmentId,pairs){
  if(!pairs.length)return {segmentId,referenceSegmentId,matrix:null,registered:false,method:'none',matches:0,residualM:null,confidence:0};let wr=0,rx=0,ry=0,rz=0,mx=0,my=0,mz=0;for(const p of pairs){const w=p.weight||1;wr+=w;rx+=p.reference[0]*w;ry+=p.reference[1]*w;rz+=p.reference[2]*w;mx+=p.moving[0]*w;my+=p.moving[1]*w;mz+=p.moving[2]*w;}rx/=wr;ry/=wr;rz/=wr;mx/=wr;my/=wr;mz/=wr;let A=0,B=0;for(const p of pairs){const w=p.weight||1,qx=p.moving[0]-mx,qz=p.moving[2]-mz,px=p.reference[0]-rx,pz=p.reference[2]-rz;A+=w*(qx*px+qz*pz);B+=w*(qx*pz-qz*px);}const yaw=pairs.length>=2?Math.atan2(B,A):0,c=Math.cos(yaw),s=Math.sin(yaw),tx=rx-(c*mx-s*mz),tz=rz-(s*mx+c*mz),ty=median(pairs.map(p=>p.reference[1]-p.moving[1])),matrix=yawTranslationMatrix(yaw,[tx,ty,tz]),residuals=pairs.map(p=>dist3(transformPoint4(matrix,p.moving),p.reference)),residualM=median(residuals),registered=pairs.length>=2&&residualM<.22||pairs.length===1&&residualM<.08,method=pairs.length>=2?'markpoint-yaw-translation':'single-markpoint-translation',confidence=registered?clamp((pairs.length/3)*(1-residualM/.25),.15,1):0;return {segmentId,referenceSegmentId,matrix:Array.from(matrix),registered,method,matches:pairs.length,residualM,yawRad:yaw,translation:[tx,ty,tz],confidence,pairIds:pairs.map(p=>p.logical)};
}
export function yawTranslationMatrix(yaw,t){const c=Math.cos(yaw),s=Math.sin(yaw);return new Float32Array([c,0,s,0,0,1,0,0,-s,0,c,0,t[0],t[1],t[2],1]);}
export function applySegmentTransformToPacked(points,matrix){if(!matrix)return points;const out=new Float32Array(points.length);for(let i=0;i<points.length;i+=10){const p=transformPoint4(matrix,[points[i],points[i+1],points[i+2]]),n=transformDirection4(matrix,[points[i+3],points[i+4],points[i+5]]);out.set([p[0],p[1],p[2],n[0],n[1],n[2],points[i+6],points[i+7],points[i+8],points[i+9]],i);}return out;}
export function transformPoseMatrix(poseMatrix,segmentMatrix){return segmentMatrix?multiply4(segmentMatrix,poseMatrix):poseMatrix;}
function identity4(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);}
