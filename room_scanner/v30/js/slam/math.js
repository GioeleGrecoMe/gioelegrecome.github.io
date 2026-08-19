/* Room Scanner V30.7 - dependency-free geometry helpers.
 *
 * Camera convention used by the WASM PnP and the JS mapping code:
 *   +X right, +Y up, +Z forward.
 * Image V grows downward, therefore project() uses v = cy - fy*Y/Z.
 *
 * WebXR uses a right-handed reference space where the viewer looks along -Z.
 * The XR calibration module converts XR world coordinates to the V30 camera
 * convention before they ever enter this file. Keeping the conversion at the
 * boundary makes the rest of SLAM/MVS deterministic and easy to debug.
 */

export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function median(values){
  const a=(values||[]).filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length)return 0; const m=a.length>>1; return a.length&1?a[m]:(a[m-1]+a[m])*.5;
}
export function poseIdentity(){return {p:[0,0,0],q:[0,0,0,1]};}
export function poseClone(T){return {p:[...T.p],q:[...T.q]};}
export function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(v=>v/n);}
export function qAngle(a,b){const d=Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]));return 2*Math.acos(d);}
export function qConjugate(q){return [-q[0],-q[1],-q[2],q[3]];}
export function qMultiply(a,b){
  const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;
  return qNormalize([
    aw*bx+ax*bw+ay*bz-az*by,
    aw*by-ax*bz+ay*bw+az*bx,
    aw*bz+ax*by-ay*bx+az*bw,
    aw*bw-ax*bx-ay*by-az*bz
  ]);
}
export function qRotate(q,v){
  const [x,y,z,w]=q,[vx,vy,vz]=v,tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
  return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];
}
export function cameraToWorld(T,pc){const r=qRotate(T.q,pc);return [r[0]+T.p[0],r[1]+T.p[1],r[2]+T.p[2]];}
export function worldToCamera(T,pw){const d=[pw[0]-T.p[0],pw[1]-T.p[1],pw[2]-T.p[2]];return qRotate(qConjugate(T.q),d);}
export function backproject(u,v,z,K){return [(u-K.cx)*z/K.fx,-(v-K.cy)*z/K.fy,z];}
export function projectPoint(T,pw,K){const p=worldToCamera(T,pw);if(!(p[2]>.04))return null;return {u:K.fx*p[0]/p[2]+K.cx,v:K.cy-K.fy*p[1]/p[2],z:p[2]};}
export function intrinsicsFromSize(width,height,fovDeg=62){
  const fov=fovDeg*Math.PI/180,fx=.5*width/Math.tan(fov/2),fy=fx;
  return {fx,fy,cx:width*.5,cy:height*.5,width,height};
}
export function scaleIntrinsics(K,width,height){
  const sx=width/(K.width||width),sy=height/(K.height||height);
  return {fx:K.fx*sx,fy:K.fy*sy,cx:K.cx*sx,cy:K.cy*sy,width,height};
}

export function vAdd(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
export function vSub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
export function vScale(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
export function vDot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
export function vCross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
export function vNorm(a){return Math.hypot(a[0],a[1],a[2]);}
export function vNormalize(a){const n=vNorm(a)||1;return [a[0]/n,a[1]/n,a[2]/n];}

/* Closest point between two camera rays. This is the core camera-only source
 * of new metric landmarks after the WebXR bootstrap. The function rejects
 * near-parallel rays, negative depths and large line-to-line gaps rather than
 * fabricating a point. */
export function triangulateRays(obsA,obsB,{minAngleRad=.018,maxGapM=.08,minDepthM=.12,maxDepthM=15}={}){
  const da=vNormalize(qRotate(obsA.pose.q,vNormalize(backproject(obsA.u,obsA.v,1,obsA.K))));
  const db=vNormalize(qRotate(obsB.pose.q,vNormalize(backproject(obsB.u,obsB.v,1,obsB.K))));
  const ca=obsA.pose.p,cb=obsB.pose.p,w0=vSub(ca,cb),a=vDot(da,da),b=vDot(da,db),c=vDot(db,db),d=vDot(da,w0),e=vDot(db,w0),den=a*c-b*b;
  const cos=Math.max(-1,Math.min(1,b/Math.sqrt(a*c||1))),angle=Math.acos(Math.abs(cos));
  if(angle<minAngleRad||Math.abs(den)<1e-7)return {ok:false,reason:'low-parallax',angle};
  const sa=(b*e-c*d)/den,tb=(a*e-b*d)/den;
  if(sa<minDepthM||tb<minDepthM||sa>maxDepthM||tb>maxDepthM)return {ok:false,reason:'depth-range',angle,sa,tb};
  const pa=vAdd(ca,vScale(da,sa)),pb=vAdd(cb,vScale(db,tb)),gap=vNorm(vSub(pa,pb));
  if(gap>maxGapM)return {ok:false,reason:'ray-gap',angle,gap};
  const p=vScale(vAdd(pa,pb),.5);return {ok:true,p,angle,gap,depthA:sa,depthB:tb};
}

function planeFrom3(a,b,c){
  const n=vNormalize(vCross(vSub(b,a),vSub(c,a))); if(vNorm(n)<1e-8)return null;
  return {n,d:-(n[0]*a[0]+n[1]*a[1]+n[2]*a[2])};
}
function pointPlaneDistance(p,pl){return Math.abs(pl.n[0]*p[0]+pl.n[1]*p[1]+pl.n[2]*p[2]+pl.d);}
export function fitPlaneRansac(points,{iterations=80,threshold=.03}={}){
  if(!points||points.length<3)return null; let best=null;
  let seed=0x1234abcd; const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let it=0;it<iterations;it++){
    const ia=Math.floor(rnd()*points.length),ib=Math.floor(rnd()*points.length),ic=Math.floor(rnd()*points.length);
    if(ia===ib||ia===ic||ib===ic)continue; const pl=planeFrom3(points[ia],points[ib],points[ic]); if(!pl)continue;
    let count=0,sum=0; for(const p of points){const er=pointPlaneDistance(p,pl);if(er<=threshold){count++;sum+=er;}}
    if(!best||count>best.count||(count===best.count&&sum<best.sum))best={...pl,count,sum,meanError:count?sum/count:Infinity};
  }
  return best;
}

/* JS PnP fallback. The production path uses the WASM solver. */
export function optimizePosePnP(initialPose,correspondences,K,{iterations=5,maxPoints=140}={}){
  void K; void iterations; void maxPoints;
  return {pose:poseClone(initialPose),inliers:0,rmse:Infinity,ok:false,reason:`wasm-pnp-unavailable:${correspondences?.length||0}`};
}
