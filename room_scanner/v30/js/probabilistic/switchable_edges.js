import {projectPoint} from '../slam/math.js?v=30.39.2';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Switch variables for whole RGB edges.
 *
 * A few wrong feature matches inside a good pair are handled by robust losses.
 * A wrong pair of photographs is more dangerous, so every pair has a second
 * switch s_ij in [0,1].  It is driven by visual prior, rotation consistency and
 * shared-landmark reprojection support.  No edge is hard-deleted by RANSAC.
 */
export class SwitchablePhotoEdgeModel{
  constructor(photoEdges=[],{rotationSigmaRad=.055,reprojectionSigmaPx=2.2,minPrior=.03}={}){this.rotationSigmaRad=rotationSigmaRad;this.reprojectionSigmaPx=reprojectionSigmaPx;this.minPrior=minPrior;this.edges=(photoEdges||[]).map((e,k)=>({...e,_key:k,switch:clamp(Number(e.switch??e.visualConfidence??e.weight??.25),.01,.995)}));this.byPair=new Map();this.byFrame=new Map();this.reindex();}
  reindex(){this.byPair.clear();this.byFrame.clear();for(const e of this.edges){const a=String(e.aId??e.a),b=String(e.bId??e.b),k=pairKey(a,b);this.byPair.set(k,e);for(const id of [a,b]){const x=this.byFrame.get(id)||[];x.push(e);this.byFrame.set(id,x);}}}
  update(frames,landmarks){const fm=new Map((frames||[]).map((f,i)=>[String(f.frameId),{f,i}]));for(const e of this.edges){const aId=String(e.aId??e.a),bId=String(e.bId??e.b),A=fm.get(aId)?.f,B=fm.get(bId)?.f;if(!A||!B){e.switch=Math.min(e.switch,.08);continue;}const rotErr=rotationResidualRad(A.poseEstimate||A.posePrior,B.poseEstimate||B.posePrior,e.rotationBToA),shared=sharedLandmarkResidual(aId,bId,A,B,landmarks),prior=clamp(Number(e.visualConfidence??e.weight??.15),this.minPrior,.995),matchSupport=clamp(Math.log1p((e.matches?.length||e.inliers||0))/Math.log(30),.10,1),rotLike=Math.exp(-.5*(rotErr/this.rotationSigmaRad)**2),landLike=shared.count?Math.exp(-.5*(shared.median/this.reprojectionSigmaPx)**2):.58;const likelihood=clamp(rotLike*(.22+.78*landLike)*(.28+.72*matchSupport),.0005,.9995),po=prior/(1-prior),odds=po*likelihood/Math.max(.02,1-likelihood),post=odds/(1+odds);e.switch=clamp(.15*e.switch+.85*post,.002,.998);e.rotationResidualRad=rotErr;e.sharedLandmarks=shared.count;e.sharedReprojectionPx=shared.median;e.posterior=e.switch;}return this.stats();}
  pairWeight(a,b){return this.byPair.get(pairKey(String(a),String(b)))?.switch??.42;}
  incidentWeight(frameId){const a=this.byFrame.get(String(frameId))||[];if(!a.length)return .45;return clamp(a.reduce((s,e)=>s+e.switch,0)/a.length,.02,1);}
  measurementSupport(landmark,frameId){const others=(landmark?.measurements||[]).map(m=>String(m.frameId)).filter(x=>x!==String(frameId));if(!others.length)return .45;let best=.05;for(const j of others)best=Math.max(best,this.pairWeight(frameId,j));return best;}
  factorsForFrame(frameId){const id=String(frameId),out=[];for(const e of this.byFrame.get(id)||[]){const a=String(e.aId??e.a),b=String(e.bId??e.b);out.push({edge:e,other:a===id?b:a,weight:e.switch});}return out;}
  serialize(){return {format:'ROOMSCAN-SWITCHABLE-RGB-EDGES-1',edges:this.edges.map(e=>({aId:String(e.aId??e.a),bId:String(e.bId??e.b),switch:e.switch,visualConfidence:e.visualConfidence??e.weight??null,rotationResidualRad:e.rotationResidualRad??null,sharedLandmarks:e.sharedLandmarks||0,sharedReprojectionPx:e.sharedReprojectionPx??null}))};}
  restore(state){const by=new Map((state?.edges||[]).map(e=>[pairKey(String(e.aId),String(e.bId)),e]));for(const e of this.edges){const x=by.get(pairKey(String(e.aId??e.a),String(e.bId??e.b)));if(!x)continue;e.switch=clamp(Number(x.switch??e.switch),.002,.998);if(Number.isFinite(+x.rotationResidualRad))e.rotationResidualRad=+x.rotationResidualRad;if(Number.isFinite(+x.sharedReprojectionPx))e.sharedReprojectionPx=+x.sharedReprojectionPx;if(Number.isFinite(+x.sharedLandmarks))e.sharedLandmarks=+x.sharedLandmarks;}return this;}
  stats(){const s=this.edges.map(e=>e.switch);return {edges:s.length,active:s.filter(x=>x>.55).length,weak:s.filter(x=>x<=.55&&x>.15).length,rejected:s.filter(x=>x<=.15).length,mean:s.length?s.reduce((a,b)=>a+b,0)/s.length:0};}
}

export function rotationResidualVector(poseA,poseB,Robs){if(!poseA?.q||!poseB?.q||!Array.isArray(Robs)||Robs.length!==9)return [0,0,0];const RA=qMat(poseA.q),RB=qMat(poseB.q),pred=mul3(transpose3(RA),RB),delta=mul3(transpose3(Robs),pred);return rotationLog(delta);}
export function rotationResidualRad(poseA,poseB,Robs){return Math.hypot(...rotationResidualVector(poseA,poseB,Robs));}

function sharedLandmarkResidual(aId,bId,A,B,landmarks){const errs=[];for(const l of landmarks||[]){let ma=null,mb=null;for(const m of l.measurements||[]){if(String(m.frameId)===aId)ma=m;else if(String(m.frameId)===bId)mb=m;}if(!ma||!mb)continue;const qa=projectPoint(A.poseEstimate||A.posePrior,A.K,l.point),qb=projectPoint(B.poseEstimate||B.posePrior,B.K,l.point);if(!qa||!qb)continue;const ea=Math.hypot(qa.u-ma.u,qa.v-ma.v),eb=Math.hypot(qb.u-mb.u,qb.v-mb.v);if(Number.isFinite(ea+eb))errs.push(.5*(ea+eb));}return {count:errs.length,median:errs.length?median(errs):Infinity};}
function qMat(q){const n=Math.hypot(...q)||1,x=q[0]/n,y=q[1]/n,z=q[2]/n,w=q[3]/n,xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];}
function transpose3(A){return [A[0],A[3],A[6],A[1],A[4],A[7],A[2],A[5],A[8]];}
function mul3(A,B){const C=new Array(9);for(let r=0;r<3;r++)for(let c=0;c<3;c++)C[r*3+c]=A[r*3]*B[c]+A[r*3+1]*B[3+c]+A[r*3+2]*B[6+c];return C;}
function rotationLog(R){const c=clamp((R[0]+R[4]+R[8]-1)/2,-1,1),a=Math.acos(c);if(a<1e-7)return [(R[7]-R[5])*.5,(R[2]-R[6])*.5,(R[3]-R[1])*.5];const s=2*Math.sin(a),k=a/Math.max(1e-9,s);return [(R[7]-R[5])*k,(R[2]-R[6])*k,(R[3]-R[1])*k];}
function pairKey(a,b){return a<b?`${a}|${b}`:`${b}|${a}`;}
function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return Infinity;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
