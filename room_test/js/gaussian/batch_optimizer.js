/**
 * Post-scan Gaussian geometry optimiser.
 *
 * This is intentionally NOT a full differentiable 3DGS trainer.  The phone has
 * already done the expensive work during acquisition: Alva provided camera
 * motion, feature tracks provided metric landmarks, and Deep/MVS provided dense
 * proxy measurements.  SparseDenseFusion stores a tiny, view-diverse reservoir
 * of those 3D/ray observations per confirmed Gaussian.
 *
 * The offline/review pass solves a robust local geometry problem:
 *   1. observation term: each Gaussian centre should agree with its saved
 *      multi-view 3D measurements under their full 3x3 covariance;
 *   2. prior term: never drift far from the online information-form estimate;
 *   3. tangent-preserving plane term: nearby Gaussians with compatible normals
 *      should agree only along the surface normal.  There is deliberately NO
 *      tangential attraction, so edges/corners do not shrink into clumps.
 *
 * All updates are Jacobi-style (read old positions, write new positions), which
 * makes a visible iteration meaningful and deterministic.  The worker runs the
 * iterations in small batches so the UI can stop the process between batches.
 */

export class GaussianBatchOptimizer{
  constructor(gaussians=[],observationState=null,options={}){
    this.items=normalizeGaussians(gaussians);
    this.observations=normalizeObservationState(observationState,this.items.length);
    this.iteration=0;
    this.options={
      priorWeight:0.18,
      observationWeight:1.0,
      planeWeight:0.10,
      damping:0.68,
      maxStepRadius:0.32,
      maxNeighbors:8,
      normalDot:0.93,
      huberMahalanobis:2.7,
      ...options
    };
    this.initial=this.items.map(g=>g.p.slice());
    this.cellSize=estimateCellSize(this.items);
    this.lastStats={iteration:0,energy:null,meanStep:0,maxStep:0,observations:this.observations?.count||0,planeConstraints:0};
  }

  step(count=1){
    const n=Math.max(1,Math.min(50,count|0));
    let stats=this.lastStats;
    for(let k=0;k<n;k++)stats=this._iteration();
    return stats;
  }

