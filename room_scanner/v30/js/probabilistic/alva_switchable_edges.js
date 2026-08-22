import {qMul,qConj,qNormalize,qRotate} from '../slam/math.js?v=30.52.0';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Relative Alva priors with independent translation/rotation authority.
 * Absolute Alva poses initialise the trajectory; optimisation is driven mostly by
 * relative increments, each with a posterior switch that can collapse when RGB
 * geometry consistently contradicts the tracker.
 */
export class SwitchableAlvaEdgeModel{
  constructor(frames,{translationSigma=0.055,rotationSigmaRad=0.035,minPrior=.04,factors=null}={}){
    this.translationSigma=translationSigma;this.rotationSigmaRad=rotationSigmaRad;this.minPrior=minPrior;
    this.edges=[];this.byFrame=new Map();if(factors?.length)this.importFactors(factors);else this.rebuild(frames||[]);
  }
  importFactors(factors){this.edges=[];this.byFrame=new Map();for(const x of factors||[]){if(!x?.relativePose?.p||!x?.relativePose?.q)continue;const prior=clamp(Number(x.priorConfidence??x.prior??.5),this.minPrior,.995),legacyUnit=!x.switchInitializedFromPrior&&Number(x.translationSwitch)>=.999&&Number(x.rotationSwitch)>=.999,seedT=legacyUnit?prior:Number(x.translationSwitch??prior),seedR=legacyUnit?prior:Number(x.rotationSwitch??prior),seedS=legacyUnit?prior:Number(x.switch??Math.sqrt(seedT*seedR)),e={aId:String(x.aId),bId:String(x.bId),observed:{p:x.relativePose.p.slice(0,3).map(Number),q:qNormalize(x.relativePose.q.slice(0,4).map(Number))},prior,switch:clamp(seedS,.003,.998),translationSwitch:clamp(seedT,.003,.998),rotationSwitch:clamp(seedR,.003,.998)};this.edges.push(e);for(const id of [e.aId,e.bId]){const q=this.byFrame.get(id)||[];q.push(e);this.byFrame.set(id,q);}}return this;}
  rebuild(frames){this.edges=[];this.byFrame=new Map();for(let i=1;i<frames.length;i++){const a=frames[i-1],b=frames[i];if(!a?.posePrior||!b?.posePrior)continue;const observed=relativePose(a.posePrior,b.posePrior),qa=poseQuality(a),qb=poseQuality(b),prior=clamp(Math.sqrt(qa*qb),this.minPrior,.995),e={aId:String(a.frameId),bId:String(b.frameId),observed,prior,switch:prior,translationSwitch:prior,rotationSwitch:prior,trackingModeA:a.trackingMode||null,trackingModeB:b.trackingMode||null};this.edges.push(e);for(const id of [e.aId,e.bId]){const q=this.byFrame.get(id)||[];q.push(e);this.byFrame.set(id,q);}}return this;}
  update(frames,{rgbFrameSupport=null,poseImprovement=null,translationContradiction=null}={}){const fm=new Map((frames||[]).map(f=>[String(f.frameId),f]));for(const e of this.edges){const A=fm.get(e.aId),B=fm.get(e.bId);if(!A||!B){e.switch=.01;continue;}const pred=relativePose(A.poseEstimate||A.posePrior,B.poseEstimate||B.posePrior),r=relativeResidual(e.observed,pred),re=Math.hypot(r[3],r[4],r[5]),cmp=translationComparison(e.observed.p,pred.p),rgb=Math.sqrt(frameMapValue(rgbFrameSupport,e.aId,.6)*frameMapValue(rgbFrameSupport,e.bId,.6)),imp=.5*(frameMapValue(poseImprovement,e.aId,0)+frameMapValue(poseImprovement,e.bId,0)),photoContradiction=Math.sqrt(frameMapValue(translationContradiction,e.aId,0)*frameMapValue(translationContradiction,e.bId,0));
      // Alva translation magnitude is monocular and may drift.  Direction remains
      // useful; local scale is only a weak likelihood term.  Independent photo
      // bearing contradiction can collapse translation authority even when the
      // whole RGB switch is already low. Rotation remains separately trusted.
      const dirLike=Math.exp(-.5*(cmp.angleRad/.16)**2),scaleLike=Math.exp(-.5*(cmp.logScale/.55)**2),
        // Direction is the stable monocular signal, but it must not keep an
        // edge authoritative through a multi-fold baseline jump. Such a jump
        // means the pose proposal is no longer compatible with the observation
        // made when this MVS evidence was captured. Small scale drift remains
        // weakly tolerated; a 3–4× discontinuity collapses translation only.
        tLike=dirLike*scaleLike,rLike=Math.exp(-.5*(re/this.rotationSigmaRad)**2),legacyContradiction=clamp(imp*rgb,0,.95),tContradiction=clamp(Math.max(legacyContradiction,photoContradiction),0,.98),rContradiction=clamp(legacyContradiction,0,.80),tPost=bayesSwitch(e.prior,tLike*(1-.86*tContradiction)),rPost=bayesSwitch(e.prior,rLike*(1-.35*rContradiction));e.translationSwitch=clamp(.25*e.translationSwitch+.75*tPost,.003,.998);e.rotationSwitch=clamp(.25*e.rotationSwitch+.75*rPost,.003,.998);e.switch=Math.sqrt(e.translationSwitch*e.rotationSwitch);e.translationResidual=cmp.perpendicularResidual;e.translationDirectionResidualRad=cmp.angleRad;e.translationScaleRatio=cmp.scaleRatio;e.rotationResidualRad=re;e.rgbSupport=rgb;e.poseImprovement=imp;e.photoTranslationContradiction=photoContradiction;}return this.stats();}
  factorsForFrame(frameId){const id=String(frameId),out=[];for(const e of this.byFrame.get(id)||[]){out.push({edge:e,other:e.aId===id?e.bId:e.aId,sign:e.bId===id?1:-1,translationWeight:e.translationSwitch,rotationWeight:e.rotationSwitch});}return out;}
  frameConfidence(frameId){const a=this.byFrame.get(String(frameId))||[];if(!a.length)return .42;return clamp(a.reduce((s,e)=>s+e.switch,0)/a.length,.01,1);}
  stats(){const a=this.edges;return {edges:a.length,active:a.filter(e=>e.switch>.55).length,weak:a.filter(e=>e.switch<=.55&&e.switch>.15).length,rejected:a.filter(e=>e.switch<=.15).length,mean:a.length?a.reduce((s,e)=>s+e.switch,0)/a.length:0,translationMean:a.length?a.reduce((s,e)=>s+e.translationSwitch,0)/a.length:0,rotationMean:a.length?a.reduce((s,e)=>s+e.rotationSwitch,0)/a.length:0};}
  serialize(){return {format:'ROOMSCAN-SWITCHABLE-ALVA-1',edges:this.edges.map(e=>({aId:e.aId,bId:e.bId,switch:e.switch,translationSwitch:e.translationSwitch,rotationSwitch:e.rotationSwitch,translationResidual:e.translationResidual??null,rotationResidualRad:e.rotationResidualRad??null,prior:e.prior}))};}
  restore(state){const by=new Map((state?.edges||[]).map(e=>[pairKey(String(e.aId),String(e.bId)),e]));for(const e of this.edges){const x=by.get(pairKey(e.aId,e.bId));if(!x)continue;e.switch=clamp(Number(x.switch??e.switch),.003,.998);e.translationSwitch=clamp(Number(x.translationSwitch??e.translationSwitch),.003,.998);e.rotationSwitch=clamp(Number(x.rotationSwitch??e.rotationSwitch),.003,.998);if(Number.isFinite(+x.translationResidual))e.translationResidual=+x.translationResidual;if(Number.isFinite(+x.rotationResidualRad))e.rotationResidualRad=+x.rotationResidualRad;}return this;}
}

