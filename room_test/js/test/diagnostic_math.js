import {pixelRay,qRotate,poseInverse,projectPoint,triangulateRays,qNormalize} from '../slam/math.js?v=30.51.0';

export {pixelRay,qRotate,poseInverse,projectPoint,triangulateRays,qNormalize};
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const DEG=Math.PI/180;
export const finite=x=>Number.isFinite(Number(x));
export function median(a){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
export function quantile(a,q){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;const x=clamp(q,0,1)*(b.length-1),i=Math.floor(x),t=x-i;return b[Math.min(i,b.length-1)]*(1-t)+b[Math.min(i+1,b.length-1)]*t;}
export function mean(a){const b=(a||[]).filter(Number.isFinite);return b.length?b.reduce((s,x)=>s+x,0)/b.length:NaN;}
export function rms(a){const b=(a||[]).filter(Number.isFinite);return b.length?Math.sqrt(b.reduce((s,x)=>s+x*x,0)/b.length):NaN;}
export function norm(v){return Math.hypot(...v);}
export function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
export function add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
export function scale(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
export function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
export function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
export function normalized(v){const n=norm(v)||1;return v.map(x=>x/n);}
export function angleBetween(a,b){const na=norm(a),nb=norm(b);return na>1e-12&&nb>1e-12?Math.acos(clamp(dot(a,b)/(na*nb),-1,1)):NaN;}
export function poseRotationAngle(a,b){if(!a?.q||!b?.q)return NaN;const qa=qNormalize(a.q),qb=qNormalize(b.q),d=Math.abs(qa[0]*qb[0]+qa[1]*qb[1]+qa[2]*qb[2]+qa[3]*qb[3]);return 2*Math.acos(clamp(d,-1,1));}
export function validPose(p){return !!(p?.p?.length>=3&&p?.q?.length>=4&&p.p.every(finite)&&p.q.every(finite)&&norm(p.q)>.5);}
export function validK(K){return !!(K&&finite(K.fx)&&finite(K.fy)&&finite(K.cx)&&finite(K.cy)&&finite(K.width)&&finite(K.height)&&K.fx>1&&K.fy>1&&K.width>1&&K.height>1);}
export function worldRayFrom(frame,u,v,pose=frame?.posePrior){if(!validK(frame?.K)||!validPose(pose))return null;return {o:pose.p.slice(0,3),d:normalized(qRotate(pose.q,pixelRay(frame.K,u,v)))};}
export function epipolarPlaneResidual(frameA,frameB,m,{inversePoses=false}={}){
  let pa=frameA?.posePrior,pb=frameB?.posePrior;if(inversePoses){if(validPose(pa))pa=poseInverse(pa);if(validPose(pb))pb=poseInverse(pb);}const A=worldRayFrom(frameA,+m.aU,+m.aV,pa),B=worldRayFrom(frameB,+m.bU,+m.bV,pb);if(!A||!B)return null;const base=sub(B.o,A.o),bn=norm(base),n=cross(A.d,B.d),nn=norm(n);if(bn<1e-7||nn<1e-8)return null;const s=clamp(Math.abs(dot(scale(base,1/bn),scale(n,1/nn))),0,1),rad=Math.asin(s),f=.25*(frameA.K.fx+frameA.K.fy+frameB.K.fx+frameB.K.fy);return {rad,deg:rad/DEG,px:rad*f,baseline:bn};
}
export function bilinear(a,w,h,x,y){if(!a?.length||w<1||h<1||!finite(x)||!finite(y))return NaN;x=clamp(x,0,w-1);y=clamp(y,0,h-1);const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,v00=Number(a[y0*w+x0]),v10=Number(a[y0*w+x1]),v01=Number(a[y1*w+x0]),v11=Number(a[y1*w+x1]);if(![v00,v10,v01,v11].every(Number.isFinite))return NaN;return (v00*(1-tx)+v10*tx)*(1-ty)+(v01*(1-tx)+v11*tx)*ty;}
export function sampleDeepFactor(d,frame,u,v){if(!d?.raw?.length||!(d.cols>1&&d.rows>1)||!validK(frame?.K))return NaN;const W=frame.K.width||frame.width,H=frame.K.height||frame.height;return bilinear(d.raw,d.cols,d.rows,clamp(u/Math.max(1,W-1),0,1)*(d.cols-1),clamp(v/Math.max(1,H-1),0,1)*(d.rows-1));}
export function robustLinearFit(xs,ys,{iterations=5}={}){let rows=xs.map((x,i)=>({x:+x,y:+ys[i]})).filter(r=>finite(r.x)&&finite(r.y));if(rows.length<3)return null;let w=rows.map(()=>1),fit=null;for(let it=0;it<iterations;it++){fit=weightedLine(rows,w);if(!fit)return null;const res=rows.map(r=>r.y-(fit.a*r.x+fit.b)),med=median(res),mad=median(res.map(e=>Math.abs(e-med))),s=Math.max(1e-9,1.4826*(Number.isFinite(mad)?mad:0));w=res.map(e=>{const z=Math.abs(e-med)/(4.685*s);if(z>=1)return .01;const t=1-z*z;return Math.max(.01,t*t);});}return fit;}
function weightedLine(rows,w){let sw=0,sx=0,sy=0,sxx=0,sxy=0;for(let i=0;i<rows.length;i++){const q=Math.max(1e-9,+w[i]||0),x=rows[i].x,y=rows[i].y;sw+=q;sx+=q*x;sy+=q*y;sxx+=q*x*x;sxy+=q*x*y;}const den=sw*sxx-sx*sx;if(Math.abs(den)<1e-12)return null;const a=(sw*sxy-sx*sy)/den,b=(sy-a*sx)/sw;return {a,b};}
export function fitDepthMode(pairs,mode){if((pairs||[]).length<4)return null;const xs=[],ys=[];for(const p of pairs){const r=+p.raw,z=+p.z;if(!(finite(r)&&finite(z)&&z>.02))continue;if(mode==='direct'){xs.push(r);ys.push(z);}else if(mode==='inverse-raw'){if(Math.abs(r)<1e-9)continue;xs.push(1/Math.abs(r));ys.push(z);}else if(mode==='inverse-depth'){xs.push(r);ys.push(1/z);}}
  const line=robustLinearFit(xs,ys);if(!line)return null;const errors=[],rel=[],truth=[];for(const p of pairs){const zhat=predictDepth({mode,...line},p.raw);if(!(zhat>.01&&finite(zhat)))continue;const e=zhat-p.z;errors.push(e);rel.push(Math.abs(e)/Math.max(.05,p.z));truth.push(p.z);}if(errors.length<3)return null;const ybar=mean(truth),ssTot=truth.reduce((s,y)=>s+(y-ybar)**2,0),ssRes=errors.reduce((s,e)=>s+e*e,0);return {mode,...line,n:errors.length,rmse:rms(errors),medianRelative:median(rel),p90Relative:quantile(rel,.9),r2:ssTot>1e-12?1-ssRes/ssTot:NaN,score:median(rel)+.25*quantile(rel,.9)};}
export function predictDepth(fit,raw){if(!fit||!finite(raw))return NaN;if(fit.mode==='direct')return fit.a*raw+fit.b;if(fit.mode==='inverse-raw')return fit.a/Math.max(1e-9,Math.abs(raw))+fit.b;if(fit.mode==='inverse-depth'){const q=fit.a*raw+fit.b;return q>1e-9?1/q:NaN;}return NaN;}
export function bestDepthFit(pairs){return ['direct','inverse-raw','inverse-depth'].map(m=>fitDepthMode(pairs,m)).filter(Boolean).sort((a,b)=>a.score-b.score)[0]||null;}
export function pointFromPixelDepth(frame,u,v,z,pose=frame?.posePrior){if(!(z>.01)||!validPose(pose)||!validK(frame?.K))return null;const ray=pixelRay(frame.K,u,v),range=z/Math.max(1e-8,ray[2]),d=qRotate(pose.q,ray);return [pose.p[0]+d[0]*range,pose.p[1]+d[1]*range,pose.p[2]+d[2]*range];}
