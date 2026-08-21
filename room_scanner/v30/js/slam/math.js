// V30.38.1: explicitly shipped with the SLAM dynamic-import closure to prevent mixed-build module graphs.
/** Dependency-free camera geometry helpers used by the camera-only SLAM path. */
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function poseIdentity(){return {p:[0,0,0],q:[0,0,0,1]}}
export function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(v=>v/n)}
export function qConj(q){return [-q[0],-q[1],-q[2],q[3]]}
export function qMul(a,b){const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;return [aw*bx+ax*bw+ay*bz-az*by,aw*by-ax*bz+ay*bw+az*bx,aw*bz+ax*by-ay*bx+az*bw,aw*bw-ax*bx-ay*by-az*bz]}
export function qRotate(q,v){const [x,y,z,w]=qNormalize(q),[vx,vy,vz]=v,tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)]}
export function poseInverse(p){const qi=qConj(qNormalize(p.q)),rp=qRotate(qi,p.p);return {p:rp.map(v=>-v),q:qi}}
export function poseCompose(a,b){const rb=qRotate(a.q,b.p);return {p:[a.p[0]+rb[0],a.p[1]+rb[1],a.p[2]+rb[2]],q:qNormalize(qMul(a.q,b.q))}}

/**
 * Convert image coordinates to a camera ray.
 * Room Scanner V30.16 uses a proper right-handed CV camera/world basis:
 * +X right, +Y down, +Z forward. This is related to the native
 * OpenGL/Three/WebXR camera basis (+X right,+Y up,-Z forward) by a 180°
 * rotation around X, not by a reflection. Image +v is therefore +Y.
 */
export function pixelRay(K,u,v){const d=[(u-K.cx)/K.fx,(v-K.cy)/K.fy,1],n=Math.hypot(...d)||1;return d.map(x=>x/n)}
export function worldRay(obs){const d=qRotate(obs.pose.q,pixelRay(obs.K,obs.u,obs.v));return {o:[...obs.pose.p],d}}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]}
function scale(a,s){return [a[0]*s,a[1]*s,a[2]*s]}

/** Closest-point triangulation for two calibrated camera rays. */
export function triangulateRays(a,b,{minAngleRad=.003,maxGapM=.20}={}){const A=worldRay(a),B=worldRay(b),r=sub(A.o,B.o),aa=dot(A.d,A.d),bb=dot(A.d,B.d),cc=dot(B.d,B.d),dd=dot(A.d,r),ee=dot(B.d,r),den=aa*cc-bb*bb;if(Math.abs(den)<1e-9)return {ok:false,reason:'rays nearly parallel'};const s=(bb*ee-cc*dd)/den,t=(aa*ee-bb*dd)/den,pa=add(A.o,scale(A.d,s)),pb=add(B.o,scale(B.d,t)),gap=Math.hypot(...sub(pa,pb)),cos=clamp(dot(A.d,B.d)/(Math.sqrt(aa*cc)||1),-1,1),angle=Math.acos(cos);if(angle<minAngleRad)return {ok:false,reason:'parallax too small',angle,gap};if(gap>maxGapM)return {ok:false,reason:'ray gap too large',angle,gap};return {ok:true,p:scale(add(pa,pb),.5),angle,gap,depthA:s,depthB:t};}

/** Project a world point in the +X-right,+Y-down,+Z-forward CV basis. */
export function projectPoint(pose,K,point){const inv=poseInverse(pose),rel=[point[0]-pose.p[0],point[1]-pose.p[1],point[2]-pose.p[2]],c=qRotate(inv.q,rel);if(c[2]<=1e-6)return null;return {u:K.fx*c[0]/c[2]+K.cx,v:K.fy*c[1]/c[2]+K.cy,z:c[2]}}

export function poseDistance(a,b){return Math.hypot(a.p[0]-b.p[0],a.p[1]-b.p[1],a.p[2]-b.p[2])}
