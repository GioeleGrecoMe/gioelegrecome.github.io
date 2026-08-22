import {projectPoint,qMul,qNormalize} from '../slam/math.js';

/**
 * Small dependency-free iterative PnP solver.
 *
 * This is intentionally used only for the short metric bootstrap window. AlvaAR
 * remains the long-lived world tracker. The solver starts from the saved common
 * calibration pose, so a finite-difference Gauss-Newton step is sufficiently
 * stable for 3-7 well-spread calibration pins without bringing a large CV
 * dependency into the phone runtime.
 */
export function refinePosePnP({initialPose,K,observations,maxIterations=12,huberPx=10}={}){
  if(!initialPose?.p||!initialPose?.q)throw new TypeError('initial pose required');
  if(!K||![K.fx,K.fy,K.cx,K.cy].every(Number.isFinite))throw new TypeError('camera intrinsics required');
  const obs=(observations||[]).filter(o=>Array.isArray(o?.world)&&o.world.length>=3&&Number.isFinite(o.u)&&Number.isFinite(o.v));
  if(obs.length<3)return {ok:false,reason:'need-at-least-3-points',pose:clonePose(initialPose),rmsePx:Infinity,inliers:0};
  let pose=clonePose(initialPose),lambda=1e-3,lastCost=Infinity;
  for(let iter=0;iter<maxIterations;iter++){
    const base=residuals(pose,K,obs,huberPx);if(!base.valid)return {ok:false,reason:'points-behind-camera',pose,rmsePx:Infinity,inliers:0};
    const J=numericJacobian(pose,K,obs,base.raw);
    const {A,b}=normalEquations(J,base.weighted,base.weights,lambda);
    const dx=solveLinear(A,b.map(v=>-v));
    if(!dx)return {ok:false,reason:'singular-normal-equations',pose,rmsePx:base.rmsePx,inliers:base.inliers};
    const stepNorm=Math.hypot(...dx);if(!Number.isFinite(stepNorm))return {ok:false,reason:'non-finite-step',pose,rmsePx:base.rmsePx,inliers:base.inliers};
    const candidate=applyIncrement(pose,dx),next=residuals(candidate,K,obs,huberPx);
    if(next.valid&&next.cost<=base.cost){pose=candidate;lastCost=next.cost;lambda=Math.max(1e-6,lambda*.45);if(stepNorm<1e-6)break;}
    else{lambda=Math.min(1e3,lambda*5);if(lambda>=1e3&&base.cost>=lastCost)break;}
  }
  const out=residuals(pose,K,obs,huberPx);
  const ok=out.valid&&out.inliers>=3&&Number.isFinite(out.rmsePx);
  return {ok,reason:ok?null:'high-reprojection-error',pose,rmsePx:out.rmsePx,inliers:out.inliers,cost:out.cost};
}

function residuals(pose,K,obs,huberPx){
  const raw=[],weights=[];let sq=0,inliers=0,cost=0;
  for(const o of obs){
    const pr=projectPoint(pose,K,o.world);if(!pr)return {valid:false,raw:[],weighted:[],weights:[],rmsePx:Infinity,inliers:0,cost:Infinity};
    const du=pr.u-o.u,dv=pr.v-o.v,e=Math.hypot(du,dv),w=e<=huberPx?1:huberPx/Math.max(huberPx,e);
    raw.push(du,dv);weights.push(w,w);sq+=du*du+dv*dv;cost+=w*(du*du+dv*dv);if(e<=huberPx*1.5)inliers++;
  }
  return {valid:true,raw,weighted:raw.map((v,i)=>v*Math.sqrt(weights[i])),weights,rmsePx:Math.sqrt(sq/(obs.length*2)),inliers,cost};
}
function numericJacobian(pose,K,obs,baseRaw){
  const eps=[1e-4,1e-4,1e-4,2e-4,2e-4,2e-4],rows=baseRaw.length,J=Array.from({length:rows},()=>Array(6).fill(0));
  for(let j=0;j<6;j++){
    const d=Array(6).fill(0);d[j]=eps[j];const p=applyIncrement(pose,d),r=residuals(p,K,obs,1e9);if(!r.valid)continue;
    for(let i=0;i<rows;i++)J[i][j]=(r.raw[i]-baseRaw[i])/eps[j];
  }
  return J;
}
function normalEquations(J,weighted,weights,lambda){
  const n=6,A=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);
  for(let i=0;i<J.length;i++){
    const sw=Math.sqrt(weights[i]||1),r=weighted[i];
    for(let a=0;a<n;a++){const ja=J[i][a]*sw;b[a]+=ja*r;for(let c=0;c<n;c++)A[a][c]+=ja*J[i][c]*sw;}
  }
  for(let i=0;i<n;i++)A[i][i]+=lambda;
  return {A,b};
}
function solveLinear(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[pivot][c]))pivot=r;
    if(Math.abs(M[pivot][c])<1e-11)return null;[M[c],M[pivot]]=[M[pivot],M[c]];
    const inv=1/M[c][c];for(let k=c;k<=n;k++)M[c][k]*=inv;
    for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];if(!f)continue;for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}
  }
  return M.map(r=>r[n]);
}
function applyIncrement(pose,d){
  const angle=Math.hypot(d[3],d[4],d[5]);let dq=[0,0,0,1];
  if(angle>1e-12){const s=Math.sin(angle/2)/angle;dq=[d[3]*s,d[4]*s,d[5]*s,Math.cos(angle/2)];}
  return {p:[pose.p[0]+d[0],pose.p[1]+d[1],pose.p[2]+d[2]],q:qNormalize(qMul(dq,pose.q))};
}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:qNormalize(p.q.slice(0,4).map(Number))};}