  _iteration(){
    const old=this.items.map(g=>g.p.slice()),hash=buildSpatialHash(old,this.cellSize),next=new Array(this.items.length),nextCov=new Array(this.items.length);
    let energy=0,terms=0,stepSum=0,maxStep=0,planeConstraints=0,obsTerms=0;

    for(let i=0;i<this.items.length;i++){
      const g=this.items[i],p=old[i];
      // Normal equations for a 3D centre increment: H * delta = rhs.
      let H=[0,0,0,0,0,0],rhs=[0,0,0];

      // A weak online-map prior prevents an underconstrained patch from being
      // dragged by a single locally smooth neighbour plane.
      const priorCov=scaleCov(validCov(g.positionCov)?g.positionCov:isotropicCov(Math.max(g.radius*.7,this.cellSize*.22)),1/Math.max(.02,this.options.priorWeight));
      const priorInfo=invertSym3(regularizeCov(priorCov,this.cellSize*.012));
      if(priorInfo){
        H=addCov(H,priorInfo);const d=sub(this.initial[i],p);rhs=add3(rhs,mulPackedVec(priorInfo,d));
      }

      // Saved multi-view measurements are the primary geometry authority.
      const range=observationRange(this.observations,i);
      for(let oi=range.start;oi<range.end;oi++){
        const o=readObservation(this.observations,oi);if(!o)continue;
        const info=invertSym3(regularizeCov(o.covariance,this.cellSize*.008));if(!info)continue;
        const d=sub(o.p,p),m2=Math.max(0,quadPacked(info,d)),rw=huberWeight(Math.sqrt(m2),this.options.huberMahalanobis)*clamp(o.confidence,.05,1)*this.options.observationWeight;
        H=addCov(H,scaleCov(info,rw));rhs=add3(rhs,scale3(mulPackedVec(info,d),rw));
        energy+=huberLoss(Math.sqrt(m2),this.options.huberMahalanobis);terms++;obsTerms++;
      }

      // Local plane consensus regularises walls/floors without pulling points
      // tangentially.  Normal and distance gates preserve corners and occlusion
      // boundaries, where several Gaussian layers may legitimately coexist.
      const neighbours=findNeighbours(i,old,this.items,hash,this.cellSize,this.options.maxNeighbors,this.options.normalDot);
      const normal=norm(g.normal);
      for(const j of neighbours){
        const h=this.items[j],hn=alignNormal(norm(h.normal),normal),distance=Math.hypot(...sub(p,old[j])),gate=Math.max(this.cellSize*2.8,(g.radius+h.radius)*2.2);if(distance>gate)continue;
        const signed=dot(sub(p,old[j]),hn),sigma=Math.max(this.cellSize*.22,Math.sqrt(Math.max(1e-12,quadPacked(h.surfaceCov,hn))),Math.sqrt(Math.max(1e-12,quadPacked(h.positionCov,hn))));
        const z=Math.abs(signed)/sigma;if(z>3.5)continue;const robust=huberWeight(z,2.2),support=Math.min(1,Math.sqrt(Math.max(1,g.support*h.support))/4),w=this.options.planeWeight*robust*(.35+.65*support)/(sigma*sigma);
        H=addCov(H,scaleCov(outerPacked(hn),w));rhs=add3(rhs,scale3(hn,-w*signed));energy+=this.options.planeWeight*huberLoss(z,2.2);terms++;planeConstraints++;
      }

      const Hreg=regularizeCov(H,this.cellSize*.006),inv=invertSym3(Hreg);let delta=inv?mulPackedVec(inv,rhs):[0,0,0];
      const maxAllowed=Math.max(this.cellSize*.04,g.radius*this.options.maxStepRadius),dn=Math.hypot(...delta);if(dn>maxAllowed)delta=scale3(delta,maxAllowed/dn);delta=scale3(delta,this.options.damping);
      next[i]=add3(p,delta);nextCov[i]=inv?regularizeCov(inv,this.cellSize*.006):g.positionCov;const ds=Math.hypot(...delta);stepSum+=ds;maxStep=Math.max(maxStep,ds);
    }

    // Commit simultaneously and update only the normal thickness of the
    // physical splat. Tangential footprint stays intact, so repeated iterations
    // sharpen a plane rather than shrinking its image coverage.
    for(let i=0;i<this.items.length;i++){
      const g=this.items[i];g.p=next[i];g.positionCov=nextCov[i];g.surfaceCov=sharpenNormalVariance(g.surfaceCov,g.normal,g.positionCov,g.radius,this.cellSize);g.positionSigma=Math.sqrt(Math.max(1e-12,traceCov(g.positionCov)/3));
    }
    this.iteration++;
    return this.lastStats={iteration:this.iteration,energy:terms?energy/terms:0,meanStep:this.items.length?stepSum/this.items.length:0,maxStep,observations:obsTerms,planeConstraints};
  }

  snapshot({max=null}={}){
    const list=max&&this.items.length>max?rankedSubset(this.items,max):this.items;
    return list.map(g=>({
      ...g.extra,
      position:g.p.slice(),normal:g.normal.slice(),color:g.color.slice(),scale:scalesFromCov(g.surfaceCov,g.normal),
      covariance:g.surfaceCov.slice(),positionCovariance:g.positionCov.slice(),opacity:g.opacity,confidence:g.confidence,support:g.support,
      positionSigma:g.positionSigma,radius:g.radius
    }));
  }
}

export function normalizeObservationState(x,count){
  if(!x?.offsets||!x?.data)return null;
  const offsets=toUint32(x.offsets),data=toFloat32(x.data),stride=Math.max(13,Number(x.stride)||13);if(offsets.length<count+1||data.length<stride*(Number(x.count)||0))return null;
  return {offsets,data,stride,count:Number(x.count)||Math.floor(data.length/stride)};
}

