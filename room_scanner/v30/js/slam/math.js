/* Room Scanner V30.1 - small, dependency-free SLAM math helpers.
 * Keep this file deterministic and allocation-light: it is used by both the
 * visual tracker and depth calibration. Debug-friendly comments intentionally
 * spell out coordinate conventions so device-specific issues are traceable. */

export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function median(values){
  const a=(values||[]).filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length)return 0; const m=a.length>>1; return a.length&1?a[m]:(a[m-1]+a[m])*.5;
}
export function poseIdentity(){return {p:[0,0,0],q:[0,0,0,1]};}
export function poseClone(T){return {p:[...T.p],q:[...T.q]};}
export function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(v=>v/n);}
export function qAngle(a,b){const d=Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]));return 2*Math.acos(d);}
export function qRotate(q,v){
  const [x,y,z,w]=q,[vx,vy,vz]=v,tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
  return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];
}
export function cameraToWorld(T,pc){const r=qRotate(T.q,pc);return [r[0]+T.p[0],r[1]+T.p[1],r[2]+T.p[2]];}
export function backproject(u,v,z,K){return [(u-K.cx)*z/K.fx,-(v-K.cy)*z/K.fy,z];}
export function intrinsicsFromSize(width,height,fovDeg=62){
  const fov=fovDeg*Math.PI/180,fx=.5*width/Math.tan(fov/2),fy=fx;
  return {fx,fy,cx:width*.5,cy:height*.5,width,height};
}

function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function norm(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
function planeFrom3(a,b,c){
  const n=norm(cross(sub(b,a),sub(c,a))); if(Math.hypot(...n)<1e-8)return null;
  return {n,d:-(n[0]*a[0]+n[1]*a[1]+n[2]*a[2])};
}
function pointPlaneDistance(p,pl){return Math.abs(pl.n[0]*p[0]+pl.n[1]*p[1]+pl.n[2]*p[2]+pl.d);}
export function fitPlaneRansac(points,{iterations=80,threshold=.03}={}){
  if(!points||points.length<3)return null; let best=null;
  // Deterministic pseudo-random sampling makes self-tests reproducible.
  let seed=0x1234abcd; const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let it=0;it<iterations;it++){
    const ia=Math.floor(rnd()*points.length),ib=Math.floor(rnd()*points.length),ic=Math.floor(rnd()*points.length);
    if(ia===ib||ia===ic||ib===ic)continue; const pl=planeFrom3(points[ia],points[ib],points[ic]); if(!pl)continue;
    let count=0,sum=0; for(const p of points){const e=pointPlaneDistance(p,pl);if(e<=threshold){count++;sum+=e;}}
    if(!best||count>best.count||(count===best.count&&sum<best.sum))best={...pl,count,sum,meanError:count?sum/count:Infinity};
  }
  return best;
}

/* JS PnP fallback. The main V30 path uses the WASM solver. Returning an
 * explicit failed result is preferable to silently applying an unverified
 * translation if a browser cannot expose the expected WASM exports. */
export function optimizePosePnP(initialPose,correspondences,K,{iterations=5,maxPoints=140}={}){
  void K; void iterations; void maxPoints;
  return {pose:poseClone(initialPose),inliers:0,rmse:Infinity,ok:false,reason:`wasm-pnp-unavailable:${correspondences?.length||0}`};
}
