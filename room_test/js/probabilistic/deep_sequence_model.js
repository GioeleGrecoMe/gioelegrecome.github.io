import {calibrateRelativeDepth} from '../dense/deep_metric.js';

/**
 * Sequence-level probabilistic calibration of relative monocular depth.
 * Per-frame fits are measurements of a latent transform; they are not allowed
 * to redefine room scale independently on every image.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-8;
export class DeepSequenceModel{
  constructor({minAnchors=5,minCells=3,forget=.985,maxLocalCorrection=0}={}){this.minAnchors=minAnchors;this.minCells=minCells;this.forget=forget;this.maxLocalCorrection=maxLocalCorrection;this.modes=new Map();this.frames=0;this.activeMode=null;this.last=null;}
  calibrate(args){
    const seeds=(args.sparseSeeds||[]).map((s,i)=>({...s,confidence:probWeight(s),__i:i}));
    const train=seeds.filter((_,i)=>i%4!==0),hold=seeds.filter((_,i)=>i%4===0);
    const fitSeeds=train.length>=Math.max(4,this.minAnchors)?train:seeds;
    // Permit a broad fit; uncertainty rather than a hard residual threshold will
    // decide how much authority the result gets downstream.
    const base=calibrateRelativeDepth({...args,sparseSeeds:fitSeeds,minAnchors:Math.min(this.minAnchors,fitSeeds.length),minCells:this.minCells,maxMedianRelativeError:.48});
    if(!base.ok){this.last={ok:false,reason:base.reason,anchorCount:base.anchorCount||seeds.length};return this.last;}
    const holdError=hold.length?evaluateModel(base,hold,args):base.medianRelativeError;
    const fitError=Number.isFinite(holdError)?Math.max(.004,holdError):Math.max(.01,base.medianRelativeError||.2),effective=seeds.reduce((n,s)=>n+probWeight(s),0),evidence=Math.max(.05,effective/Math.max(1,seeds.length))*Math.max(1,Math.min(30,effective))/(fitError*fitError+.0025);
    for(const st of this.modes.values())st.weight*=this.forget;
    let st=this.modes.get(base.mode);if(!st)st={mode:base.mode,a:base.a,b:base.b,weight:0,error:.3,variance:.3,frames:0};
    const priorW=st.weight,alpha=evidence/(evidence+priorW+1e-9),oldA=st.a,oldB=st.b;
    st.a=priorW>0?oldA+(base.a-oldA)*alpha:base.a;st.b=priorW>0?oldB+(base.b-oldB)*alpha:base.b;st.weight=Math.min(1e6,priorW+evidence);st.error=priorW>0?st.error+(fitError-st.error)*Math.min(.35,alpha):fitError;const drift=normalizedParamDrift(base,st);st.variance=priorW>0?st.variance*.88+.12*(fitError*fitError+drift*drift):fitError*fitError;st.frames++;this.modes.set(base.mode,st);this.frames++;
    this.activeMode=chooseMode(this.modes,this.activeMode);const active=this.modes.get(this.activeMode)||st;
    const depth=renderMetricDepth(active,args.rawDepth,args.rawWidth,args.rawHeight,args.outWidth,args.outHeight,args.near,args.far),valid=depth.valid;
    const relSigma=new Float32Array(depth.depth.length),sequenceSigma=clamp(Math.sqrt(Math.max(.0004,active.variance))+.35*active.error,.025,.45);for(let i=0;i<relSigma.length;i++)if(depth.depth[i]>0)relSigma[i]=sequenceSigma;
    const modeAgreement=base.mode===this.activeMode?1:.28,posteriorConfidence=clamp(modeAgreement*Math.exp(-3.2*fitError)*Math.min(1,effective/9)*Math.min(1,valid/.75),.015,.995);
    this.last={ok:valid>.32,reason:valid>.32?'ok':'calibrated-map-mostly-invalid',depth:depth.depth,relativeSigma:relSigma,width:args.outWidth,height:args.outHeight,confidence:posteriorConfidence,posteriorConfidence,mode:this.activeMode,sequenceMode:this.activeMode,a:active.a,b:active.b,frameMode:base.mode,frameA:base.a,frameB:base.b,anchorCount:seeds.length,inliers:base.inliers,inlierRatio:base.inlierRatio,medianRelativeError:fitError,heldOutRelativeError:holdError,validRatio:valid,sequenceSigma,parameterDrift:drift,posteriorWeight:active.weight,localField:null};return this.last;
  }
  exportState(){return {format:'ROOMSCAN-DEEP-SEQUENCE-1',frames:this.frames,activeMode:this.activeMode,modes:[...this.modes.values()].map(x=>({...x})),last:this.last?{mode:this.last.mode,a:this.last.a,b:this.last.b,confidence:this.last.confidence,medianRelativeError:this.last.medianRelativeError,heldOutRelativeError:this.last.heldOutRelativeError,sequenceSigma:this.last.sequenceSigma}:null};}
  importState(s){this.frames=s?.frames||0;this.activeMode=s?.activeMode||null;this.modes=new Map((s?.modes||[]).map(x=>[x.mode,{...x}]));return this;}
}
function probWeight(s){const p=clamp(Number(s.geometryProbability??s.confidence??.1),.005,.999),rel=Math.max(.008,Number(s.relativeDepthSigma??(s.sigmaDepth/Math.max(.05,s.depth))??.25));return clamp(p/(1+8*rel),.01,1);}
function chooseMode(map,current){const score=x=>Math.log1p(x.weight)-3.5*x.error-2*Math.sqrt(Math.max(0,x.variance));let best=null;for(const x of map.values())if(!best||score(x)>score(best))best=x;if(!best)return current;if(current&&map.has(current)){const c=map.get(current);if(score(best)<score(c)+.28)return current;}return best.mode;}
function normalizedParamDrift(frame,post){const da=Math.abs(frame.a-post.a)/(Math.abs(post.a)+.05),db=Math.abs(frame.b-post.b)/(Math.abs(post.b)+.10);return .5*(da+db);}
function predict(m,raw){if(!m||!Number.isFinite(raw))return NaN;if(m.mode==='direct')return m.a*raw+m.b;if(m.mode==='inverse-raw')return m.a/Math.max(EPS,Math.abs(raw))+m.b;if(m.mode==='inverse-depth'){const q=m.a*raw+m.b;return q>EPS?1/q:NaN;}return NaN;}
function evaluateModel(m,seeds,args){const errs=[];for(const s of seeds){const x=s.u/Math.max(1,args.outWidth-1)*(args.rawWidth-1),y=s.v/Math.max(1,args.outHeight-1)*(args.rawHeight-1),raw=bilinear(args.rawDepth,args.rawWidth,args.rawHeight,x,y),z=predict(m,raw);if(z>0)errs.push(Math.abs(z-s.depth)/Math.max(.05,s.depth));}return median(errs);}
function renderMetricDepth(m,raw,rw,rh,w,h,near=0,far=Infinity){const out=new Float32Array(w*h);let n=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const r=bilinear(raw,rw,rh,x/Math.max(1,w-1)*(rw-1),y/Math.max(1,h-1)*(rh-1)),z=predict(m,r);if(Number.isFinite(z)&&z>near&&z<far){out[y*w+x]=z;n++;}}return {depth:out,valid:n/Math.max(1,out.length)};}
function bilinear(a,w,h,x,y){const x0=clamp(Math.floor(x),0,w-1),y0=clamp(Math.floor(y),0,h-1),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0;return (a[y0*w+x0]*(1-tx)+a[y0*w+x1]*tx)*(1-ty)+(a[y1*w+x0]*(1-tx)+a[y1*w+x1]*tx)*ty;}
function median(a){if(!a?.length)return Infinity;const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return Infinity;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
