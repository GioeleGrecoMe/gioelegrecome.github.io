/**
 * Final-pose MVS revalidation.
 *
 * Stored plane-sweep depths were estimated under the acquisition poses. They
 * are proposals, not immutable metric measurements. At committed rebuild time
 * we rescore a compact inverse-depth neighbourhood against the downsampled RGB
 * photographs using the CURRENT optimized poses. Only source views that still
 * support the winning depth are returned as independent evidence.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function revalidateMvsSample(sample,refFrame,sourceFrames,{candidateCount=9,maxSources=4,minSources=1,patchRadius=2,maxCost=.38,minDistinctiveness=.012,maxCorrectionRel=.40}={}){
  const priorDepth=Number(sample?.depth),sigma=Math.max(1e-4,Number(sample?.sigmaDepth)||priorDepth*.06);
  if(!(priorDepth>.08)||!refFrame?.poseEstimate||!refFrame?.K)return reject('invalid-input',priorDepth);
  const refPhoto=usablePhoto(refFrame);if(!refPhoto)return reject('missing-reference-photo',priorDepth);
  const sources=(sourceFrames||[]).filter(f=>f&&String(f.frameId)!==String(refFrame.frameId)&&f.poseEstimate&&usablePhoto(f)).slice(0,Math.max(1,maxSources|0));
  if(sources.length<Math.max(1,minSources|0))return reject('insufficient-source-photos',priorDepth,{availableSources:sources.length});
  const refUv=toPhotoUv(refFrame,refPhoto,Number(sample.u),Number(sample.v)),refPatch=extractPatch(refPhoto.gray,refPhoto.width,refPhoto.height,refUv.u,refUv.v,patchRadius);
  if(!refPatch)return reject('reference-patch-outside',priorDepth);
  const relSpan=clamp(Math.max(.055,3.2*sigma/priorDepth),.055,maxCorrectionRel),n=Math.max(5,(candidateCount|0)|1),half=(n-1)/2,logSpan=Math.log1p(relSpan),candidates=[];
  for(let i=0;i<n;i++){
    const t=(i-half)/Math.max(1,half),depth=priorDepth*Math.exp(t*logSpan),world=unproject(refFrame.poseEstimate,refFrame.K,Number(sample.u),Number(sample.v),depth),perSource=[];
    for(const src of sources){const q=projectPoint(src.poseEstimate,src.K,world);if(!q||q.z<=.05||q.u<0||q.v<0||q.u>=src.K.width||q.v>=src.K.height)continue;const sp=usablePhoto(src),uv=toPhotoUv(src,sp,q.u,q.v),patch=extractPatch(sp.gray,sp.width,sp.height,uv.u,uv.v,patchRadius);if(!patch)continue;const zn=zncc(refPatch,patch);if(!Number.isFinite(zn))continue;perSource.push({id:String(src.frameId),cost:clamp((1-zn)*.5,0,1),zncc:zn});}
    if(perSource.length<Math.max(1,minSources|0))continue;perSource.sort((a,b)=>a.cost-b.cost);const usable=perSource.slice(0,Math.max(1,maxSources|0)),cost=robustMedian(usable.map(x=>x.cost));candidates.push({depth,cost,perSource:usable});
  }
  if(!candidates.length)return reject('no-projectable-candidate',priorDepth,{availableSources:sources.length});
  candidates.sort((a,b)=>a.cost-b.cost);const best=candidates[0],second=candidates.find(x=>Math.abs(Math.log(x.depth/best.depth))>.018)??candidates[1]??best,distinctiveness=Math.max(0,(second?.cost??best.cost)-best.cost),verified=best.perSource.filter(x=>x.cost<=Math.min(maxCost,best.cost+.10)),correctionRel=Math.abs(best.depth-priorDepth)/priorDepth;
  const priorAgreement=Math.exp(-.5*((best.depth-priorDepth)/Math.max(sigma,priorDepth*.018))**2),photoQuality=clamp(1-best.cost/Math.max(.12,maxCost),0,1),distinctQuality=clamp(distinctiveness/Math.max(.008,minDistinctiveness*2.5),0,1),confidence=clamp(.12+.50*photoQuality+.22*distinctQuality+.16*priorAgreement,.02,.99);
  if(best.cost>maxCost)return reject('photometric-cost-high',priorDepth,{bestDepth:best.depth,cost:best.cost,distinctiveness,correctionRel,availableSources:sources.length});
  if(correctionRel>maxCorrectionRel*1.02)return reject('depth-correction-too-large',priorDepth,{bestDepth:best.depth,cost:best.cost,distinctiveness,correctionRel});
  // Flat photometric minima are only acceptable when they leave the stored MVS
  // depth essentially unchanged and at least two final-pose views agree.
  if(distinctiveness<minDistinctiveness&&!(best.cost<.025||correctionRel<.035&&verified.length>=2))return reject('photometric-minimum-ambiguous',priorDepth,{bestDepth:best.depth,cost:best.cost,distinctiveness,correctionRel,verifiedSources:verified.length});
  if(verified.length<Math.max(1,minSources|0))return reject('insufficient-final-view-support',priorDepth,{bestDepth:best.depth,cost:best.cost,verifiedSources:verified.length});
  return {accepted:true,reason:'final-pose-photometric-support',depth:best.depth,priorDepth,correctionRel,cost:best.cost,distinctiveness,confidence,verifiedSourceIds:verified.map(x=>x.id),sourceCosts:verified,availableSources:sources.length,candidates:candidates.length};
}

export function mvsRelativePoseDrift(refFrame,sourceFrames=[]){
  const out=[];for(const s of sourceFrames||[]){if(!refFrame?.posePrior||!refFrame?.poseEstimate||!s?.posePrior||!s?.poseEstimate)continue;const p0=relativeTranslation(refFrame.posePrior,s.posePrior),p1=relativeTranslation(refFrame.poseEstimate,s.poseEstimate),dt=Math.hypot(p0[0]-p1[0],p0[1]-p1[1],p0[2]-p1[2]),q0=relativeQuat(refFrame.posePrior,s.posePrior),q1=relativeQuat(refFrame.poseEstimate,s.poseEstimate),dq=qNormalize(qMul(qConj(q0),q1)),dr=2*Math.atan2(Math.hypot(dq[0],dq[1],dq[2]),Math.max(1e-12,Math.abs(dq[3])));out.push({frameId:String(s.frameId),translation:dt,rotationRad:dr});}return out;
}

function reject(reason,priorDepth,extra={}){return {accepted:false,reason,depth:priorDepth,priorDepth,correctionRel:0,cost:null,distinctiveness:null,confidence:0,verifiedSourceIds:[],sourceCosts:[],...extra};}
function usablePhoto(f){const p=f?.photo;return p?.gray?.length&&p.width>4&&p.height>4?p:null;}
function toPhotoUv(frame,photo,u,v){const fw=Math.max(1,Number(frame?.K?.width||frame?.width||photo.width)),fh=Math.max(1,Number(frame?.K?.height||frame?.height||photo.height));return {u:u*photo.width/fw,v:v*photo.height/fh};}
function extractPatch(gray,w,h,u,v,r){if(!gray?.length||u<r+1||v<r+1||u>w-r-2||v>h-r-2)return null;const out=[];for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)out.push(bilinear(gray,w,h,u+dx,v+dy));return out;}
function bilinear(a,w,h,x,y){const x0=Math.max(0,Math.min(w-1,Math.floor(x))),y0=Math.max(0,Math.min(h-1,Math.floor(y))),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,v00=Number(a[y0*w+x0]),v10=Number(a[y0*w+x1]),v01=Number(a[y1*w+x0]),v11=Number(a[y1*w+x1]);return (v00*(1-tx)+v10*tx)*(1-ty)+(v01*(1-tx)+v11*tx)*ty;}
function zncc(a,b){if(!a||!b||a.length!==b.length||a.length<5)return NaN;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let aa=0,bb=0,ab=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;aa+=x*x;bb+=y*y;ab+=x*y;}const d=Math.sqrt(aa*bb);return d>1e-8?clamp(ab/d,-1,1):NaN;}
function robustMedian(xs){const a=(xs||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return Infinity;const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])*.5;}
function unproject(pose,K,u,v,z){const x=(u-K.cx)/Math.max(1e-9,K.fx)*z,y=(v-K.cy)/Math.max(1e-9,K.fy)*z,w=qRotate(pose.q,[x,y,z]);return [pose.p[0]+w[0],pose.p[1]+w[1],pose.p[2]+w[2]];}
function projectPoint(pose,K,p){const d=[p[0]-pose.p[0],p[1]-pose.p[1],p[2]-pose.p[2]],c=qRotate(qConj(pose.q),d),z=c[2];if(!(z>1e-7))return null;return {u:K.fx*c[0]/z+K.cx,v:K.fy*c[1]/z+K.cy,z};}
function relativeTranslation(a,b){return qRotate(qConj(a.q),[b.p[0]-a.p[0],b.p[1]-a.p[1],b.p[2]-a.p[2]]);}
function relativeQuat(a,b){return qNormalize(qMul(qConj(a.q),b.q));}
function qConj(q){return [-q[0],-q[1],-q[2],q[3]];}
function qMul(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(x=>x/n);}
function qRotate(q,v){const n=qNormalize(q),x=n[0],y=n[1],z=n[2],w=n[3],tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];}
