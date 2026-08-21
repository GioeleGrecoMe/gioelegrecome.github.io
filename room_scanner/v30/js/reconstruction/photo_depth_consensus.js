const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-9;

/**
 * Align raw monocular Depth Anything outputs only from photo-overlap evidence.
 * This is a diagnostic/atlas layer: it never changes the metric 3-D solver.
 * Each accepted photo edge estimates raw_A ~= a*raw_B+b with robust statistics;
 * transforms are propagated through the strongest overlap graph to one latent
 * depth coordinate. Bad or low-texture Deep maps simply receive low confidence.
 */
export function solvePhotoDepthConsensus(frames,edges,{minPairs=6,maxPairs=100}={}){
  const pairEdges=[];
  for(const e of edges||[]){const A=frames?.[e.a],B=frames?.[e.b];if(!A?.relativeDepth?.length||!B?.relativeDepth?.length)continue;const pairs=[];for(const m of e.matches||[]){const x=sampleRaw(A,m.aU,m.aV),y=sampleRaw(B,m.bU,m.bV);if(Number.isFinite(x)&&Number.isFinite(y))pairs.push({x,y,w:clamp(Number(m.probability||.1),.01,1)});if(pairs.length>=maxPairs)break;}if(pairs.length<minPairs)continue;const fit=robustAffine(pairs);if(!fit||fit.inliers<minPairs||!(fit.a>1e-7))continue;const qA=deepQuality(A),qB=deepQuality(B),confidence=clamp((e.visualConfidence??e.weight??.1)*fit.confidence*Math.sqrt(qA*qB),.002,1);pairEdges.push({a:e.a,b:e.b,aId:String(A.frameId),bId:String(B.frameId),aScale:fit.a,bOffset:fit.b,pairs:pairs.length,inliers:fit.inliers,relativeError:fit.relativeError,confidence});}
  const n=frames?.length||0,transforms=new Array(n).fill(null),frameConfidence=new Float32Array(n),parent=new Int32Array(n);parent.fill(-1);
  let root=-1,bestQ=-1;for(let i=0;i<n;i++){if(!frames[i]?.relativeDepth?.length)continue;const q=deepQuality(frames[i]);if(q>bestQ){root=i;bestQ=q;}}
  if(root>=0){transforms[root]={a:1,b:0};frameConfidence[root]=Math.max(.05,bestQ);const pending=new Set(pairEdges);for(let pass=0;pass<n&&pending.size;pass++){let best=null,score=-1;for(const e of pending){const ak=!!transforms[e.a],bk=!!transforms[e.b];if(ak===bk)continue;if(e.confidence>score){best=e;score=e.confidence;}}if(!best)break;pending.delete(best);if(transforms[best.a]&&!transforms[best.b]){const A=transforms[best.a];transforms[best.b]={a:A.a*best.aScale,b:A.a*best.bOffset+A.b};frameConfidence[best.b]=Math.max(.002,frameConfidence[best.a]*score);parent[best.b]=best.a;}else if(transforms[best.b]&&!transforms[best.a]){const B=transforms[best.b],ia=1/best.aScale,ib=-best.bOffset/best.aScale;transforms[best.a]={a:B.a*ia,b:B.a*ib+B.b};frameConfidence[best.a]=Math.max(.002,frameConfidence[best.b]*score);parent[best.a]=best.b;}}}
  const aligned=transforms.reduce((s,t)=>s+(t?1:0),0),errs=pairEdges.map(e=>e.relativeError).filter(Number.isFinite);return {format:'ROOMSCAN-PHOTO-DEPTH-CONSENSUS-1',root,transforms,frameConfidence,parent,edges:pairEdges,stats:{rawFrames:frames?.reduce((s,f)=>s+(f?.relativeDepth?.length?1:0),0)||0,alignedFrames:aligned,pairEdges:pairEdges.length,medianRelativeError:median(errs),meanConfidence:pairEdges.length?pairEdges.reduce((s,e)=>s+e.confidence,0)/pairEdges.length:0}};
}

export function sampleConsensusDepth(frame,transform,u,v){const raw=sampleRaw(frame,u,v);if(!transform||!Number.isFinite(raw))return NaN;return transform.a*raw+transform.b;}

