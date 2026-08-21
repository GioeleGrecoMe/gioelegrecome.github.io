import {projectPoint} from '../slam/math.js?v=30.41.0';
import {assessDepthCalibrationObservability} from './depth_observability.js?v=30.41.0';

const EPS=1e-10;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Hierarchical monocular-depth calibration.
 *
 * Geometry owns scale.  Depth Anything contributes a dense ordinal/inverse-depth
 * field that is calibrated only against sparse multi-view landmarks.  Per-frame
 * freedom is deliberately restricted by observability:
 *   rho = a_i * F_gamma(d) + b_i
 * where F_gamma is one low-order, monotone response shared by the whole scan.
 * Frames dominated by one depth layer do not get to invent both a_i and b_i.
 */
export function solveHierarchicalDepthCalibration({frames=[],landmarks=[],deepFactors=[],previous=null,frameReliability=null,iterations=8,minGlobalFrames=5,minGlobalAnchors=40,temporalSigmaA=.10,temporalSigmaB=.035,freezeDomain=true}={}){
  const deepMap=new Map((deepFactors||[]).map(d=>[String(d.frameId),d])),frameMap=new Map((frames||[]).map((f,i)=>[String(f.frameId),i])),anchorsByFrame=Array.from({length:frames.length},()=>[]),allRaw=[];
  for(const l of landmarks||[]){
    if(!finite3(l?.point))continue;const lp=prob(l.probability),relSigma=Math.max(.004,Number(l.relativeDepthSigma)||.12),covPenalty=Math.max(.25,Math.min(1,1/(1+covTrace(l.covariance)*35)));
    for(const m of l.measurements||[]){const fi=frameMap.get(String(m.frameId)),f=frames[fi],d=deepMap.get(String(m.frameId));if(fi==null||!f||!d?.raw?.length)continue;const q=projectPoint(f.poseEstimate||f.posePrior,f.K,l.point);if(!q||!(q.z>.05))continue;const raw=sampleDeepGrid(d,m.u,m.v,f.K.width||f.width,f.K.height||f.height);if(!Number.isFinite(raw))continue;const rho=1/q.z,sigmaRho=Math.max(1e-5,rho*relSigma),frameRel=frameReliability instanceof Map?Number(frameReliability.get(String(m.frameId))??.6):Number(frameReliability?.[String(m.frameId)]??.6),w=clamp(deepQualityWeight(d)*clamp(frameRel,.03,1)*lp*prob(m.probability)*covPenalty/(sigmaRho*sigmaRho),.005,4e4);const a={raw,rho,w,u:+m.u,v:+m.v,z:q.z,sigmaRho,landmarkId:l.id||null};anchorsByFrame[fi].push(a);allRaw.push(raw);}
  }
  // The affine per-frame parameters live in the coordinate system defined by
  // `domain`. Re-estimating that normalization on every local window silently
  // changes the meaning of every previously learned (a_i,b_i), which was a
  // major source of the large Deep-error oscillations observed in V30.40.
  // During live/local updates the domain is therefore frozen once established.
  // A committed full-graph rebuild starts from previous=null and estimates one
  // fresh session-wide domain from all available Deep anchors.
  const domain=normalizationDomain(allRaw,previous?.domain,{freeze:freezeDomain}),states=new Array(frames.length).fill(null),prevMap=new Map((previous?.frames||[]).map(x=>[String(x.frameId),x]));
  const normalized=anchorsByFrame.map((a,i)=>a.map(p=>({...p,x:normalizeRaw(p.raw,domain)}))),observability=normalized.map((p,i)=>assessDepthCalibrationObservability(p,{width:frames[i]?.K?.width||frames[i]?.width||1,height:frames[i]?.K?.height||frames[i]?.height||1}));
  let gamma=Array.isArray(previous?.gamma)?previous.gamma.slice(0,2).map(Number):[0,0];gamma=enforceMonotoneGamma(gamma);
  const seed=globalSeed(normalized,observability,gamma,prevMap,frames);
  for(let i=0;i<frames.length;i++){const old=prevMap.get(String(frames[i]?.frameId)),pred=temporalPrediction(i,states,prevMap,frames,seed);states[i]={frameId:String(frames[i]?.frameId),a:positive(old?.a??pred.a),b:Number.isFinite(+old?.b)?+old.b:pred.b,mode:observability[i].mode,observability:observability[i],confidence:.02,residualSigma:.15,relativeResidual:1,relativeResidualP90:1,anchorCount:normalized[i].length,inheritedFrom:pred.from||null};}

  for(let it=0;it<Math.max(3,iterations);it++){
    // Frame calibration comes first.  The global non-linearity sees only frames
    // that can independently support scale+shift; degenerate walls are excluded.
    for(let i=0;i<states.length;i++){
      const s=states[i],pairs=normalized[i],pred=temporalPrediction(i,states,prevMap,frames,seed),F=pairs.map(p=>({...p,f:globalResponse(p.x,gamma)}));
      if(s.mode==='full'&&pairs.length>=5){const fit=fitAffineRobust(F,pred,{sigmaA:temporalSigmaA,sigmaB:temporalSigmaB});if(fit){s.a=positive(mix(s.a,fit.a,it<2?.72:.48));s.b=mix(s.b,fit.b,it<2?.72:.48);s.dataSupport=fit.support;}}
      else if(s.mode==='shift-only'&&pairs.length>=3){s.a=positive(mix(s.a,pred.a,.65));const fit=fitShiftRobust(F,s.a,pred.b,temporalSigmaB);if(fit){s.b=mix(s.b,fit.b,.62);s.dataSupport=fit.support;}s.inheritedFrom=pred.from||s.inheritedFrom;}
      else{s.a=positive(mix(s.a,pred.a,.80));s.b=mix(s.b,pred.b,.80);s.inheritedFrom=pred.from||s.inheritedFrom;s.dataSupport=0;}
    }
    const informative=[];for(let i=0;i<states.length;i++)if(states[i].mode==='full')for(const p of normalized[i])informative.push({p,s:states[i]});
    const informativeFrames=states.filter(s=>s.mode==='full').length;
    if(informativeFrames>=minGlobalFrames&&informative.length>=minGlobalAnchors){const gfit=fitGammaRobust(informative,gamma);if(gfit){const rate=it<2?.12:.20;gamma=enforceMonotoneGamma([mix(gamma[0],gfit[0],rate),mix(gamma[1],gfit[1],rate)]);}}
  }

  let totalResidual=0,totalW=0,full=0,shift=0,inherited=0;
  for(let i=0;i<states.length;i++){
    const s=states[i],pairs=normalized[i],errs=[],relativeErrs=[];let sw=0,se=0;for(const p of pairs){const r=s.a*globalResponse(p.x,gamma)+s.b-p.rho,w=p.w*cauchyWeight(r/Math.max(p.sigmaRho,.002),2.6);if(Number.isFinite(r)){const ar=Math.abs(r);errs.push(ar);relativeErrs.push(ar/Math.max(.02,Math.abs(p.rho)));sw+=w;se+=w*r*r;}}
    const med=median(errs),mad=median(errs.map(e=>Math.abs(e-med))),sig=Math.max(.002,1.4826*(Number.isFinite(mad)?mad:.08)),relSorted=relativeErrs.filter(Number.isFinite).sort((a,b)=>a-b);s.residualSigma=clamp(sig,.002,.35);s.relativeResidual=relSorted.length?quantileSorted(relSorted,.5):Infinity;s.relativeResidualP90=relSorted.length?quantileSorted(relSorted,.9):Infinity;s.confidence=calibrationConfidence(s,pairs);s.gamma=gamma.slice();s.domain={...domain};s.observability={...s.observability};if(s.mode==='full')full++;else if(s.mode==='shift-only')shift++;else inherited++;if(sw>0){totalResidual+=se;totalW+=sw;}
  }
  const informativeFrames=states.filter(s=>s.mode==='full').length,informativeAnchors=states.reduce((n,s)=>n+(s.mode==='full'?s.anchorCount:0),0),globalNonlinearityReady=informativeFrames>=minGlobalFrames&&informativeAnchors>=minGlobalAnchors;
  const rel=states.filter(s=>s.anchorCount>0&&Number.isFinite(s.relativeResidual)).map(s=>s.relativeResidual).sort((a,b)=>a-b),relP90=states.filter(s=>s.anchorCount>0&&Number.isFinite(s.relativeResidualP90)).map(s=>s.relativeResidualP90).sort((a,b)=>a-b);return {format:'ROOMSCAN-DEPTH-CAL-HIER-1',representation:'inverse-depth',domain,gamma,globalNonlinearityReady,frames:states,frameMap:new Map(states.map((s,i)=>[String(s.frameId),i])),stats:{frames:states.length,full,shiftOnly:shift,inherited,anchors:normalized.reduce((n,a)=>n+a.length,0),informativeFrames,informativeAnchors,globalNonlinearityReady,rmsInverseDepth:totalW>0?Math.sqrt(totalResidual/totalW):Infinity,medianRelativeResidual:rel.length?quantileSorted(rel,.5):Infinity,p90RelativeResidual:relP90.length?quantileSorted(relP90,.9):Infinity,minDerivative:minResponseDerivative(gamma)}};
}

