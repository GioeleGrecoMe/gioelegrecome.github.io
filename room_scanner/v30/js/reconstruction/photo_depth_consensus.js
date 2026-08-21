import {projectPixelAcrossEdge} from './photo_panorama.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-9;

/**
 * Global photo-overlap alignment for monocular Depth Anything maps.
 *
 * The live depth preview must not propagate scale frame-by-frame: that makes
 * scale/offset drift accumulate and a later high-quality frame can recolour the
 * whole atlas.  Instead every RGB-verified overlap contributes equations
 *
 *      a_i * D_i(p) + b_i  ~=  a_j * D_j(q) + b_j
 *
 * and all frame (a,b) pairs are solved together with IRLS.  The panorama root
 * is a fixed gauge (a=1,b=0), so the latent relative-depth colour scale remains
 * stable while new frames and loop closures improve the solution globally.
 */
export function solvePhotoDepthConsensus(frames,edges,{minPairs=6,maxPairs=140,rootIndex=0,irlsIterations=4}={}){
  const pairEdges=[],constraints=[];
  for(const e of edges||[]){
    const A=frames?.[e.a],B=frames?.[e.b];if(!A?.relativeDepth?.length||!B?.relativeDepth?.length)continue;
    const pairs=collectOverlapPairs(A,B,e,maxPairs);
    if(pairs.length<minPairs)continue;const fit=robustAffine(pairs);if(!fit||fit.inliers<minPairs||!(fit.a>1e-7))continue;
    const qA=deepQuality(A),qB=deepQuality(B),confidence=clamp((e.visualConfidence??e.weight??.1)*fit.confidence*Math.sqrt(qA*qB),.002,1),pe={a:e.a,b:e.b,aId:String(A.frameId),bId:String(B.frameId),aScale:fit.a,bOffset:fit.b,pairs:pairs.length,inliers:fit.inliers,relativeError:fit.relativeError,confidence};pairEdges.push(pe);
    for(const p of fit.kept)constraints.push({a:e.a,b:e.b,x:p.x,y:p.y,w:Math.max(.0002,p.w*confidence)});
  }
  const n=frames?.length||0,transforms=new Array(n).fill(null),frameConfidence=new Float32Array(n),parent=new Int32Array(n);parent.fill(-1);
  if(!n)return emptyResult(n,pairEdges,transforms,frameConfidence,parent,-1);
  let root=Number.isInteger(rootIndex)&&rootIndex>=0&&rootIndex<n&&frames[rootIndex]?.relativeDepth?.length?rootIndex:-1;if(root<0)root=frames.findIndex(f=>f?.relativeDepth?.length);
  if(root<0)return emptyResult(n,pairEdges,transforms,frameConfidence,parent,-1);
  const component=componentContaining(n,pairEdges,root).filter(i=>frames[i]?.relativeDepth?.length);if(!component.length){transforms[root]={a:1,b:0};frameConfidence[root]=Math.max(.05,deepQuality(frames[root]));return finish(frames,pairEdges,transforms,frameConfidence,parent,root,component);}
  const solved=solveGlobalAffine(component,constraints,root,{iterations:irlsIterations});
  if(solved){for(const i of component){const t=solved.transforms.get(i);if(!t||!(t.a>1e-8)||!Number.isFinite(t.b))continue;transforms[i]={a:t.a,b:t.b};const support=solved.support.get(i)||{count:0,error:Infinity,weight:0},q=deepQuality(frames[i]),err=Number.isFinite(support.error)?support.error:1,obs=1-Math.exp(-support.count/14);frameConfidence[i]=clamp((i===root?.95:.12+.78*obs)*q*Math.exp(-2.8*Math.min(1,err)),.004,1);}}
  if(!transforms[root]){transforms[root]={a:1,b:0};frameConfidence[root]=Math.max(.08,deepQuality(frames[root]));}
  return finish(frames,pairEdges,transforms,frameConfidence,parent,root,component,solved?.globalResidual);
}

export function sampleConsensusDepth(frame,transform,u,v){const raw=sampleRaw(frame,u,v);if(!transform||!Number.isFinite(raw))return NaN;return transform.a*raw+transform.b;}