function normalizeGaussians(items){
  return (items||[]).map((g,index)=>{
    const p=arr3(g.position||g.p||g.mean||g.xyz,[0,0,0]),normal=norm(arr3(g.normal||g.n,[0,0,-1])),scale=arr3(g.scale||g.scales,[g.radius||.02,g.radius||.02,g.radius||.02]).map(x=>Math.max(1e-5,Math.abs(x))),radius=Math.max(...scale),surfaceCov=validCov(g.covariance)?g.covariance.slice(0,6).map(Number):isotropicCov(radius*.72),positionCov=validCov(g.positionCovariance)?g.positionCovariance.slice(0,6).map(Number):isotropicCov(Math.max(radius*.65,.002));
    return {index,p,normal,color:arr3(g.color||g.rgb,[180,210,240]),surfaceCov:regularizeCov(surfaceCov,1e-6),positionCov:regularizeCov(positionCov,1e-6),radius,opacity:clamp(Number(g.opacity??g.alpha??.7),.02,1),confidence:clamp(Number(g.confidence??.6),.02,1),support:Math.max(1,Number(g.support)||1),positionSigma:Math.sqrt(Math.max(1e-12,traceCov(positionCov)/3)),extra:stripGeometry(g)};
  }).filter(g=>finite3(g.p));
}
function stripGeometry(g){const out={...g};for(const k of ['position','p','mean','xyz','normal','n','color','rgb','scale','scales','covariance','positionCovariance','radius','opacity','alpha','confidence','support','positionSigma'])delete out[k];return out;}
function observationRange(obs,i){if(!obs)return {start:0,end:0};return {start:obs.offsets[i]||0,end:obs.offsets[i+1]||obs.offsets[i]||0};}
function readObservation(obs,index){const k=index*obs.stride,a=obs.data;if(k+12>=a.length)return null;const origin=[a[k],a[k+1],a[k+2]],p=[a[k+3],a[k+4],a[k+5]],covariance=[a[k+6],a[k+7],a[k+8],a[k+9],a[k+10],a[k+11]],confidence=a[k+12];return finite3(origin)&&finite3(p)&&validCov(covariance)?{origin,p,covariance,confidence}:null;}

function buildSpatialHash(points,cell){const map=new Map();for(let i=0;i<points.length;i++){const p=points[i],k=cellKey(p,cell);let a=map.get(k);if(!a)map.set(k,a=[]);a.push(i);}return map;}
function findNeighbours(i,points,items,hash,cell,max,normalDot){const p=points[i],c=cellOf(p,cell),out=[];for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){for(const j of hash.get(`${c[0]+dx},${c[1]+dy},${c[2]+dz}`)||[]){if(j===i)continue;const nd=Math.abs(dot(items[i].normal,items[j].normal));if(nd<normalDot)continue;const d2=dist2(p,points[j]);out.push({j,d2});}}out.sort((a,b)=>a.d2-b.d2);return out.slice(0,max).map(x=>x.j);}
function estimateCellSize(items){if(!items.length)return .025;const xs=items.map(g=>g.radius).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b),m=xs[xs.length>>1]||.02;return Math.max(1e-4,m*2.25);}
function sharpenNormalVariance(cov,n,positionCov,radius,cell){const nn=norm(n),current=quadPacked(cov,nn),uncertainty=quadPacked(positionCov,nn),wanted=Math.max((radius*.10)**2,uncertainty*.55,(cell*.025)**2);if(!(current>wanted))return cov;return regularizeCov(addCov(cov,scaleCov(outerPacked(nn),wanted-current)),1e-7);}
function scalesFromCov(cov,n){const [t1,t2]=tangentBasis(n);return [Math.sqrt(Math.max(1e-12,quadPacked(cov,t1))),Math.sqrt(Math.max(1e-12,quadPacked(cov,t2))),Math.sqrt(Math.max(1e-12,quadPacked(cov,norm(n))))];}
function rankedSubset(items,max){const ranked=items.map((g,i)=>({i,s:2*g.support+g.confidence-.25*g.positionSigma/Math.max(1e-6,g.radius)})).sort((a,b)=>b.s-a.s).slice(0,max).map(x=>x.i).sort((a,b)=>a-b);return ranked.map(i=>items[i]);}

