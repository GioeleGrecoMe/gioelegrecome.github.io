import {projectPoint,triangulateRays,poseDistance} from '../slam/math.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * V30.29 sequence-level Deep alignment.
 *
 * Critical rule: RGB correspondences do NOT imply equal camera depth when the
 * camera translates.  Every photo-puzzle correspondence is first triangulated
 * with the known camera poses.  The resulting optical-Z values are then used as
 * probabilistic calibration anchors for the raw monocular depth in EACH frame.
 * This makes the photo graph a geometric constraint instead of a circular
 * raw-depth-to-raw-depth fit.
 */
export class DepthScaleGraph{
  constructor(graph,puzzle,{minPairs=6,regularizeIterations=18}={}){
    this.graph=graph?.format==='ROOMSCAN-PROB-GRAPH-1'?graph:(graph?.exportState?.()||graph||{});
    this.puzzle=puzzle;this.minPairs=minPairs;this.regularizeIterations=regularizeIterations;
    this.deepMap=new Map((this.graph.deepFactors||[]).map(x=>[String(x.frameId),x]));
    this.frameMap=new Map((this.graph.frames||[]).map((x,i)=>[String(x.frameId),{...x,index:i}]));
    this.edges=[];this.anchorsByFrame=new Map();this.transforms=new Map();this.metricModel=null;this.stats={};
  }
  build(){
    this.edges=[];this.anchorsByFrame=new Map();
    for(const e of this.puzzle?.edges||[]){const edge=this.buildGeometricEdge(e);if(edge)this.edges.push(edge);}
    this.addLandmarkAnchors();
    this.metricModel=this.fitSequenceModel();
    this.solveFrameTransforms();
    const vals=[...this.transforms.values()],aligned=vals.filter(x=>x.connected).length,calibrated=vals.filter(x=>x.calibrated).length;
    const edgeResiduals=this.edges.map(e=>e.relativeResidual).filter(Number.isFinite);
    this.stats={
      edges:this.edges.length,framesWithDeep:this.deepMap.size,alignedFrames:aligned,calibratedFrames:calibrated,
      metricMode:this.metricModel?.mode||null,metricRelativeError:this.metricModel?.error??Infinity,
      metricPairs:this.metricModel?.pairs||0,triangulatedPairs:this.edges.reduce((s,e)=>s+e.triangulated,0),
      rejectedPairs:this.edges.reduce((s,e)=>s+e.rejected,0),meanEdgeResidual:edgeResiduals.length?median(edgeResiduals):Infinity,
      largestPhotoComponent:this.puzzle?.stats?.largestComponent||0,connectedFraction:this.puzzle?.stats?.connectedFraction||0
    };return this;
  }
  buildGeometricEdge(e){
    const fa=this.frameMap.get(String(e.aId)),fb=this.frameMap.get(String(e.bId)),da=this.deepMap.get(String(e.aId)),db=this.deepMap.get(String(e.bId));
    if(!fa||!fb||!da||!db)return null;
    const poseA=fa.poseEstimate||fa.posePrior,poseB=fb.poseEstimate||fb.posePrior;if(!poseA||!poseB)return null;
    const baseline=poseDistance(poseA,poseB),maxGap=clamp(.025+baseline*.24,.035,.18),accepted=[],relGap=[];let rejected=0;
    for(const m of e.matches||[]){
      const rawA=sampleGrid(da,m.aU,m.aV,fa.K.width||fa.width,fa.K.height||fa.height),rawB=sampleGrid(db,m.bU,m.bV,fb.K.width||fb.width,fb.K.height||fb.height);
      if(!finiteRaw(rawA)||!finiteRaw(rawB)){rejected++;continue;}
      const tri=triangulateRays({pose:poseA,K:fa.K,u:m.aU,v:m.aV},{pose:poseB,K:fb.K,u:m.bU,v:m.bV},{minAngleRad:.0015,maxGapM:maxGap});
      if(!tri.ok){rejected++;continue;}
      const qa=projectPoint(poseA,fa.K,tri.p),qb=projectPoint(poseB,fb.K,tri.p);if(!qa||!qb||qa.z<.12||qb.z<.12||qa.z>15||qb.z>15){rejected++;continue;}
      const angleW=clamp((tri.angle-.0015)/.030,.035,1),gapScale=Math.max(.012,Math.min(maxGap,baseline*.14+.018)),gapW=Math.exp(-.5*(tri.gap/gapScale)**2),poseW=poseReliability(fa,fb,baseline),matchW=clamp(Number(m.probability||.05),.005,.999),w=clamp((e.weight||.1)*matchW*angleW*gapW*poseW,.0005,1);
      if(w<.0012){rejected++;continue;}
      const common={w,source:'photo-triangulation',edge:[String(e.aId),String(e.bId)],angle:tri.angle,gap:tri.gap,matchProbability:matchW};
      this.pushAnchor(String(e.aId),{raw:rawA,depth:qa.z,...common});this.pushAnchor(String(e.bId),{raw:rawB,depth:qb.z,...common});
      accepted.push({angle:tri.angle,gap:tri.gap,w});relGap.push(tri.gap/Math.max(.15,(qa.z+qb.z)*.5));
    }
    if(!accepted.length)return null;
    const confidence=clamp((e.weight||.1)*(1-Math.exp(-accepted.length/10))*Math.exp(-6*median(relGap)),.004,1);
    return {a:e.a,b:e.b,aId:String(e.aId),bId:String(e.bId),loop:!!e.loop,weight:+e.weight||0,confidence,baseline,triangulated:accepted.length,rejected,medianAngle:median(accepted.map(x=>x.angle)),medianGap:median(accepted.map(x=>x.gap)),relativeResidual:median(relGap)};
  }
  addLandmarkAnchors(){
    for(const l of this.graph.landmarkFactors||[]){if((l.probability||0)<.02||!Array.isArray(l.point))continue;
      for(const m of l.measurements||[]){const id=String(m.frameId),f=this.frameMap.get(id),d=this.deepMap.get(id);if(!f||!d)continue;const pose=f.poseEstimate||f.posePrior,q=projectPoint(pose,f.K,l.point);if(!q||q.z<.12||q.z>15)continue;const raw=sampleGrid(d,m.u,m.v,f.K.width||f.width,f.K.height||f.height);if(!finiteRaw(raw))continue;
        const cov=traceCov(l.covariance||[]),geomW=1/(1+Math.sqrt(Math.max(1e-9,cov))/.04),w=clamp((l.probability||.1)*(m.probability||.1)*geomW*deepQualityWeight(d),.001,1);this.pushAnchor(id,{raw,depth:q.z,w,source:'landmark',angle:null,gap:null});
      }
    }
  }
  pushAnchor(id,a){let list=this.anchorsByFrame.get(id);if(!list){list=[];this.anchorsByFrame.set(id,list);}if(list.length<1600)list.push(a);}
  fitSequenceModel(){
    const all=[];for(const [frameId,list] of this.anchorsByFrame)for(const a of list)all.push({...a,frameId});
    if(all.length<this.minPairs)return null;let best=null;
    for(const mode of ['direct','inverse-raw','inverse-depth']){
      const pooled=robustMetricFit(all,mode);if(!pooled)continue;const fits=new Map();let fittedFrames=0;
      for(const [id,list] of this.anchorsByFrame){const f=fitFrame(list,mode,pooled,this.minPairs);if(f){fits.set(id,f);fittedFrames++;}}
      if(!fittedFrames)continue;
      const residuals=[];const weights=[];for(const [id,list] of this.anchorsByFrame){const f=fits.get(id)||pooled;for(const a of list){const z=predict(f,a.raw);if(!(z>0))continue;residuals.push(Math.abs(z-a.depth)/Math.max(.12,a.depth));weights.push(a.w);}}
      const smooth=this.transformSmoothness(fits,pooled),error=weightedMedian(residuals,weights),score=error+.018*smooth+.01/Math.sqrt(Math.max(1,fittedFrames));const cand={mode,a:pooled.a,b:pooled.b,error,pairs:all.length,inlierRatio:pooled.inlierRatio,fittedFrames,smoothness:smooth,score,frameFits:fits};if(!best||cand.score<best.score)best=cand;
    }
    return best;
  }
  transformSmoothness(fits,pooled){
    const vals=[];for(const e of this.edges){const a=fits.get(e.aId),b=fits.get(e.bId);if(!a||!b)continue;const sa=Math.max(1e-6,Math.abs(a.a)),sb=Math.max(1e-6,Math.abs(b.a)),scaleDelta=Math.abs(Math.log(sa/sb)),offsetScale=Math.max(.05,medianDepth(this.anchorsByFrame.get(e.aId)||[])+medianDepth(this.anchorsByFrame.get(e.bId)||[])),offsetDelta=Math.abs(a.b-b.b)/offsetScale;vals.push((scaleDelta+.35*offsetDelta)*Math.max(.02,e.confidence));}return vals.length?median(vals):0;
  }
  solveFrameTransforms(){
    this.transforms=new Map();const model=this.metricModel;if(!model){for(const [id,d] of this.deepMap)this.transforms.set(id,{mode:null,a:1,b:0,confidence:.005,connected:false,calibrated:false,error:Infinity,pairs:0});return;}
    const largest=new Set((this.puzzle?.components?.[0]||[]).map(i=>String(this.puzzle?.frames?.[i]?.frameId||''))),fits=model.frameFits||new Map();
    for(const [id,d] of this.deepMap){const fit=fits.get(id);if(fit){const confidence=fitConfidence(fit,d,true);this.transforms.set(id,{mode:model.mode,a:fit.a,b:fit.b,error:fit.error,pairs:fit.pairs,confidence,connected:largest.size?largest.has(id):true,calibrated:true});continue;}
      const prior=calibrationPrior(d,model.mode)||{a:model.a,b:model.b,confidence:.03};this.transforms.set(id,{mode:model.mode,a:prior.a,b:prior.b,error:model.error*1.7,pairs:0,confidence:clamp(prior.confidence*.25,.006,.12),connected:false,calibrated:false});
    }
    // Graph-regularized interpolation is deliberately asymmetric: well-calibrated
    // frames barely move, weak frames borrow scale/offset from verified neighbors.
    const adj=new Map();for(const e of this.edges){if(!adj.has(e.aId))adj.set(e.aId,[]);if(!adj.has(e.bId))adj.set(e.bId,[]);adj.get(e.aId).push({id:e.bId,w:e.confidence});adj.get(e.bId).push({id:e.aId,w:e.confidence});}
    for(let it=0;it<this.regularizeIterations;it++){
      const next=new Map();for(const [id,tr] of this.transforms){const ns=(adj.get(id)||[]).map(n=>({tr:this.transforms.get(n.id),w:n.w})).filter(x=>x.tr?.connected||x.tr?.calibrated);if(!ns.length){next.set(id,tr);continue;}let sw=.04,aa=model.a*.04,bb=model.b*.04,conf=0;for(const n of ns){const w=Math.max(.002,n.w*n.tr.confidence);sw+=w;aa+=w*n.tr.a;bb+=w*n.tr.b;conf+=w;}const na=aa/sw,nb=bb/sw,trust=tr.calibrated?(tr.confidence<.25?.035:.002):.62,connected=tr.connected||ns.some(x=>x.tr.connected);next.set(id,{...tr,a:tr.a*(1-trust)+na*trust,b:tr.b*(1-trust)+nb*trust,confidence:clamp(Math.max(tr.confidence,conf/(conf+.35))*(connected?1:.65),.005,.995),connected});}this.transforms=next;
    }
    // Remove implementation-only state from public metric model.
    delete this.metricModel.frameFits;
  }
  metricDepth(frameId,raw){const t=this.transforms.get(String(frameId));return t&&finiteRaw(raw)?predict(t,raw):NaN;}
  latent(frameId,raw){return this.metricDepth(frameId,raw);}
  frameConfidence(frameId){const id=String(frameId),t=this.transforms.get(id),d=this.deepMap.get(id);if(!t?.connected)return .004;return clamp((t.confidence||0)*deepQualityWeight(d)*Math.exp(-2*Math.min(.8,t.error||.8)),.004,1);}
  exportState(){return {format:'ROOMSCAN-DEPTH-SCALE-GRAPH-2',edges:this.edges,transforms:[...this.transforms].map(([frameId,x])=>({frameId,...x})),metricModel:this.metricModel,stats:this.stats};}
}

