/**
 * Final-pose MVS revalidation with explicit depth observability.
 *
 * V30.42 counted a source frame as "independent" when its patch had low
 * photometric cost. That is not sufficient: under pure rotation or a tiny
 * baseline the same patch can agree for a wide interval of depths. V30.43
 * therefore distinguishes photometric support from geometrically observable
 * support. Only views with real parallax / depth sensitivity can authorize a
 * committed 3-D sample.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DEG=Math.PI/180;

export function revalidateMvsSample(sample,refFrame,sourceFrames,{
  candidateCount=13,maxSources=6,minSources=1,patchRadius=2,maxCost=.36,
  minDistinctiveness=.010,maxCorrectionRel=.90,minParallaxRad=1.0*DEG,
  strongParallaxRad=2.0*DEG,minDepthSensitivityPx=.24,depthHint=null,
  minDepth=.15,maxDepth=15
}={}){
  const priorDepth=Number(sample?.depth),sigma=Math.max(1e-4,Number(sample?.sigmaDepth)||priorDepth*.08);
  if(!(priorDepth>.05)||!refFrame?.poseEstimate||!refFrame?.K)return reject('invalid-input',priorDepth);
  const refPhoto=usablePhoto(refFrame);if(!refPhoto)return reject('missing-reference-photo',priorDepth);
  const allSources=(sourceFrames||[]).filter(f=>f&&String(f.frameId)!==String(refFrame.frameId)&&f.poseEstimate&&usablePhoto(f));
  const sources=selectSourcesByBaseline(refFrame,allSources,Math.max(1,maxSources|0));
  if(sources.length<Math.max(1,minSources|0))return reject('insufficient-source-photos',priorDepth,{availableSources:sources.length});
  const refUv=toPhotoUv(refFrame,refPhoto,Number(sample.u),Number(sample.v)),refPatch=extractPatch(refPhoto.gray,refPhoto.width,refPhoto.height,refUv.u,refUv.v,patchRadius);
  if(!refPatch)return reject('reference-patch-outside',priorDepth);

  const candidates=buildDepthCandidates(priorDepth,sigma,{candidateCount,maxCorrectionRel,depthHint,minDepth,maxDepth});
  const scored=[];
  for(const depth of candidates){
    const world=unproject(refFrame.poseEstimate,refFrame.K,Number(sample.u),Number(sample.v),depth),perSource=[];
    for(const src of sources){
      const q=projectPoint(src.poseEstimate,src.K,world);if(!q||q.z<=.05||q.u<0||q.v<0||q.u>=src.K.width||q.v>=src.K.height)continue;
      const sp=usablePhoto(src),uv=toPhotoUv(src,sp,q.u,q.v),patch=extractPatch(sp.gray,sp.width,sp.height,uv.u,uv.v,patchRadius);if(!patch)continue;
      const zn=zncc(refPatch,patch);if(!Number.isFinite(zn))continue;
      const parallaxRad=triangulationAngle(refFrame.poseEstimate,src.poseEstimate,world),depthSensitivityPx=depthSensitivity(refFrame,src,Number(sample.u),Number(sample.v),depth,sp);
      perSource.push({id:String(src.frameId),cost:clamp((1-zn)*.5,0,1),zncc:zn,parallaxRad,depthSensitivityPx,baseline:cameraBaseline(refFrame,src)});
    }
    if(perSource.length<Math.max(1,minSources|0))continue;
    perSource.sort((a,b)=>a.cost-b.cost);const photoBest=perSource.slice(0,Math.max(1,maxSources|0)),cost=robustMedian(photoBest.map(x=>x.cost));
    scored.push({depth,cost,perSource:photoBest});
  }
  if(!scored.length)return reject('no-projectable-candidate',priorDepth,{availableSources:sources.length});
  scored.sort((a,b)=>a.cost-b.cost);const best=scored[0],second=scored.find(x=>Math.abs(Math.log(x.depth/best.depth))>.025)??scored[1]??best,distinctiveness=Math.max(0,(second?.cost??best.cost)-best.cost),correctionRel=Math.abs(best.depth-priorDepth)/priorDepth;
  const photoVerified=best.perSource.filter(x=>x.cost<=Math.min(maxCost,best.cost+.09));
  const geometricallyVerified=photoVerified.filter(x=>x.parallaxRad>=minParallaxRad&&x.depthSensitivityPx>=minDepthSensitivityPx);
  const strongVerified=geometricallyVerified.filter(x=>x.parallaxRad>=strongParallaxRad&&x.depthSensitivityPx>=minDepthSensitivityPx*1.5);
  const maxParallaxRad=Math.max(0,...photoVerified.map(x=>x.parallaxRad||0)),meanParallaxRad=mean(geometricallyVerified.map(x=>x.parallaxRad)),meanDepthSensitivityPx=mean(geometricallyVerified.map(x=>x.depthSensitivityPx)),medianBaseline=robustMedian(geometricallyVerified.map(x=>x.baseline));
  const priorAgreement=Math.exp(-.5*((best.depth-priorDepth)/Math.max(sigma,priorDepth*.02))**2),photoQuality=clamp(1-best.cost/Math.max(.12,maxCost),0,1),distinctQuality=clamp(distinctiveness/Math.max(.008,minDistinctiveness*2.5),0,1),geometryQuality=clamp((maxParallaxRad/minParallaxRad-1)/2,0,1),confidence=clamp(.08+.38*photoQuality+.18*distinctQuality+.22*geometryQuality+.14*priorAgreement,.01,.99);

  const common={bestDepth:best.depth,cost:best.cost,distinctiveness,correctionRel,availableSources:sources.length,photometricSources:photoVerified.length,observableSources:geometricallyVerified.length,strongObservableSources:strongVerified.length,maxParallaxRad,meanParallaxRad,meanDepthSensitivityPx,medianBaseline};
  if(best.cost>maxCost)return reject('photometric-cost-high',priorDepth,common);
  if(!(best.depth>=minDepth&&best.depth<=maxDepth))return reject('depth-outside-scaffold-range',priorDepth,common);
  if(correctionRel>maxCorrectionRel*1.02)return reject('depth-correction-too-large',priorDepth,common);
  if(geometricallyVerified.length<Math.max(1,minSources|0))return reject('insufficient-depth-observability',priorDepth,common);
  // A nearly flat photometric minimum is not depth evidence. V30.42 had a
  // best.cost<.025 bypass which accepted pure-rotation matches. Keep only a
  // narrow exception when two strongly-parallaxed views agree and the update is
  // tiny, i.e. the stored value is merely being re-confirmed.
  if(distinctiveness<minDistinctiveness&&!(strongVerified.length>=2&&correctionRel<.025&&best.cost<.08))return reject('photometric-minimum-depth-ambiguous',priorDepth,common);
  return {accepted:true,reason:'final-pose-observable-photometric-support',depth:best.depth,priorDepth,correctionRel,cost:best.cost,distinctiveness,confidence,
    verifiedSourceIds:geometricallyVerified.map(x=>x.id),photometricSourceIds:photoVerified.map(x=>x.id),sourceCosts:geometricallyVerified,availableSources:sources.length,candidates:scored.length,
    maxParallaxRad,meanParallaxRad,meanDepthSensitivityPx,medianBaseline,observableSources:geometricallyVerified.length,strongObservableSources:strongVerified.length};
}

export function mvsRelativePoseDrift(refFrame,sourceFrames=[]){
  const out=[];for(const s of sourceFrames||[]){if(!refFrame?.posePrior||!refFrame?.poseEstimate||!s?.posePrior||!s?.poseEstimate)continue;const p0=relativeTranslation(refFrame.posePrior,s.posePrior),p1=relativeTranslation(refFrame.poseEstimate,s.poseEstimate),dt=Math.hypot(p0[0]-p1[0],p0[1]-p1[1],p0[2]-p1[2]),q0=relativeQuat(refFrame.posePrior,s.posePrior),q1=relativeQuat(refFrame.poseEstimate,s.poseEstimate),dq=qNormalize(qMul(qConj(q0),q1)),dr=2*Math.atan2(Math.hypot(dq[0],dq[1],dq[2]),Math.max(1e-12,Math.abs(dq[3])));out.push({frameId:String(s.frameId),translation:dt,rotationRad:dr});}return out;
}

function buildDepthCandidates(priorDepth,sigma,{candidateCount,maxCorrectionRel,depthHint,minDepth,maxDepth}){
  const vals=[],n=Math.max(7,(candidateCount|0)|1),half=(n-1)/2,relSpan=clamp(Math.max(.10,3.5*sigma/priorDepth),.10,maxCorrectionRel),logSpan=Math.log1p(relSpan);
  for(let i=0;i<n;i++){const t=(i-half)/Math.max(1,half);vals.push(priorDepth*Math.exp(t*logSpan));}
  if(Number.isFinite(+depthHint)&&+depthHint>minDepth){const h=+depthHint;for(const r of [.72,.86,1,1.16,1.38])vals.push(h*r);}
  vals.push(priorDepth);return [...new Set(vals.map(x=>clamp(x,minDepth,maxDepth)).filter(x=>x>=minDepth&&x<=maxDepth).map(x=>Math.round(x*1e5)/1e5))].sort((a,b)=>a-b);
}
function selectSourcesByBaseline(ref,sources,max){return (sources||[]).map(s=>({s,b:cameraBaseline(ref,s)})).sort((a,b)=>b.b-a.b).slice(0,max).map(x=>x.s);}
function cameraBaseline(a,b){return Math.hypot((b.poseEstimate?.p?.[0]||0)-(a.poseEstimate?.p?.[0]||0),(b.poseEstimate?.p?.[1]||0)-(a.poseEstimate?.p?.[1]||0),(b.poseEstimate?.p?.[2]||0)-(a.poseEstimate?.p?.[2]||0));}
function triangulationAngle(a,b,p){const u=[p[0]-a.p[0],p[1]-a.p[1],p[2]-a.p[2]],v=[p[0]-b.p[0],p[1]-b.p[1],p[2]-b.p[2]],nu=Math.hypot(...u)||1,nv=Math.hypot(...v)||1;return Math.acos(clamp((u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/(nu*nv),-1,1));}
function depthSensitivity(ref,src,u,v,z,srcPhoto){const dz=.06,za=z*Math.exp(-dz),zb=z*Math.exp(dz),pa=unproject(ref.poseEstimate,ref.K,u,v,za),pb=unproject(ref.poseEstimate,ref.K,u,v,zb),qa=projectPoint(src.poseEstimate,src.K,pa),qb=projectPoint(src.poseEstimate,src.K,pb);if(!qa||!qb)return 0;const a=toPhotoUv(src,srcPhoto,qa.u,qa.v),b=toPhotoUv(src,srcPhoto,qb.u,qb.v);return Math.hypot(a.u-b.u,a.v-b.v);}
function reject(reason,priorDepth,extra={}){return {accepted:false,reason,depth:priorDepth,priorDepth,correctionRel:0,cost:null,distinctiveness:null,confidence:0,verifiedSourceIds:[],photometricSourceIds:[],sourceCosts:[],observableSources:0,strongObservableSources:0,...extra};}
function usablePhoto(f){const p=f?.photo;return p?.gray?.length&&p.width>4&&p.height>4?p:null;}
function toPhotoUv(frame,photo,u,v){const fw=Math.max(1,Number(frame?.K?.width||frame?.width||photo.width)),fh=Math.max(1,Number(frame?.K?.height||frame?.height||photo.height));return {u:u*photo.width/fw,v:v*photo.height/fh};}
function extractPatch(gray,w,h,u,v,r){if(!gray?.length||u<r+1||v<r+1||u>w-r-2||v>h-r-2)return null;const out=[];for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)out.push(bilinear(gray,w,h,u+dx,v+dy));return out;}
function bilinear(a,w,h,x,y){const x0=Math.max(0,Math.min(w-1,Math.floor(x))),y0=Math.max(0,Math.min(h-1,Math.floor(y))),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,v00=Number(a[y0*w+x0]),v10=Number(a[y0*w+x1]),v01=Number(a[y1*w+x0]),v11=Number(a[y1*w+x1]);return (v00*(1-tx)+v10*tx)*(1-ty)+(v01*(1-tx)+v11*tx)*ty;}
function zncc(a,b){if(!a||!b||a.length!==b.length||a.length<5)return NaN;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let aa=0,bb=0,ab=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;aa+=x*x;bb+=y*y;ab+=x*y;}const d=Math.sqrt(aa*bb);return d>1e-8?clamp(ab/d,-1,1):NaN;}
function robustMedian(xs){const a=(xs||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return Infinity;const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])*.5;}
function mean(xs){const a=(xs||[]).filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:0;}
function unproject(pose,K,u,v,z){const x=(u-K.cx)/Math.max(1e-9,K.fx)*z,y=(v-K.cy)/Math.max(1e-9,K.fy)*z,w=qRotate(pose.q,[x,y,z]);return [pose.p[0]+w[0],pose.p[1]+w[1],pose.p[2]+w[2]];}
function projectPoint(pose,K,p){const d=[p[0]-pose.p[0],p[1]-pose.p[1],p[2]-pose.p[2]],c=qRotate(qConj(pose.q),d),z=c[2];if(!(z>1e-7))return null;return {u:K.fx*c[0]/z+K.cx,v:K.fy*c[1]/z+K.cy,z};}
function relativeTranslation(a,b){return qRotate(qConj(a.q),[b.p[0]-a.p[0],b.p[1]-a.p[1],b.p[2]-a.p[2]]);}
function relativeQuat(a,b){return qNormalize(qMul(qConj(a.q),b.q));}
function qConj(q){return [-q[0],-q[1],-q[2],q[3]];}
function qMul(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(x=>x/n);}
function qRotate(q,v){const n=qNormalize(q),x=n[0],y=n[1],z=n[2],w=n[3],tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];}