function toFloat32(a){return a instanceof Float32Array?a:new Float32Array(a instanceof ArrayBuffer?a:a||[]);}function toUint32(a){return a instanceof Uint32Array?a:new Uint32Array(a instanceof ArrayBuffer?a:a||[]);}
function arr3(a,fallback){const x=Array.isArray(a)||ArrayBuffer.isView(a)?a:fallback;return [Number(x[0])||0,Number(x[1])||0,Number(x[2])||0];}
function finite3(p){return p?.length>=3&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2]);}function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function cellOf(p,v){return [Math.floor(p[0]/v),Math.floor(p[1]/v),Math.floor(p[2]/v)];}function cellKey(p,v){const c=cellOf(p,v);return `${c[0]},${c[1]},${c[2]}`;}
function dist2(a,b){const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;}function add3(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function scale3(a,s){return [a[0]*s,a[1]*s,a[2]*s];}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}function norm(v){const n=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/n,v[1]/n,v[2]/n];}function alignNormal(n,ref){return dot(n,ref)<0?[-n[0],-n[1],-n[2]]:n;}
function tangentBasis(n){n=norm(n);const a=Math.abs(n[2])<.85?[0,0,1]:[0,1,0],t1=norm(cross(a,n)),t2=norm(cross(n,t1));return [t1,t2];}
function isotropicCov(s){const q=s*s;return [q,0,0,q,0,q];}function outerPacked(v){return [v[0]*v[0],v[0]*v[1],v[0]*v[2],v[1]*v[1],v[1]*v[2],v[2]*v[2]];}function validCov(c){return c?.length>=6&&[c[0],c[1],c[2],c[3],c[4],c[5]].every(Number.isFinite)&&c[0]>0&&c[3]>0&&c[5]>0;}function regularizeCov(c,j){const q=[c[0]||0,c[1]||0,c[2]||0,c[3]||0,c[4]||0,c[5]||0],e=Math.max(1e-14,j*j);q[0]+=e;q[3]+=e;q[5]+=e;return q;}function addCov(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2],a[3]+b[3],a[4]+b[4],a[5]+b[5]];}function scaleCov(a,s){return [a[0]*s,a[1]*s,a[2]*s,a[3]*s,a[4]*s,a[5]*s];}function traceCov(c){return c[0]+c[3]+c[5];}
function quadPacked(c,v){return v[0]*(c[0]*v[0]+c[1]*v[1]+c[2]*v[2])+v[1]*(c[1]*v[0]+c[3]*v[1]+c[4]*v[2])+v[2]*(c[2]*v[0]+c[4]*v[1]+c[5]*v[2]);}function mulPackedVec(c,v){return [c[0]*v[0]+c[1]*v[1]+c[2]*v[2],c[1]*v[0]+c[3]*v[1]+c[4]*v[2],c[2]*v[0]+c[4]*v[1]+c[5]*v[2]];}function invertSym3(c){const a=c[0],b=c[1],cc=c[2],d=c[3],e=c[4],f=c[5],A=d*f-e*e,B=cc*e-b*f,C=b*e-cc*d,D=a*f-cc*cc,E=b*cc-a*e,F=a*d-b*b,det=a*A+b*B+cc*C;if(!Number.isFinite(det)||Math.abs(det)<1e-22)return null;const s=1/det;return [A*s,B*s,C*s,D*s,E*s,F*s];}
function huberWeight(r,k){return r<=k?1:k/Math.max(k,r);}function huberLoss(r,k){return r<=k?.5*r*r:k*(r-.5*k);}