export function relativePose(a,b){const qi=qConj(qNormalize(a.q)),dq=qNormalize(qMul(qi,qNormalize(b.q))),d=[b.p[0]-a.p[0],b.p[1]-a.p[1],b.p[2]-a.p[2]],p=qRotate(qi,d);return {p,q:dq};}
export function relativeResidual(obs,pred){const dp=[pred.p[0]-obs.p[0],pred.p[1]-obs.p[1],pred.p[2]-obs.p[2]],dq=qNormalize(qMul(qConj(obs.q),pred.q)),q=dq[3]<0?dq.map(x=>-x):dq,sv=Math.hypot(q[0],q[1],q[2]);let rv=[0,0,0];if(sv>1e-12){const ang=2*Math.atan2(sv,Math.max(1e-12,q[3])),k=ang/sv;rv=[q[0]*k,q[1]*k,q[2]*k];}return [...dp,...rv];}
function translationComparison(obs,pred){const on=Math.hypot(...(obs||[])),pn=Math.hypot(...(pred||[]));if(!(on>1e-8&&pn>1e-8))return {angleRad:Math.PI/2,scaleRatio:1,logScale:0,perpendicularResidual:Infinity};const ou=obs.map(x=>x/on),pu=pred.map(x=>x/pn),c=clamp(ou[0]*pu[0]+ou[1]*pu[1]+ou[2]*pu[2],-1,1),angleRad=Math.acos(c),scaleRatio=pn/on,logScale=Math.abs(Math.log(Math.max(1e-6,scaleRatio))),perpendicularResidual=pn*Math.sqrt(Math.max(0,2*(1-c)));return {angleRad,scaleRatio,logScale,perpendicularResidual};}
function poseQuality(f){const d=f?.poseCov?.diag||[],t=Math.sqrt(Math.max(0,(+d[0]||0)+(+d[1]||0)+(+d[2]||0))),r=Math.sqrt(Math.max(0,(+d[3]||0)+(+d[4]||0)+(+d[5]||0)));const track=String(f?.trackingMode||'').toLowerCase();let q=1/(1+10*t+35*r);if(track.includes('lost'))q*=.03;else if(track.includes('relocal'))q*=.55;else if(track.includes('init'))q*=.45;return clamp(q,.02,.99);}
function bayesSwitch(prior,like){prior=clamp(prior,.001,.999);like=clamp(like,.0005,.9995);const odds=prior/(1-prior)*like/Math.max(.03,1-like);return odds/(1+odds);}
function frameMapValue(m,k,d){if(!m)return d;if(m instanceof Map)return Number(m.get(String(k))??d);return Number(m[String(k)]??d);}

function pairKey(a,b){return a<b?`${a}|${b}`:`${b}|${a}`;}
