import {projectPixelAcrossEdge} from './photo_panorama.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-9;
const DEFAULT_QUANTILES=[.01,.03,.06,.10,.16,.24,.34,.45,.56,.67,.76,.84,.90,.95,.98,.995];

/**
 * Layer-aware global synchronization of monocular Depth Anything maps.
 *
 * Depth Anything V2 relative output is treated as an ordinal/disparity-like
 * signal, not as metric depth.  A single scale+shift per frame is too rigid in
 * practice: different depth bands can be compressed differently.  We therefore
 * estimate one monotone piecewise-linear transfer T_i for every exact RGB+Deep
 * frame.  Knots are depth layers; their positions are biased toward depth values
 * actually observed inside reliable RGB overlap masks.
 *
 * Every accepted spherical RGB overlap contributes robust constraints
 *
 *        T_i(D_i(p)) ~= T_j(D_j(q))
 *
 * where reference pixels are down-weighted at RGB/depth discontinuities.  The
 * full connected graph (including loop closures) is optimized jointly with IRLS.
 * The panorama root is a fixed gauge, so adding a new frame cannot arbitrarily
 * recolour all previously synchronized maps.
 */
export function solvePhotoDepthConsensus(frames,edges,{minPairs=8,maxPairs=260,rootIndex=0,irlsIterations=16,quantiles=DEFAULT_QUANTILES}={}){
  const n=frames?.length||0,transforms=new Array(n).fill(null),frameConfidence=new Float32Array(n),parent=new Int32Array(n);parent.fill(-1);
  if(!n)return emptyResult(n,[],transforms,frameConfidence,parent,-1);
  let root=Number.isInteger(rootIndex)&&rootIndex>=0&&rootIndex<n&&frames[rootIndex]?.relativeDepth?.length?rootIndex:-1;
  if(root<0)root=frames.findIndex(f=>f?.relativeDepth?.length);
  if(root<0)return emptyResult(n,[],transforms,frameConfidence,parent,-1);

  const stats=frames.map(f=>computeDepthStats(f)),pairEdges=[],constraints=[],refs=Array.from({length:n},()=>[]);
  for(const e of edges||[]){
    const A=frames?.[e.a],B=frames?.[e.b],sa=stats[e.a],sb=stats[e.b];
    if(!A?.relativeDepth?.length||!B?.relativeDepth?.length||!sa||!sb)continue;
    const pairs=collectOverlapPairs(A,B,e,maxPairs,sa,sb);if(pairs.length<minPairs)continue;
    const pearson=weightedCorrelation(pairs),spearman=rankCorrelation(pairs),coverage=pairCoverage(pairs,A,B),depthCoverage=pairDepthCoverage(pairs,sa,sb);
    // A nonlinear monotone response can lower Pearson correlation, therefore
    // rank consistency is the primary gate.  A tiny single-layer overlap may
    // still be useful locally, but receives much lower authority.
    if(!(spearman>.18)||coverage<.022)continue;
    const qA=deepQuality(A),qB=deepQuality(B),countQ=1-Math.exp(-pairs.length/44),rankQ=clamp((spearman-.12)/.72,0,1),layerQ=clamp(depthCoverage/.30,.12,1);
    const confidence=clamp((e.visualConfidence??e.weight??.1)*Math.sqrt(qA*qB)*(.22+.78*countQ)*(.18+.82*rankQ)*(.30+.70*layerQ),.001,1);
    const anchors=buildOverlapLayerAnchors(pairs,sa,sb,{layers:7});
    const pe={a:e.a,b:e.b,aId:String(A.frameId),bId:String(B.frameId),pairs:pairs.length,inliers:pairs.length,correlation:pearson,rankCorrelation:spearman,coverage,depthLayerCoverage:depthCoverage,confidence,relativeError:Infinity,nonlinear:true,layerWise:true,layerAnchors:anchors.length};pairEdges.push(pe);
    for(const p of pairs){
      const baseW=Math.max(.00008,p.w*confidence*p.stableQ),c={a:e.a,b:e.b,x:p.x,y:p.y,baseW,robust:1,edge:pe,stableQ:p.stableQ};constraints.push(c);refs[e.a].push({v:p.x,w:baseW});refs[e.b].push({v:p.y,w:baseW});
    }
    // Robust medians inside broad depth bands act as scale references. They are
    // derived only from the RGB-verified overlap mask and are intentionally
    // stronger than a single pixel, but far weaker than their whole layer.
    // This follows the layer-wise alignment idea without hard-segmenting the
    // scene or forcing foreground/background to share one scale coefficient.
    for(const a of anchors){
      const baseW=Math.max(.00018,a.weight*confidence),stableQ=clamp(a.stability,.08,1),c={a:e.a,b:e.b,x:a.x,y:a.y,baseW,robust:1,edge:pe,stableQ,isLayerAnchor:true};constraints.push(c);refs[e.a].push({v:a.x,w:baseW*1.25});refs[e.b].push({v:a.y,w:baseW*1.25});
    }
  }

  const component=componentContaining(n,pairEdges,root).filter(i=>frames[i]?.relativeDepth?.length);
  const rootKnots=depthKnotsFromStats(stats[root],quantiles);if(!rootKnots){frameConfidence[root]=Math.max(.05,deepQuality(frames[root]));return finish(frames,pairEdges,transforms,frameConfidence,parent,root,[root],Infinity,.08);}
  const rootSpan=Math.max(EPS,rootKnots[rootKnots.length-1]-rootKnots[0]),rootY=rootKnots.map(x=>(x-rootKnots[0])/rootSpan);
  for(const i of component){
    const xKnots=i===root?rootKnots:referenceAwareKnots(stats[i],refs[i],quantiles);if(!xKnots)continue;
    transforms[i]={type:'monotonic-layer-pwl',xKnots,yKnots:rootY.slice(),knotConfidence:new Array(xKnots.length).fill(i===root?1:.18),residualSigma:i===root?.008:.09,support:i===root?999:0,layerSupport:0};
  }
  if(transforms[root])transforms[root].gauge=true;

  let globalResidual=Infinity,robustSigma=.08;
  for(let it=0;it<Math.max(3,irlsIterations);it++){
    for(const i of component){
      if(i===root||!transforms[i])continue;
      const fit=fitOneMonotoneTransfer(i,transforms,constraints,{previous:transforms[i],smoothness:it<2?.024:.010,anchor:it<2?.010:.0012});if(!fit)continue;
      const damp=it<2?.66:.50,old=transforms[i].yKnots,ys=fit.yKnots.map((v,k)=>old[k]*(1-damp)+v*damp),mono=enforceMonotone(ys,fit.knotWeights),maxW=Math.max(EPS,...fit.knotWeights);
      transforms[i]={...transforms[i],yKnots:mono,knotConfidence:fit.knotWeights.map(w=>clamp(.08+.92*Math.sqrt(w/maxW),.08,1)),support:fit.support,layerSupport:fit.activeKnots};
    }
    const abs=[];for(const c of constraints){const ta=transforms[c.a],tb=transforms[c.b];if(!ta||!tb){c.robust=0;continue;}const r=Math.abs(applyTransfer(ta,c.x)-applyTransfer(tb,c.y));if(Number.isFinite(r))abs.push(r);}
    if(!abs.length)break;globalResidual=median(abs);const mad=median(abs.map(r=>Math.abs(r-globalResidual)));robustSigma=clamp(Math.max(.005,1.4826*Math.max(mad,globalResidual*.18)),.005,.20);
    for(const c of constraints){const ta=transforms[c.a],tb=transforms[c.b];if(!ta||!tb){c.robust=0;continue;}const r=Math.abs(applyTransfer(ta,c.x)-applyTransfer(tb,c.y)),u=r/Math.max(.007,2.55*robustSigma);c.robust=Number.isFinite(r)?clamp(1/(1+u*u*u*u),.002,1):0;}
  }

  const support=Array.from({length:n},()=>({count:0,weight:0,error:0,errors:[]}));
  for(const c of constraints){const ta=transforms[c.a],tb=transforms[c.b];if(!ta||!tb)continue;const r=Math.abs(applyTransfer(ta,c.x)-applyTransfer(tb,c.y)),w=c.baseW*c.robust;if(!Number.isFinite(r)||!(w>0))continue;for(const i of [c.a,c.b]){support[i].count++;support[i].weight+=w;support[i].error+=w*r;support[i].errors.push(r);}}
  for(const i of component){
    const t=transforms[i];if(!t)continue;const s=support[i],err=s.weight>EPS?s.error/s.weight:robustSigma,medErr=s.errors.length?median(s.errors):err,q=deepQuality(frames[i]),obs=1-Math.exp(-s.count/28),layerObs=clamp((t.layerSupport||0)/Math.max(1,t.xKnots.length),.08,1),conf=i===root?clamp(.74+.24*q,.2,.99):clamp((.07+.83*obs)*q*(.40+.60*layerObs)*Math.exp(-5.2*Math.min(.42,medErr)),.003,.98);
    frameConfidence[i]=conf;t.residualSigma=clamp(Math.max(.007,1.4826*Math.min(.20,medErr||robustSigma)),.007,.22);t.support=s.count;
  }
  if(transforms[root]){frameConfidence[root]=Math.max(frameConfidence[root],.84);transforms[root].residualSigma=.007;transforms[root].knotConfidence.fill(1);transforms[root].layerSupport=transforms[root].xKnots.length;}

  for(const pe of pairEdges){
    const rs=constraints.filter(c=>c.edge===pe&&transforms[c.a]&&transforms[c.b]).map(c=>Math.abs(applyTransfer(transforms[c.a],c.x)-applyTransfer(transforms[c.b],c.y))).filter(Number.isFinite),med=median(rs),inl=rs.filter(r=>r<Math.max(.022,2.7*robustSigma)).length;
    pe.relativeError=Number.isFinite(med)?med:Infinity;pe.inliers=inl;pe.confidence=clamp(pe.confidence*(.22+.78*(inl/Math.max(1,rs.length)))*Math.exp(-4.5*Math.min(.45,pe.relativeError)),.001,1);
  }
  return finish(frames,pairEdges,transforms,frameConfidence,parent,root,component,globalResidual,robustSigma);
}