export function predictInverseDepth(modelOrFrame,raw,globalModel=null){const s=globalModel?modelOrFrame:modelOrFrame,model=globalModel||modelOrFrame;if(!s||!Number.isFinite(raw))return NaN;const domain=s.domain||model.domain,gamma=s.gamma||model.gamma||[0,0];if(!domain)return NaN;const x=normalizeRaw(raw,domain),rho=positive(s.a??1)*globalResponse(x,gamma)+(Number(s.b)||0);return rho>EPS?rho:NaN;}
export function predictMetricDepth(frameCalibration,raw,globalModel=null){const rho=predictInverseDepth(frameCalibration,raw,globalModel);return rho>EPS?1/rho:NaN;}
export function globalResponseFromRaw(raw,model){if(!model?.domain||!Number.isFinite(raw))return NaN;return globalResponse(normalizeRaw(raw,model.domain),model.gamma||[0,0]);}
export function serializeHierarchicalDepthCalibration(m){if(!m)return null;return {format:m.format,representation:m.representation,domain:m.domain,gamma:Array.from(m.gamma||[]),globalNonlinearityReady:!!m.globalNonlinearityReady,stats:m.stats,frames:(m.frames||[]).map(s=>({frameId:s.frameId,a:s.a,b:s.b,mode:s.mode,confidence:s.confidence,residualSigma:s.residualSigma,relativeResidual:s.relativeResidual,relativeResidualP90:s.relativeResidualP90,anchorCount:s.anchorCount,inheritedFrom:s.inheritedFrom,observability:s.observability}))};}