function robustAffine(pairs){
  if(pairs.length<3)return null;let model=fitAffine(pairs),mask=pairs.map(()=>true);if(!model)return null;
  for(let it=0;it<6;it++){const residual=pairs.map((p,i)=>mask[i]?Math.abs(p.x-(model.a*p.y+model.b)):Infinity),finite=residual.filter(Number.isFinite),med=median(finite),mad=median(finite.map(x=>Math.abs(x-med))),scale=Math.max(1e-6,med+2.8*Math.max(mad,med*.08));mask=residual.map(r=>r<=scale);const kept=pairs.filter((_,i)=>mask[i]);if(kept.length<3)break;const m=fitAffine(kept);if(!m)break;model=m;}
  const kept=pairs.filter((_,i)=>mask[i]);if(kept.length<3)return null;const xs=kept.map(p=>p.x),spread=percentile(xs,.9)-percentile(xs,.1);if(Math.abs(spread)<1e-7)return null;const abs=kept.map(p=>Math.abs(p.x-(model.a*p.y+model.b))),rel=median(abs)/Math.max(1e-6,Math.abs(spread)),corr=weightedCorrelation(kept),confidence=clamp((kept.length/pairs.length)*Math.exp(-3.5*rel)*clamp((Math.abs(corr)-.12)/.70,0,1),.001,1);return {...model,inliers:kept.length,relativeError:rel,correlation:corr,confidence};
}
function fitAffine(ps){let sw=0,mx=0,my=0;for(const p of ps){sw+=p.w;mx+=p.w*p.y;my+=p.w*p.x;}if(sw<EPS)return null;mx/=sw;my/=sw;let xx=0,xy=0;for(const p of ps){xx+=p.w*(p.y-mx)*(p.y-mx);xy+=p.w*(p.y-mx)*(p.x-my);}if(xx<EPS)return null;const a=xy/xx,b=my-a*mx;return Number.isFinite(a)&&Number.isFinite(b)?{a,b}:null;}
function weightedCorrelation(ps){let sw=0,mx=0,my=0;for(const p of ps){sw+=p.w;mx+=p.w*p.x;my+=p.w*p.y;}if(sw<EPS)return 0;mx/=sw;my/=sw;let xx=0,yy=0,xy=0;for(const p of ps){xx+=p.w*(p.x-mx)**2;yy+=p.w*(p.y-my)**2;xy+=p.w*(p.x-mx)*(p.y-my);}return xx>EPS&&yy>EPS?xy/Math.sqrt(xx*yy):0;}
function sampleRaw(f,u,v){if(!f?.relativeDepth?.length)return NaN;const w=f.relativeDepthWidth,h=f.relativeDepthHeight,x=clamp(u/Math.max(1,f.width)*(w-1),0,w-1),y=clamp(v/Math.max(1,f.height)*(h-1),0,h-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,vals=[[f.relativeDepth[y0*w+x0],(1-tx)*(1-ty)],[f.relativeDepth[y0*w+x1],tx*(1-ty)],[f.relativeDepth[y1*w+x0],(1-tx)*ty],[f.relativeDepth[y1*w+x1],tx*ty]].filter(([v])=>Number.isFinite(v));let s=0,sw=0;for(const [v,ww] of vals){s+=v*ww;sw+=ww;}return sw>EPS?s/sw:NaN;}
function deepQuality(f){const base=clamp(Number(f.relativeConfidence||.12),.01,1),q=f.relativeQuality;if(!q)return base;let p=1;if(q.suspicious)p*=.28;if(q.stripe?.suspicious)p*=.35;if(Number.isFinite(q.coherenceRatio)&&q.coherenceRatio>0)p*=clamp(q.coherenceRatio,.2,1);return clamp(base*p,.005,1);}
function percentile(a,p){if(!a.length)return NaN;const b=a.slice().sort((x,y)=>x-y),x=clamp(p,0,1)*(b.length-1),i=Math.floor(x),t=x-i;return b[i]*(1-t)+b[Math.min(b.length-1,i+1)]*t;}function median(a){return a.length?percentile(a,.5):Infinity;}