export function sampleConsensusDepth(frame,transform,u,v){const raw=sampleRaw(frame,u,v);if(!transform||!Number.isFinite(raw))return NaN;return applyTransfer(transform,raw);}

/** Mapped depth plus layer confidence and uncertainty for probabilistic fusion. */
export function sampleConsensusDepthInfo(frame,transform,u,v){
  const raw=sampleRaw(frame,u,v);if(!transform||!Number.isFinite(raw))return null;const value=applyTransfer(transform,raw);if(!Number.isFinite(value))return null;
  const du=Math.max(1,frame.width/Math.max(24,frame.relativeDepthWidth||frame.width)),dv=Math.max(1,frame.height/Math.max(24,frame.relativeDepthHeight||frame.height));
  const xm=sampleConsensusDepth(frame,transform,u-du,v),xp=sampleConsensusDepth(frame,transform,u+du,v),ym=sampleConsensusDepth(frame,transform,u,v-dv),yp=sampleConsensusDepth(frame,transform,u,v+dv);
  const gx=Number.isFinite(xm)&&Number.isFinite(xp)?Math.abs(xp-xm)*.5:0,gy=Number.isFinite(ym)&&Number.isFinite(yp)?Math.abs(yp-ym)*.5:0,gradient=Math.hypot(gx,gy),b=basisAt(transform.xKnots,raw),kc=transform.knotConfidence||[];
  const layerConfidence=b?clamp((kc[b.i]??.2)*(1-b.t)+(kc[b.j]??.2)*b.t,.05,1):.12;
  // Discontinuities and weakly constrained layers carry larger uncertainty.
  const sigma=clamp((transform.residualSigma??.07)/Math.sqrt(layerConfidence)+.32*gradient,.007,.32);
  return {value,raw,sigma,gradient,layerConfidence,layerIndex:b?.i??-1};
}