function globalSeed(normalized,obs,gamma,prevMap,frames){const vals=[];for(let i=0;i<normalized.length;i++){const old=prevMap.get(String(frames[i]?.frameId));if(old?.a>0&&Number.isFinite(old.b))vals.push({a:old.a,b:old.b});if(obs[i].mode!=='full')continue;const p=normalized[i].map(x=>({...x,f:globalResponse(x.x,gamma)})),fit=fitAffineRobust(p,{a:1,b:0},{sigmaA:10,sigmaB:10});if(fit&&fit.a>0)vals.push({a:fit.a,b:fit.b});}return vals.length?{a:median(vals.map(x=>x.a)),b:median(vals.map(x=>x.b))}:{a:1,b:0};}
function temporalPrediction(i,states,prevMap,frames,seed){let sa=0,sb=0,sw=0,from=[];for(let d=1;d<=3;d++)for(const j of [i-d,i+d]){if(j<0||j>=frames.length)continue;const s=states[j]||prevMap.get(String(frames[j]?.frameId));if(!(s?.a>0)||!Number.isFinite(+s.b))continue;const q=s.confidence??s.observability?.score??.2,w=(.30+.70*clamp(q,0,1))/(d*d);sa+=w*s.a;sb+=w*s.b;sw+=w;from.push(String(s.frameId));}if(sw>0)return {a:sa/sw,b:sb/sw,from};const old=prevMap.get(String(frames[i]?.frameId));if(old?.a>0&&Number.isFinite(+old.b))return {a:old.a,b:old.b,from:['previous']};return {...seed,from:[]};}
function fitAffineRobust(pairs,prior,{sigmaA=.1,sigmaB=.035}={}){let a=positive(prior.a),b=Number(prior.b)||0,support=0;for(let it=0;it<7;it++){let h00=1/(sigmaA*sigmaA),h01=0,h11=1/(sigmaB*sigmaB),g0=h00*prior.a,g1=h11*prior.b;support=0;for(const p of pairs){if(!Number.isFinite(p.f+p.rho))continue;const r=a*p.f+b-p.rho,u=r/Math.max(.002,p.sigmaRho),w=p.w*cauchyWeight(u,2.6);h00+=w*p.f*p.f;h01+=w*p.f;h11+=w;g0+=w*p.f*p.rho;g1+=w*p.rho;support+=w;}const det=h00*h11-h01*h01;if(Math.abs(det)<EPS)break;const na=(g0*h11-g1*h01)/det,nb=(h00*g1-h01*g0)/det;if(!Number.isFinite(na+nb))break;a=positive(na);b=nb;}return support>0?{a,b,support}:null;}
function fitShiftRobust(pairs,a,priorB,sigmaB){let b=Number(priorB)||0,support=0;for(let it=0;it<6;it++){let sw=1/(sigmaB*sigmaB),sy=sw*priorB;support=0;for(const p of pairs){const r=a*p.f+b-p.rho,w=p.w*cauchyWeight(r/Math.max(.002,p.sigmaRho),2.6);sw+=w;sy+=w*(p.rho-a*p.f);support+=w;}b=sy/Math.max(EPS,sw);}return support>0?{b,support}:null;}
function fitGammaRobust(rows,prior){let g=prior.slice(),support=0;for(let it=0;it<5;it++){let h00=18,h01=0,h11=18,b0=18*prior[0],b1=18*prior[1];support=0;for(const {p,s} of rows){const [p2,p3]=basis(p.x),base=p.x,model=s.a*(base+g[0]*p2+g[1]*p3)+s.b,r=model-p.rho,w=p.w*cauchyWeight(r/Math.max(.002,p.sigmaRho),2.8),j0=s.a*p2,j1=s.a*p3;h00+=w*j0*j0;h01+=w*j0*j1;h11+=w*j1*j1;b0+=w*j0*(p.rho-s.a*base-s.b);b1+=w*j1*(p.rho-s.a*base-s.b);support+=w;}const det=h00*h11-h01*h01;if(Math.abs(det)<EPS)break;const ng0=(b0*h11-b1*h01)/det,ng1=(h00*b1-h01*b0)/det;if(!Number.isFinite(ng0+ng1))break;g=enforceMonotoneGamma([ng0,ng1]);}return support>0?g:null;}
function calibrationConfidence(s,pairs){const o=s.observability?.score||0,data=1-Math.exp(-(pairs?.length||0)/10),rr=Number.isFinite(s.relativeResidual)?s.relativeResidual:s.residualSigma/.15,res=Math.exp(-Math.min(8,rr/.16));const freedom=s.mode==='full'?1:(s.mode==='shift-only'?.68:.32);return clamp((.08+.92*o)*(.18+.82*data)*(.25+.75*res)*freedom,.005,.995);}
function normalizationDomain(raw,old,{freeze=true}={}){if(freeze&&old?.scale>0)return {...old};const a=(raw||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(a.length>=8){const lo=quantileSorted(a,.04),hi=quantileSorted(a,.96),center=(lo+hi)/2,scale=Math.max(EPS,(hi-lo)/2);return {center,scale,lo,hi};}return old?.scale>0?{...old}:{center:0,scale:1,lo:-1,hi:1};}
function normalizeRaw(raw,d){return clamp((raw-d.center)/Math.max(EPS,d.scale),-1.8,1.8);}
function basis(x){return [(.5*(3*x*x-1)),(.5*(5*x*x*x-3*x))];}
function globalResponse(x,g){const [p2,p3]=basis(x);return x+(g?.[0]||0)*p2+(g?.[1]||0)*p3;}
function responseDerivative(x,g){return 1+(g?.[0]||0)*3*x+(g?.[1]||0)*.5*(15*x*x-3);}
function minResponseDerivative(g){let m=Infinity;for(let i=0;i<=64;i++){const x=-1.8+3.6*i/64;m=Math.min(m,responseDerivative(x,g));}return m;}
function enforceMonotoneGamma(g){let out=[clamp(Number(g?.[0])||0,-.32,.32),clamp(Number(g?.[1])||0,-.22,.22)];for(let k=0;k<30&&minResponseDerivative(out)<.12;k++)out=out.map(x=>x*.84);return out;}
function sampleDeepGrid(d,u,v,w,h){const x=clamp(u/Math.max(1,w)*d.cols-.5,0,d.cols-1),y=clamp(v/Math.max(1,h)*d.rows-.5,0,d.rows-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(d.cols-1,x0+1),y1=Math.min(d.rows-1,y0+1),tx=x-x0,ty=y-y0,a=d.raw;return (a[y0*d.cols+x0]*(1-tx)+a[y0*d.cols+x1]*tx)*(1-ty)+(a[y1*d.cols+x0]*(1-tx)+a[y1*d.cols+x1]*tx)*ty;}
function deepQualityWeight(d){const q=d?.quality||{};if(q.suspicious)return .06;let w=1;const coherence=+q.coherenceRatio;if(Number.isFinite(coherence)&&coherence<1.25)w*=.25;if(q.stripe?.suspicious)w*=.10;return clamp(w,.04,1);}
function cauchyWeight(u,c=2.5){const x=u/c;return 1/(1+x*x);}
function positive(x){return clamp(Number(x)||1,1e-4,1e4);}
function prob(x){return clamp(Number(x)||.01,.001,.999);}
function covTrace(c){return Array.isArray(c)?Math.max(0,(+c[0]||0)+(+c[3]||0)+(+c[5]||0)):0;}
function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}
function median(a){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;return quantileSorted(b,.5);}
function quantileSorted(a,q){if(!a.length)return NaN;const x=(a.length-1)*q,i=Math.floor(x),t=x-i;return a[i]*(1-t)+a[Math.min(a.length-1,i+1)]*t;}
function mix(a,b,t){return a+(b-a)*t;}