function finish(frames,pairEdges,transforms,frameConfidence,parent,root,component,globalResidual=Infinity){
  const aligned=transforms.reduce((s,t)=>s+(t?1:0),0),errs=pairEdges.map(e=>e.relativeError).filter(Number.isFinite),range=globalDepthRange(frames,transforms,frameConfidence),stats={rawFrames:frames?.reduce((s,f)=>s+(f?.relativeDepth?.length?1:0),0)||0,alignedFrames:aligned,pairEdges:pairEdges.length,medianRelativeError:median(errs),globalResidual:Number.isFinite(globalResidual)?globalResidual:Infinity,meanConfidence:pairEdges.length?pairEdges.reduce((s,e)=>s+e.confidence,0)/pairEdges.length:0,globalLow:range?.lo??null,globalHigh:range?.hi??null};
  return {format:'ROOMSCAN-PHOTO-DEPTH-CONSENSUS-2',root,component,transforms,frameConfidence,parent,edges:pairEdges,globalRange:range,representation:'relative-disparity-global',stats};
}
function emptyResult(n,pairEdges,transforms,frameConfidence,parent,root){return {format:'ROOMSCAN-PHOTO-DEPTH-CONSENSUS-2',root,component:root>=0?[root]:[],transforms,frameConfidence,parent,edges:pairEdges,globalRange:null,representation:'relative-disparity-global',stats:{rawFrames:0,alignedFrames:0,pairEdges:pairEdges.length,medianRelativeError:Infinity,globalResidual:Infinity,meanConfidence:0,globalLow:null,globalHigh:null}};}

function solveGlobalAffine(component,constraints,root,{iterations=4}={}){
  const ids=new Map(component.map((x,i)=>[x,i])),dim=component.length*2;if(!dim)return null;const robust=new Float64Array(constraints.length);robust.fill(1);let solution=null,globalResidual=Infinity;
  for(let it=0;it<Math.max(1,iterations);it++){
    const M=Array.from({length:dim},()=>new Float64Array(dim)),Y=new Float64Array(dim);
    const addEq=(terms,rhs,w)=>{if(!(w>0))return;for(const [ii,ci] of terms){Y[ii]+=w*ci*rhs;for(const [jj,cj] of terms)M[ii][jj]+=w*ci*cj;}};
    constraints.forEach((c,k)=>{const ia=ids.get(c.a),ib=ids.get(c.b);if(ia==null||ib==null)return;addEq([[ia*2,c.x],[ia*2+1,1],[ib*2,-c.y],[ib*2+1,-1]],0,c.w*robust[k]);});
    for(let k=0;k<component.length;k++){addEq([[k*2,1]],1,1e-5);addEq([[k*2+1,1]],0,1e-6);}const r=ids.get(root);addEq([[r*2,1]],1,1e5);addEq([[r*2+1,1]],0,1e5);
    solution=solveSquare(M,Y);if(!solution)break;
    const residuals=constraints.map(c=>{const ia=ids.get(c.a),ib=ids.get(c.b);if(ia==null||ib==null)return Infinity;return Math.abs(solution[ia*2]*c.x+solution[ia*2+1]-solution[ib*2]*c.y-solution[ib*2+1]);}),finite=residuals.filter(Number.isFinite),med=median(finite),mad=median(finite.map(x=>Math.abs(x-med))),gate=Math.max(1e-5,med+2.8*Math.max(mad,med*.12));globalResidual=med;for(let k=0;k<robust.length;k++){const r0=residuals[k];robust[k]=Number.isFinite(r0)?Math.min(1,gate/Math.max(gate,r0)):0;}
  }
  if(!solution)return null;const transforms=new Map(),support=new Map();for(const [frame,idx] of ids){transforms.set(frame,{a:solution[idx*2],b:solution[idx*2+1]});support.set(frame,{count:0,error:0,weight:0});}
  constraints.forEach((c,k)=>{const ta=transforms.get(c.a),tb=transforms.get(c.b);if(!ta||!tb)return;const r=Math.abs(ta.a*c.x+ta.b-(tb.a*c.y+tb.b)),w=c.w*(robust[k]||0);for(const i of [c.a,c.b]){const s=support.get(i);s.count++;s.error+=w*r;s.weight+=w;}});for(const s of support.values())s.error=s.weight>EPS?s.error/s.weight:Infinity;return {transforms,support,globalResidual};
}