function fitFrame(list,mode,pooled,minPairs){if(!list?.length)return null;const spread=rawSpread(list,mode),enough=list.length>=minPairs&&spread>1e-5;if(!enough)return null;const f=robustMetricFit(list,mode);if(!f)return null;const support=list.length*(f.inlierRatio||.5),shrink=clamp(support/(support+1.2),.60,.997);return {...f,a:f.a*shrink+pooled.a*(1-shrink),b:f.b*shrink+pooled.b*(1-shrink),pairs:list.length};}
function rawSpread(list,mode){const a=list.map(x=>mode==='inverse-raw'?1/Math.max(1e-8,Math.abs(x.raw)):x.raw).filter(Number.isFinite);if(a.length<3)return 0;return iqr(a)/Math.max(1e-6,Math.abs(median(a))+iqr(a));}
function fitConfidence(f,d,calibrated){return clamp((calibrated?.18:.04)+.56*(f.inlierRatio||.2)*(1-Math.exp(-(f.pairs||0)/12))*Math.exp(-4*Math.min(.6,f.error||.6))*deepQualityWeight(d),.006,.995);}
function calibrationPrior(d,mode){const c=d?.calibration;if(!c||!c.ok||c.mode!==mode||!Number.isFinite(c.a)||!Number.isFinite(c.b))return null;return {a:c.a,b:c.b,confidence:clamp(c.posteriorConfidence||c.confidence||.05,.01,.8)};}
function poseReliability(a,b,baseline){const sa=Number(a.poseCov?.translationStd||0),sb=Number(b.poseCov?.translationStd||0),s=Math.hypot(sa,sb);if(!(s>0))return 1;return clamp(1/(1+(s/Math.max(.015,baseline))**2),.08,1);}
function finiteRaw(x){return Number.isFinite(x)&&Math.abs(x)>1e-9;}
function sampleGrid(d,u,v,w,h){if(!d?.raw?.length)return NaN;const x=clamp(u/Math.max(1,w)*d.cols-.5,0,d.cols-1),y=clamp(v/Math.max(1,h)*d.rows-.5,0,d.rows-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(d.cols-1,x0+1),y1=Math.min(d.rows-1,y0+1),tx=x-x0,ty=y-y0,a=d.raw;return (a[y0*d.cols+x0]*(1-tx)+a[y0*d.cols+x1]*tx)*(1-ty)+(a[y1*d.cols+x0]*(1-tx)+a[y1*d.cols+x1]*tx)*ty;}
function robustMetricFit(pairs,mode){let active=pairs.filter(p=>finiteRaw(p.raw)&&p.depth>.08&&Number.isFinite(p.depth)),fit=null;for(let it=0;it<6;it++){fit=metricWls(active,mode);if(!fit)return null;const e=active.map(p=>Math.abs(predict({...fit,mode},p.raw)-p.depth)/Math.max(.12,p.depth)),med=median(e),mad=median(e.map(x=>Math.abs(x-med)))||.004,gate=Math.max(.025,med+2.6*mad),keep=active.filter((_,i)=>e[i]<=gate);if(keep.length<5||keep.length===active.length)break;active=keep;}if(!fit)return null;const errs=pairs.map(p=>Math.abs(predict({...fit,mode},p.raw)-p.depth)/Math.max(.12,p.depth));return {...fit,mode,error:weightedMedian(errs,pairs.map(p=>p.w)),inlierRatio:active.length/Math.max(1,pairs.length)};}
function metricWls(a,mode){let sw=0,sx=0,sy=0,sxx=0,sxy=0;for(const p of a){let x,y;if(mode==='direct'){x=p.raw;y=p.depth;}else if(mode==='inverse-raw'){x=1/Math.max(1e-8,Math.abs(p.raw));y=p.depth;}else{x=p.raw;y=1/Math.max(1e-8,p.depth);}if(!Number.isFinite(x+y))continue;const w=Math.max(.0005,p.w||.001);sw+=w;sx+=w*x;sy+=w*y;sxx+=w*x*x;sxy+=w*x*y;}const den=sw*sxx-sx*sx;if(sw<1e-6||Math.abs(den)<1e-11)return null;const aa=(sw*sxy-sx*sy)/den,b=(sy-aa*sx)/sw;return Number.isFinite(aa+b)&&Math.abs(aa)>1e-10?{a:aa,b}:null;}
function predict(m,r){if(!m||!finiteRaw(r))return NaN;if(m.mode==='direct')return m.a*r+m.b;if(m.mode==='inverse-raw')return m.a/Math.max(1e-8,Math.abs(r))+m.b;const q=m.a*r+m.b;return q>1e-8?1/q:NaN;}
function deepQualityWeight(d){const q=d?.quality||{};if(q.suspicious)return .035;let w=1;if(q.stripe?.suspicious)w*=.08;if(Number.isFinite(q.coherenceRatio)&&q.coherenceRatio<1.28)w*=.2;return clamp(w,.025,1);}
function traceCov(c){return (+c?.[0]||.0004)+(+c?.[3]||.0004)+(+c?.[5]||.0016);}
function medianDepth(a){const x=(a||[]).map(v=>v.depth).filter(Number.isFinite);return x.length?median(x):1;}
function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return Infinity;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
function iqr(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(b.length<4)return Math.max(1e-6,Math.abs(b[0]||1));return Math.max(1e-6,b[Math.floor(.75*(b.length-1))]-b[Math.floor(.25*(b.length-1))]);}
function weightedMedian(v,w){const a=v.map((x,i)=>[x,Math.max(.0005,w[i]||.0005)]).filter(x=>Number.isFinite(x[0])).sort((a,b)=>a[0]-b[0]),sum=a.reduce((s,x)=>s+x[1],0);if(!a.length)return Infinity;let c=0;for(const x of a){c+=x[1];if(c>=sum*.5)return x[0];}return a.at(-1)[0];}