export function applyDepthTransfer(transform,raw){return applyTransfer(transform,raw);}

function finish(frames,pairEdges,transforms,frameConfidence,parent,root,component,globalResidual=Infinity,robustSigma=.08){
  const aligned=transforms.reduce((s,t)=>s+(t?1:0),0),errs=pairEdges.map(e=>e.relativeError).filter(Number.isFinite),layerCover=pairEdges.map(e=>e.depthLayerCoverage).filter(Number.isFinite),range=aligned?{lo:0,hi:1,p05:.05,p95:.95,samples:aligned,policy:'fixed-root-gauge-layerwise-monotone'}:null;
  const layerAnchors=transforms.reduce((s,t)=>s+(t?.layerSupport||0),0),overlapLayerAnchors=pairEdges.reduce((s,e)=>s+(e.layerAnchors||0),0),stats={rawFrames:frames?.reduce((s,f)=>s+(f?.relativeDepth?.length?1:0),0)||0,alignedFrames:aligned,pairEdges:pairEdges.length,medianRelativeError:median(errs),globalResidual:Number.isFinite(globalResidual)?globalResidual:Infinity,robustSigma,meanConfidence:pairEdges.length?pairEdges.reduce((s,e)=>s+e.confidence,0)/pairEdges.length:0,globalLow:range?.lo??null,globalHigh:range?.hi??null,nonlinearFrames:transforms.reduce((s,t)=>s+(t?.type?.includes('pwl')?1:0),0),layerAnchors,overlapLayerAnchors,medianLayerCoverage:median(layerCover)};
  return {format:'ROOMSCAN-PHOTO-DEPTH-CONSENSUS-4',root,component,transforms,frameConfidence,parent,edges:pairEdges,globalRange:range,representation:'relative-disparity-global-layerwise-monotonic-probabilistic',stats};
}
function emptyResult(n,pairEdges,transforms,frameConfidence,parent,root){return {format:'ROOMSCAN-PHOTO-DEPTH-CONSENSUS-4',root,component:root>=0?[root]:[],transforms,frameConfidence,parent,edges:pairEdges,globalRange:null,representation:'relative-disparity-global-layerwise-monotonic-probabilistic',stats:{rawFrames:0,alignedFrames:0,pairEdges:pairEdges.length,medianRelativeError:Infinity,globalResidual:Infinity,robustSigma:Infinity,meanConfidence:0,globalLow:null,globalHigh:null,nonlinearFrames:0,layerAnchors:0,overlapLayerAnchors:0,medianLayerCoverage:0}};}