function collectOverlapPairs(A,B,e,maxPairs){
  const out=[],seen=new Set(),push=(ua,va,ub,vb,w)=>{const key=`${Math.round(ua/3)}:${Math.round(va/3)}:${Math.round(ub/3)}:${Math.round(vb/3)}`;if(seen.has(key))return;const x=sampleRaw(A,ua,va),y=sampleRaw(B,ub,vb);if(!Number.isFinite(x)||!Number.isFinite(y))return;seen.add(key);out.push({x,y,w:clamp(w,.005,1),aU:ua,aV:va,bU:ub,bV:vb});};
  // Verified feature correspondences are the highest-authority samples.
  for(const m of e.matches||[]){push(m.aU,m.aV,m.bU,m.bV,clamp(Number(m.probability||.1)*Number(m.photometricProbability??1),.02,1));if(out.length>=maxPairs)return out;}
  // Then densify the actual spherical overlap. This makes scale/shift estimation
  // depend on the whole common region rather than a handful of feature corners.
  if(e?.rotationBToA?.length===9){const nx=14,ny=10;for(let gy=1;gy<ny-1&&out.length<maxPairs;gy++)for(let gx=1;gx<nx-1&&out.length<maxPairs;gx++){const ua=(gx+.5)/nx*A.width,va=(gy+.5)/ny*A.height,p=projectPixelAcrossEdge(A,B,e,'a',ua,va);if(!p)continue;const ga=sampleGray(A,ua,va),gb=sampleGray(B,p.u,p.v);if(!Number.isFinite(ga)||!Number.isFinite(gb))continue;const diff=Math.abs(ga-gb),photo=Math.exp(-diff/52);if(photo<.22)continue;const edge=Math.min(ua/A.width,1-ua/A.width,va/A.height,1-va/A.height),centre=clamp(edge/.18,0,1);push(ua,va,p.u,p.v,.18+.62*photo*(.35+.65*centre));}}
  return out;
}
function sampleGray(f,u,v){if(!f?.gray?.length)return NaN;const x=clamp(u,0,f.width-1),y=clamp(v,0,f.height-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(f.width-1,x0+1),y1=Math.min(f.height-1,y0+1),tx=x-x0,ty=y-y0;return f.gray[y0*f.width+x0]*(1-tx)*(1-ty)+f.gray[y0*f.width+x1]*tx*(1-ty)+f.gray[y1*f.width+x0]*(1-tx)*ty+f.gray[y1*f.width+x1]*tx*ty;}
function robustAffine(pairs){
  if(pairs.length<3)return null;let model=fitAffine(pairs),mask=pairs.map(()=>true);if(!model)return null;
  for(let it=0;it<7;it++){const residual=pairs.map((p,i)=>mask[i]?Math.abs(p.x-(model.a*p.y+model.b)):Infinity),finite=residual.filter(Number.isFinite),med=median(finite),mad=median(finite.map(x=>Math.abs(x-med))),scale=Math.max(1e-6,med+2.8*Math.max(mad,med*.08));mask=residual.map(r=>r<=scale);const kept=pairs.filter((_,i)=>mask[i]);if(kept.length<3)break;const m=fitAffine(kept);if(!m)break;model=m;}
  const kept=pairs.filter((_,i)=>mask[i]);if(kept.length<3)return null;const xs=kept.map(p=>p.x),spread=percentile(xs,.9)-percentile(xs,.1);if(Math.abs(spread)<1e-7)return null;const abs=kept.map(p=>Math.abs(p.x-(model.a*p.y+model.b))),rel=median(abs)/Math.max(1e-6,Math.abs(spread)),corr=weightedCorrelation(kept),confidence=clamp((kept.length/pairs.length)*Math.exp(-3.5*rel)*clamp((Math.abs(corr)-.10)/.72,0,1),.001,1);return {...model,inliers:kept.length,relativeError:rel,correlation:corr,confidence,kept};
}
function fitAffine(ps){let sw=0,mx=0,my=0;for(const p of ps){sw+=p.w;mx+=p.w*p.y;my+=p.w*p.x;}if(sw<EPS)return null;mx/=sw;my/=sw;let xx=0,xy=0;for(const p of ps){xx+=p.w*(p.y-mx)*(p.y-mx);xy+=p.w*(p.y-mx)*(p.x-my);}if(xx<EPS)return null;const a=xy/xx,b=my-a*mx;return Number.isFinite(a)&&Number.isFinite(b)?{a,b}:null;}
function weightedCorrelation(ps){let sw=0,mx=0,my=0;for(const p of ps){sw+=p.w;mx+=p.w*p.x;my+=p.w*p.y;}if(sw<EPS)return 0;mx/=sw;my/=sw;let xx=0,yy=0,xy=0;for(const p of ps){xx+=p.w*(p.x-mx)**2;yy+=p.w*(p.y-my)**2;xy+=p.w*(p.x-mx)*(p.y-my);}return xx>EPS&&yy>EPS?xy/Math.sqrt(xx*yy):0;}
function sampleRaw(f,u,v){if(!f?.relativeDepth?.length)return NaN;const w=f.relativeDepthWidth,h=f.relativeDepthHeight,x=clamp(u/Math.max(1,f.width)*(w-1),0,w-1),y=clamp(v/Math.max(1,f.height)*(h-1),0,h-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,vals=[[f.relativeDepth[y0*w+x0],(1-tx)*(1-ty)],[f.relativeDepth[y0*w+x1],tx*(1-ty)],[f.relativeDepth[y1*w+x0],(1-tx)*ty],[f.relativeDepth[y1*w+x1],tx*ty]].filter(([v])=>Number.isFinite(v));let s=0,sw=0;for(const [v,ww] of vals){s+=v*ww;sw+=ww;}return sw>EPS?s/sw:NaN;}
function deepQuality(f){const base=clamp(Number(f.relativeConfidence||.12),.01,1),q=f.relativeQuality;if(!q)return base;let p=1;if(q.suspicious)p*=.28;if(q.stripe?.suspicious)p*=.35;if(Number.isFinite(q.coherenceRatio)&&q.coherenceRatio>0)p*=clamp(q.coherenceRatio,.2,1);return clamp(base*p,.005,1);}
function componentContaining(n,edges,root){const adj=Array.from({length:n},()=>[]);for(const e of edges||[]){if(e.a>=0&&e.b>=0&&e.a<n&&e.b<n){adj[e.a].push(e.b);adj[e.b].push(e.a);}}const seen=new Set([root]),q=[root];while(q.length){const i=q.pop();for(const j of adj[i])if(!seen.has(j)){seen.add(j);q.push(j);}}return [...seen];}
function globalDepthRange(frames,transforms,frameConfidence){const vals=[];for(let i=0;i<(frames?.length||0);i++){const f=frames[i],t=transforms[i],q=Number(frameConfidence?.[i]||0);if(!f?.relativeDepth?.length||!t||q<.01)continue;const step=Math.max(1,Math.ceil(f.relativeDepth.length/520));for(let k=0;k<f.relativeDepth.length;k+=step){const raw=f.relativeDepth[k],v=Number.isFinite(raw)?t.a*raw+t.b:NaN;if(Number.isFinite(v))vals.push(v);}}if(vals.length<8)return null;const lo=percentile(vals,.02),hi=percentile(vals,.98);if(!Number.isFinite(lo+hi)||hi-lo<1e-7)return null;return {lo,hi,p05:percentile(vals,.05),p95:percentile(vals,.95),samples:vals.length,policy:'global-all-aligned-frames'};}

function solveSquare(M,y){M=M.map(r=>Float64Array.from(r));y=Float64Array.from(y);const n=M.length;for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-12)return null;if(p!==c){const tr=M[c];M[c]=M[p];M[p]=tr;const ty=y[c];y[c]=y[p];y[p]=ty;}const d=M[c][c];for(let j=c;j<n;j++)M[c][j]/=d;y[c]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];if(Math.abs(f)<1e-15)continue;for(let j=c;j<n;j++)M[r][j]-=f*M[c][j];y[r]-=f*y[c];}}return [...y].every(Number.isFinite)?Array.from(y):null;}
function percentile(a,p){if(!a.length)return NaN;const b=a.filter(Number.isFinite).sort((x,y)=>x-y),x=clamp(p,0,1)*(b.length-1),i=Math.floor(x),t=x-i;return b[i]*(1-t)+b[Math.min(b.length-1,i+1)]*t;}function median(a){const b=(a||[]).filter(Number.isFinite);return b.length?percentile(b,.5):Infinity;}