function fitOneMonotoneTransfer(i,transforms,constraints,{previous,smoothness=.03,anchor=.008}={}){
  const tr=transforms[i];if(!tr?.xKnots?.length)return null;const K=tr.xKnots.length,M=Array.from({length:K},()=>new Float64Array(K)),Y=new Float64Array(K),diag=new Float64Array(K);let support=0,totalW=0;
  const addEq=(terms,rhs,w)=>{if(!(w>0)||!Number.isFinite(rhs))return;for(const [ii,ci] of terms){Y[ii]+=w*ci*rhs;diag[ii]+=w*ci*ci;for(const [jj,cj] of terms)M[ii][jj]+=w*ci*cj;}};
  for(const c of constraints){let raw,target;if(c.a===i){raw=c.x;const nt=transforms[c.b];if(!nt)continue;target=applyTransfer(nt,c.y);}else if(c.b===i){raw=c.y;const nt=transforms[c.a];if(!nt)continue;target=applyTransfer(nt,c.x);}else continue;const b=basisAt(tr.xKnots,raw),w=c.baseW*c.robust;if(!b||!(w>0)||!Number.isFinite(target))continue;addEq([[b.i,1-b.t],[b.j,b.t]],target,w);support++;totalW+=w;}
  if(support<5||totalW<EPS)return null;
  // Low-frequency deformation spline in 1-D depth space: neighbouring layer
  // scales may differ, but slope changes are regularized to prevent oscillation.
  const lam=Math.max(1e-7,totalW*smoothness/Math.max(1,K-2));for(let k=1;k<K-1;k++){const dx0=Math.max(EPS,tr.xKnots[k]-tr.xKnots[k-1]),dx1=Math.max(EPS,tr.xKnots[k+1]-tr.xKnots[k]),terms=[[k-1,-1/dx0],[k,1/dx0+1/dx1],[k+1,-1/dx1]];addEq(terms,0,lam);}
  const old=previous?.yKnots||tr.yKnots,maxDiag=Math.max(EPS,...diag),al=Math.max(1e-8,totalW*anchor/K);for(let k=0;k<K;k++){const observed=diag[k]/maxDiag,hold=al*(1+.9/(.08+observed));addEq([[k,1]],old[k],hold);}
  for(let k=0;k<K;k++)M[k][k]+=1e-9;const sol=solveSquare(M,Y);if(!sol)return null;const activeKnots=Array.from(diag).reduce((s,w)=>s+(w>maxDiag*.025?1:0),0);return {yKnots:enforceMonotone(sol,diag),knotWeights:Array.from(diag),support,activeKnots};
}

function computeDepthStats(frame){const sample=finiteDepthSample(frame,2400);if(sample.length<20)return null;sample.sort((a,b)=>a-b);const p02=percentileSorted(sample,.02),p05=percentileSorted(sample,.05),p95=percentileSorted(sample,.95),p98=percentileSorted(sample,.98),span=Math.max(EPS,p95-p05);return {sample,p02,p05,p95,p98,span};}
function depthKnotsFromStats(stats,quantiles){if(!stats?.sample?.length)return null;const xs=quantiles.map(q=>percentileSorted(stats.sample,q));return makeStrict(xs);}
function referenceAwareKnots(stats,refs,quantiles){
  const global=depthKnotsFromStats(stats,quantiles);if(!global)return null;const good=(refs||[]).filter(r=>Number.isFinite(r.v)&&r.w>0);if(good.length<18)return global;
  const ref=quantiles.map(q=>weightedQuantile(good,q)),refSpan=ref[ref.length-1]-ref[0],coverage=clamp(refSpan/Math.max(EPS,stats.p98-stats.p02),0,1),a=clamp(.20+.62*coverage,.20,.76),xs=global.map((v,k)=>v*(1-a)+ref[k]*a);
  // Keep robust global extrema so unsupported near/far values extrapolate gently
  // instead of being squeezed into the observed overlap layer.
  xs[0]=global[0];xs[xs.length-1]=global[global.length-1];return makeStrict(xs);
}
function makeStrict(xs){const out=xs.map(Number),span=out[out.length-1]-out[0];if(!(span>1e-8))return null;const eps=Math.max(1e-9,span*1e-6);for(let i=1;i<out.length;i++)if(out[i]<=out[i-1])out[i]=out[i-1]+eps;return out;}
function finiteDepthSample(frame,max=1800){const src=frame?.relativeDepth;if(!src?.length)return [];const out=[],step=Math.max(1,Math.floor(src.length/max));for(let i=0;i<src.length;i+=step){const v=src[i];if(Number.isFinite(v))out.push(v);}return out;}
function basisAt(knots,x){if(!knots?.length||knots.length<2||!Number.isFinite(x))return null;if(x<=knots[0])return {i:0,j:1,t:0};const last=knots.length-1;if(x>=knots[last])return {i:last-1,j:last,t:1};let lo=0,hi=last;while(hi-lo>1){const m=(lo+hi)>>1;if(knots[m]<=x)lo=m;else hi=m;}return {i:lo,j:hi,t:clamp((x-knots[lo])/Math.max(EPS,knots[hi]-knots[lo]),0,1)};}
function applyTransfer(t,raw){if(!t||!Number.isFinite(raw))return NaN;if((t.type==='monotonic-layer-pwl'||t.type==='monotonic-pwl')&&t.xKnots?.length===t.yKnots?.length){const b=basisAt(t.xKnots,raw);return b?t.yKnots[b.i]*(1-b.t)+t.yKnots[b.j]*b.t:NaN;}if(Number.isFinite(t.a)&&Number.isFinite(t.b))return t.a*raw+t.b;return NaN;}
function enforceMonotone(values,weights){const n=values.length,blocks=[];for(let i=0;i<n;i++){const w=Math.max(1e-6,Number(weights?.[i]||1)),v=clamp(Number(values[i]),-.40,1.40);blocks.push({start:i,end:i,w,sum:w*v});while(blocks.length>=2){const b=blocks[blocks.length-1],a=blocks[blocks.length-2];if(a.sum/a.w<=b.sum/b.w+1e-8)break;blocks.pop();blocks.pop();blocks.push({start:a.start,end:b.end,w:a.w+b.w,sum:a.sum+b.sum});}}const out=new Array(n);for(const b of blocks){const v=b.sum/b.w;for(let i=b.start;i<=b.end;i++)out[i]=v;}for(let i=1;i<n;i++)out[i]=Math.max(out[i],out[i-1]+1e-5);const span=out[n-1]-out[0];if(span<.055){const mid=(out[0]+out[n-1])*.5;for(let i=0;i<n;i++)out[i]=mid+(i/(n-1)-.5)*.055;}return out.map(v=>clamp(v,-.40,1.40));}

function collectOverlapPairs(A,B,e,maxPairs,sa,sb){
  const out=[],seen=new Set(),gain=clamp(Number(e?.gainAB)||1,.55,1.75),push=(ua,va,ub,vb,w,photoQ=1)=>{
    const key=`${Math.round(ua/3)}:${Math.round(va/3)}:${Math.round(ub/3)}:${Math.round(vb/3)}`;if(seen.has(key))return;const x=sampleRaw(A,ua,va),y=sampleRaw(B,ub,vb);if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const dgA=sampleRawGradient(A,ua,va)/Math.max(EPS,sa.span),dgB=sampleRawGradient(B,ub,vb)/Math.max(EPS,sb.span),igA=sampleGrayGradient(A,ua,va),igB=sampleGrayGradient(B,ub,vb),depthInterior=Math.exp(-2.6*Math.min(2,dgA+dgB)),rgbInterior=Math.exp(-Math.min(3,(igA+igB)/105)),stableQ=clamp((.24+.76*depthInterior)*(.35+.65*rgbInterior)*(.35+.65*photoQ),.025,1);
    seen.add(key);out.push({x,y,w:clamp(w,.003,1),stableQ,aU:ua,aV:va,bU:ub,bV:vb});
  };
  // Exact visual correspondences establish geometry, but corners frequently sit
  // on depth discontinuities; stability terms keep them from dominating scale.
  for(const m of e.matches||[]){const pq=clamp(Number(m.photometricProbability??.7),.05,1);push(m.aU,m.aV,m.bU,m.bV,.12+.58*clamp(Number(m.probability||.1)*pq,0,1),pq);if(out.length>=maxPairs)return out;}
  // Densify the actual RGB overlap mask. Smooth interior patches are the most
  // useful references for layer scale synchronization.
  if(e?.rotationBToA?.length===9){const nx=22,ny=16;for(let gy=1;gy<ny-1&&out.length<maxPairs;gy++)for(let gx=1;gx<nx-1&&out.length<maxPairs;gx++){
    const ua=(gx+.5)/nx*A.width,va=(gy+.5)/ny*A.height,p=projectPixelAcrossEdge(A,B,e,'a',ua,va);if(!p)continue;const ga=sampleGray(A,ua,va),gb=sampleGray(B,p.u,p.v)*gain;if(!Number.isFinite(ga)||!Number.isFinite(gb))continue;const diff=Math.abs(ga-gb),photo=Math.exp(-diff/48);if(photo<.13)continue;const edge=Math.min(ua/A.width,1-ua/A.width,va/A.height,1-va/A.height),centre=clamp(edge/.14,0,1);push(ua,va,p.u,p.v,.10+.78*photo*(.28+.72*centre),photo);
  }}
  return out;
}
function buildOverlapLayerAnchors(pairs,sa,sb,{layers=7}={}){
  if(!pairs?.length||pairs.length<12)return [];
  const ax0=sa.p02,ax1=sa.p98,bx0=sb.p02,bx1=sb.p98,as=Math.max(EPS,ax1-ax0),bs=Math.max(EPS,bx1-bx0),items=[];
  for(const p of pairs){const w=Math.max(EPS,p.w*p.stableQ);if(!(w>0))continue;const ra=clamp((p.x-ax0)/as,0,1),rb=clamp((p.y-bx0)/bs,0,1),rank=.5*(ra+rb);items.push({...p,w,rank});}
  if(items.length<12)return [];
  const out=[],L=Math.max(3,Math.min(9,layers|0));
  for(let l=0;l<L;l++){
    // Slight overlap between neighbouring bands avoids brittle hard boundaries.
    const lo=Math.max(0,l/L-.025),hi=Math.min(1,(l+1)/L+.025),band=items.filter(p=>p.rank>=lo&&p.rank<=hi);if(band.length<4)continue;
    const wx=band.map(p=>({v:p.x,w:p.w})),wy=band.map(p=>({v:p.y,w:p.w})),x=weightedQuantile(wx,.5),y=weightedQuantile(wy,.5);if(!Number.isFinite(x+y))continue;
    const madA=weightedQuantile(band.map(p=>({v:Math.abs(p.x-x)/as,w:p.w})),.5),madB=weightedQuantile(band.map(p=>({v:Math.abs(p.y-y)/bs,w:p.w})),.5),disp=Math.max(0,(madA+madB)*.5),sumW=band.reduce((s,p)=>s+p.w,0),stability=clamp(Math.exp(-8*disp)*(1-Math.exp(-band.length/7)),.04,1);
    const weight=clamp((sumW/Math.max(1,band.length))*(.7+1.8*Math.sqrt(band.length))*stability,.0002,2.2);
    out.push({layer:l,x,y,weight,stability,count:band.length,rank:.5*(lo+hi)});
  }
  return out;
}
function pairCoverage(pairs,A,B){if(!pairs.length)return 0;const xsA=pairs.map(p=>p.aU/A.width),ysA=pairs.map(p=>p.aV/A.height),xsB=pairs.map(p=>p.bU/B.width),ysB=pairs.map(p=>p.bV/B.height);return Math.min(spread(xsA)*spread(ysA),spread(xsB)*spread(ysB));}
function pairDepthCoverage(pairs,sa,sb){if(pairs.length<4)return 0;const ax=pairs.map(p=>p.x).sort((a,b)=>a-b),bx=pairs.map(p=>p.y).sort((a,b)=>a-b),da=(percentileSorted(ax,.90)-percentileSorted(ax,.10))/Math.max(EPS,sa.span),db=(percentileSorted(bx,.90)-percentileSorted(bx,.10))/Math.max(EPS,sb.span);return clamp(Math.min(da,db),0,1);}
function spread(a){if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y);return Math.max(0,percentileSorted(b,.9)-percentileSorted(b,.1));}
function sampleGray(f,u,v){if(!f?.gray?.length)return NaN;const x=clamp(u,0,f.width-1),y=clamp(v,0,f.height-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(f.width-1,x0+1),y1=Math.min(f.height-1,y0+1),tx=x-x0,ty=y-y0;return f.gray[y0*f.width+x0]*(1-tx)*(1-ty)+f.gray[y0*f.width+x1]*tx*(1-ty)+f.gray[y1*f.width+x0]*(1-tx)*ty+f.gray[y1*f.width+x1]*tx*ty;}
function sampleGrayGradient(f,u,v){const d=2,a=sampleGray(f,u-d,v),b=sampleGray(f,u+d,v),c=sampleGray(f,u,v-d),d0=sampleGray(f,u,v+d);return [a,b,c,d0].every(Number.isFinite)?.5*Math.hypot(b-a,d0-c):64;}
function sampleRawGradient(f,u,v){const du=Math.max(1,f.width/Math.max(32,f.relativeDepthWidth||f.width)),dv=Math.max(1,f.height/Math.max(32,f.relativeDepthHeight||f.height)),a=sampleRaw(f,u-du,v),b=sampleRaw(f,u+du,v),c=sampleRaw(f,u,v-dv),d=sampleRaw(f,u,v+dv);return [a,b,c,d].every(Number.isFinite)?.5*Math.hypot(b-a,d-c):0;}
function weightedCorrelation(ps){let sw=0,mx=0,my=0;for(const p of ps){const w=p.w*p.stableQ;sw+=w;mx+=w*p.x;my+=w*p.y;}if(sw<EPS)return 0;mx/=sw;my/=sw;let xx=0,yy=0,xy=0;for(const p of ps){const w=p.w*p.stableQ;xx+=w*(p.x-mx)**2;yy+=w*(p.y-my)**2;xy+=w*(p.x-mx)*(p.y-my);}return xx>EPS&&yy>EPS?xy/Math.sqrt(xx*yy):0;}
function rankCorrelation(ps){if(ps.length<3)return 0;const rx=ranks(ps.map(p=>p.x)),ry=ranks(ps.map(p=>p.y));let sw=0,mx=0,my=0;for(let i=0;i<ps.length;i++){const w=ps[i].w*ps[i].stableQ;sw+=w;mx+=w*rx[i];my+=w*ry[i];}if(sw<EPS)return 0;mx/=sw;my/=sw;let xx=0,yy=0,xy=0;for(let i=0;i<ps.length;i++){const w=ps[i].w*ps[i].stableQ,dx=rx[i]-mx,dy=ry[i]-my;xx+=w*dx*dx;yy+=w*dy*dy;xy+=w*dx*dy;}return xx>EPS&&yy>EPS?xy/Math.sqrt(xx*yy):0;}
function ranks(a){const idx=a.map((_,i)=>i).sort((i,j)=>a[i]-a[j]),r=new Float64Array(a.length);let k=0;while(k<idx.length){let q=k+1;while(q<idx.length&&Math.abs(a[idx[q]]-a[idx[k]])<1e-12)q++;const rank=.5*(k+q-1);for(let t=k;t<q;t++)r[idx[t]]=rank;k=q;}return r;}
function sampleRaw(f,u,v){if(!f?.relativeDepth?.length)return NaN;const w=f.relativeDepthWidth,h=f.relativeDepthHeight,x=clamp(u/Math.max(1,f.width)*(w-1),0,w-1),y=clamp(v/Math.max(1,f.height)*(h-1),0,h-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,vals=[[f.relativeDepth[y0*w+x0],(1-tx)*(1-ty)],[f.relativeDepth[y0*w+x1],tx*(1-ty)],[f.relativeDepth[y1*w+x0],(1-tx)*ty],[f.relativeDepth[y1*w+x1],tx*ty]].filter(([v])=>Number.isFinite(v));let s=0,sw=0;for(const [v,ww] of vals){s+=v*ww;sw+=ww;}return sw>EPS?s/sw:NaN;}
function deepQuality(f){const base=clamp(Number(f.relativeConfidence||.12),.01,1),q=f.relativeQuality;if(!q)return base;let p=1;if(q.suspicious)p*=.28;if(q.stripe?.suspicious)p*=.35;if(Number.isFinite(q.coherenceRatio)&&q.coherenceRatio>0)p*=clamp(q.coherenceRatio,.2,1);return clamp(base*p,.005,1);}
function componentContaining(n,edges,root){const adj=Array.from({length:n},()=>[]);for(const e of edges||[]){if(e.a>=0&&e.b>=0&&e.a<n&&e.b<n){adj[e.a].push(e.b);adj[e.b].push(e.a);}}const seen=new Set([root]),q=[root];while(q.length){const i=q.pop();for(const j of adj[i])if(!seen.has(j)){seen.add(j);q.push(j);}}return [...seen];}

function weightedQuantile(items,p){const a=items.slice().sort((x,y)=>x.v-y.v),total=a.reduce((s,x)=>s+x.w,0);if(!(total>0))return NaN;const target=clamp(p,0,1)*total;let s=0;for(const x of a){s+=x.w;if(s>=target)return x.v;}return a[a.length-1].v;}
function solveSquare(M,y){M=M.map(r=>Float64Array.from(r));y=Float64Array.from(y);const n=M.length;for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-12)return null;if(p!==c){const tr=M[c];M[c]=M[p];M[p]=tr;const ty=y[c];y[c]=y[p];y[p]=ty;}const d=M[c][c];for(let j=c;j<n;j++)M[c][j]/=d;y[c]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];if(Math.abs(f)<1e-15)continue;for(let j=c;j<n;j++)M[r][j]-=f*M[c][j];y[r]-=f*y[c];}}return [...y].every(Number.isFinite)?Array.from(y):null;}
function percentileSorted(b,p){if(!b.length)return NaN;const x=clamp(p,0,1)*(b.length-1),i=Math.floor(x),t=x-i;return b[i]*(1-t)+b[Math.min(b.length-1,i+1)]*t;}
function median(a){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);return b.length?percentileSorted(b,.5):Infinity;}
