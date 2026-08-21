import {briefDescriptor,hammingDescriptor,patchZncc} from '../probabilistic/feature_tracker.js';
import {pixelRay,qNormalize,qRotate,qMul,qConj} from '../slam/math.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-9;

/**
 * Photo-first registration used by the live panorama.
 *
 * Deliberately does NOT use the Alva pose as an epipolar gate. A pose prior can
 * be wrong by enough pixels to reject the very observations that should later
 * correct it. Registration is therefore visual: BRIEF + ZNCC + mutual
 * uniqueness, followed by a robust image homography and a calibrated-ray
 * rotation estimate. Alva remains stored on every frame as a metric prior.
 */
export function matchPhotoFeatures(ref,src,{maxFeatures=320,maxMatches=180,maxHamming=70,minProbability=.035,patchRadius=2}={}){
  if(!ref?.gray?.length||!src?.gray?.length||!ref?.features?.length||!src?.features?.length)return [];
  const A=rankFeatures(ref.features,maxFeatures),B=rankFeatures(src.features,maxFeatures);
  const ad=A.map(f=>briefDescriptor(ref.gray,ref.width,ref.height,f.x,f.y));
  const bd=B.map(f=>briefDescriptor(src.gray,src.width,src.height,f.x,f.y));
  const bestA=new Array(A.length),bestB=new Array(B.length);
  for(let i=0;i<A.length;i++){
    let best=null,second=null;if(!ad[i])continue;
    for(let j=0;j<B.length;j++){
      if(!bd[j])continue;const ham=hammingDescriptor(ad[i],bd[j]);if(ham>maxHamming)continue;
      const zn=patchZncc(ref.gray,ref.width,ref.height,A[i].x,A[i].y,src.gray,src.width,src.height,B[j].x,B[j].y,patchRadius);
      if(zn<-.65)continue;
      const score=ham/128+.23*(1-zn)*.5,item={i,j,ham,zn,score};
      if(!best||score<best.score){second=best;best=item;}else if(!second||score<second.score)second=item;
    }
    if(best){best.ratio=second?best.score/Math.max(EPS,second.score):0;bestA[i]=best;}
  }
  for(let j=0;j<B.length;j++){let best=null;for(let i=0;i<A.length;i++){const x=bestA[i];if(!x||x.j!==j)continue;if(!best||x.score<best.score)best=x;}if(best)bestB[j]=best;}
  const out=[];
  for(let i=0;i<A.length;i++){
    const x=bestA[i];if(!x||bestB[x.j]!==x)continue;
    const descP=sigmoid((50-x.ham)/8),photoP=clamp((x.zn+.12)/1.12,0,1),uniqueP=clamp((.95-x.ratio)/.38,0,1),qA=featureQuality(A[i]),qB=featureQuality(B[x.j]);
    const p=Math.pow(Math.max(1e-7,descP*photoP*uniqueP*qA*qB),1/5);if(p<minProbability)continue;
    out.push({i:A[i].index,j:B[x.j].index,probability:p,descriptorProbability:descP,photometricProbability:photoP,uniquenessProbability:uniqueP,hamming:x.ham,zncc:x.zn,ratio:x.ratio,photoOnly:true});
  }
  return out.sort((a,b)=>b.probability-a.probability).slice(0,maxMatches);
}

/** Validate a photo overlap without trusting camera translation/orientation. */
export function buildPhotoRegistrationEdge(a,b,matches,{minMatches=7,ransacIterations=84,reprojectionPx=4.0,rotationInlierDeg=2.8}={}){
  const compact=[];
  for(const m of matches||[]){const fa=a?.features?.[m.i],fb=b?.features?.[m.j];if(!fa||!fb)continue;const aU=Number(fa.originalU??fa.x),aV=Number(fa.originalV??fa.y),bU=Number(fb.originalU??fb.x),bV=Number(fb.originalV??fb.y);if([aU,aV,bU,bV].every(Number.isFinite))compact.push({...m,aU,aV,bU,bV});}
  if(compact.length<minMatches)return null;
  const H=robustHomography(compact,a,b,{iterations:ransacIterations,thresholdPx:reprojectionPx});
  if(!H||H.inliers.length<minMatches)return null;
  const inliers=H.inliers.map(i=>compact[i]);
  const rot=estimateRayRotation(a,b,inliers,{thresholdRad:rotationInlierDeg*Math.PI/180});
  if(!rot||rot.inliers.length<Math.max(4,Math.min(minMatches,inliers.length)))return null;
  const kept=rot.inliers.map(i=>inliers[i]);
  const mean=kept.reduce((s,m)=>s+(m.probability||0),0)/Math.max(1,kept.length);
  const photo=kept.reduce((s,m)=>s+(m.photometricProbability??.5),0)/Math.max(1,kept.length);
  const uniq=kept.reduce((s,m)=>s+(m.uniquenessProbability??.5),0)/Math.max(1,kept.length);
  const support=clamp(kept.length/28,0,1),homographyRatio=H.inliers.length/compact.length,rotationRatio=kept.length/Math.max(1,H.inliers.length);
  const confidence=clamp(Math.sqrt(Math.max(0,mean*photo*uniq))*support*Math.sqrt(homographyRatio*rotationRatio)*Math.exp(-rot.medianResidualRad/Math.max(EPS,rotationInlierDeg*Math.PI/180)),.005,1);
  return {matches:kept,allPhotoMatches:compact.length,homography:H.H,homographyInliers:H.inliers.length,homographyMedianErrorPx:H.medianErrorPx,visualRotation:rot.q,visualInliers:kept.length,visualMedianResidualRad:rot.medianResidualRad,visualConfidence:confidence,meanProbability:mean,photometricProbability:photo,uniquenessProbability:uniq,weight:confidence};
}

/**
 * Solve absolute panorama orientations from pairwise visual rotations.
 * q_edge maps a ray in frame b into frame a coordinates. Absolute q values map
 * each camera ray into panorama/world directions. The first frame only fixes the
 * arbitrary coordinate system; every other connected orientation is photo-led.
 */
export function solvePhotoOrientations(frames,edges,{iterations=8,rootIndex=0}={}){
  const n=frames?.length||0,out=new Array(n).fill(null),confidence=new Float32Array(n),parent=new Int32Array(n);parent.fill(-1);if(!n)return {orientations:out,confidence,parent,rootIndex:-1};
  rootIndex=clamp(rootIndex|0,0,n-1);out[rootIndex]=qNormalize(frames[rootIndex]?.pose?.q||[0,0,0,1]);confidence[rootIndex]=1;
  const pending=new Set((edges||[]).filter(e=>e?.visualRotation&&e.a>=0&&e.b>=0&&e.a<n&&e.b<n));
  for(let pass=0;pass<n&&pending.size;pass++){
    let best=null,bestScore=-1;
    for(const e of pending){const aKnown=!!out[e.a],bKnown=!!out[e.b];if(aKnown===bKnown)continue;const s=Number(e.visualConfidence??e.weight??0);if(s>bestScore){best=e;bestScore=s;}}
    if(!best)break;pending.delete(best);
    if(out[best.a]&&!out[best.b]){out[best.b]=qNormalize(qMul(out[best.a],best.visualRotation));confidence[best.b]=Math.max(.01,confidence[best.a]*bestScore);parent[best.b]=best.a;}
    else if(out[best.b]&&!out[best.a]){out[best.a]=qNormalize(qMul(out[best.b],qConj(best.visualRotation)));confidence[best.a]=Math.max(.01,confidence[best.b]*bestScore);parent[best.a]=best.b;}
  }
  // Disconnected photos remain available diagnostically, but are explicitly
  // marked with zero visual confidence and use Alva only as a display fallback.
  for(let i=0;i<n;i++)if(!out[i])out[i]=qNormalize(frames[i]?.pose?.q||[0,0,0,1]);
  const adj=Array.from({length:n},()=>[]);for(const e of edges||[]){if(e?.visualRotation&&e.a>=0&&e.b>=0&&e.a<n&&e.b<n){adj[e.a].push(e);adj[e.b].push(e);}}
  for(let it=0;it<iterations;it++){
    const next=out.slice();
    for(let i=0;i<n;i++){
      if(i===rootIndex||confidence[i]<=0)continue;const preds=[];
      for(const e of adj[i]){
        const j=e.a===i?e.b:e.a;if(confidence[j]<=0)continue;
        const pred=e.a===i?qMul(out[j],qConj(e.visualRotation)):qMul(out[j],e.visualRotation);
        const residual=quatAngle(out[i],pred),base=Number(e.visualConfidence??e.weight??.05),robust=1/(1+(residual/(4*Math.PI/180))**2),w=base*robust*Math.max(.12,confidence[j]);preds.push({q:pred,w});
      }
      if(preds.length)next[i]=averageQuaternions(preds,out[i]);
    }
    for(let i=0;i<n;i++)out[i]=next[i];
  }
  return {orientations:out,confidence,parent,rootIndex};
}

export function visualAlvaDiagnostics(frames,edges,orientations){
  const ds=[];for(let i=0;i<(frames?.length||0);i++)if(orientations?.[i]&&frames[i]?.pose?.q)ds.push(quatAngle(orientations[i],frames[i].pose.q));
  const edgeDs=[];for(const e of edges||[]){const a=frames[e.a],b=frames[e.b];if(!a?.pose?.q||!b?.pose?.q||!e.visualRotation)continue;const alvaRel=qMul(qConj(a.pose.q),b.pose.q);edgeDs.push(quatAngle(alvaRel,e.visualRotation));}
  ds.sort((a,b)=>a-b);edgeDs.sort((a,b)=>a-b);return {meanOrientationDeltaRad:mean(ds),medianOrientationDeltaRad:median(ds),maxOrientationDeltaRad:ds.length?ds[ds.length-1]:0,meanEdgeDisagreementRad:mean(edgeDs),medianEdgeDisagreementRad:median(edgeDs)};
}

export function directionToAtlas(d,width,height){const n=Math.hypot(d[0],d[1],d[2])||1,yaw=Math.atan2(d[0],d[2]),pitch=Math.asin(clamp(d[1]/n,-1,1));return {x:wrap((yaw/(2*Math.PI)+.5)*width,width),y:clamp((pitch/Math.PI+.5)*height,0,height-1)};}


/**
 * Lightweight spatially-varying parallax correction for the diagnostic atlas.
 *
 * The global spherical orientation provides a stable, extrapolating base warp.
 * Verified RGB correspondences then measure the remaining 2-D disagreement in
 * atlas coordinates.  A tiny smooth displacement grid per frame absorbs that
 * local residual.  This follows the practical APAP/local-warp principle without
 * running a full moving-DLT solve at every output pixel on a phone.
 *
 * Crucially, the displacement field is built ONLY from photo correspondences.
 * Alva translation/orientation never enters the local warp.
 */
export function buildLocalPanoramaWarp(frames,edges,solution,{width=640,height=320,cols=9,rows=7,maxAnchorsPerFrame=120,maxOffsetFraction=.075}={}){
  const n=frames?.length||0,raw=Array.from({length:n},()=>[]),orientations=solution?.orientations||[],confidence=solution?.confidence||[],root=Number.isInteger(solution?.rootIndex)?solution.rootIndex:0;
  const residuals=[];
  for(const e of edges||[]){
    const a=frames[e?.a],b=frames[e?.b],qa=orientations[e?.a],qb=orientations[e?.b];if(!a||!b||!qa||!qb)continue;
    const edgeW=clamp(Number(e.visualConfidence??e.weight??.05),.005,1),ca=Math.max(.03,Number(confidence[e.a]||0)),cb=Math.max(.03,Number(confidence[e.b]||0)),sum=ca+cb;
    for(const m of e.matches||[]){
      if(![m?.aU,m?.aV,m?.bU,m?.bV].every(Number.isFinite))continue;
      const pa=directionToAtlas(qRotate(qa,pixelRay(a.K,m.aU,m.aV)),width,height),pb=directionToAtlas(qRotate(qb,pixelRay(b.K,m.bU,m.bV)),width,height),dx=wrappedDelta(pa.x-pb.x,width),dy=pa.y-pb.y,mag=Math.hypot(dx,dy);
      // Very large residuals usually mean a dynamic object or a wrong edge, not
      // useful parallax. Keep the local warp conservative and topology-safe.
      if(Math.abs(dx)>width*.16||Math.abs(dy)>height*.22)continue;residuals.push(mag);
      const w=edgeW*clamp(Number(m.probability??.2),.02,1)*clamp(Number(m.photometricProbability??.5),.08,1);
      const moveA=e.a===root?0:cb/sum,moveB=e.b===root?0:ca/sum;
      if(moveA>0)raw[e.a].push({u:m.aU/Math.max(1,a.width-1),v:m.aV/Math.max(1,a.height-1),dx:-dx*moveA,dy:-dy*moveA,w});
      if(moveB>0)raw[e.b].push({u:m.bU/Math.max(1,b.width-1),v:m.bV/Math.max(1,b.height-1),dx: dx*moveB,dy: dy*moveB,w});
    }
  }
  const maxDx=width*maxOffsetFraction,maxDy=height*Math.min(.12,maxOffsetFraction*1.5),fields=raw.map((anchors,fi)=>{
    anchors.sort((x,y)=>y.w-x.w);anchors=anchors.slice(0,maxAnchorsPerFrame);if(fi===root||!anchors.length)return {cols,rows,dx:new Float32Array(cols*rows),dy:new Float32Array(cols*rows),support:new Float32Array(cols*rows),anchors:anchors.length};
    const dx=new Float32Array(cols*rows),dy=new Float32Array(cols*rows),support=new Float32Array(cols*rows),sigma2=.16*.16;
    for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
      const u=gx/Math.max(1,cols-1),v=gy/Math.max(1,rows-1);let sw=0,sx=0,sy=0,nearest=Infinity;
      for(const a of anchors){const du=u-a.u,dv=v-a.v,d2=du*du+dv*dv;nearest=Math.min(nearest,d2);const ww=a.w*Math.exp(-d2/(2*sigma2));sw+=ww;sx+=a.dx*ww;sy+=a.dy*ww;}
      const k=gy*cols+gx,near=Math.exp(-nearest/(2*.23*.23)),authority=clamp(sw/(sw+.12),0,1)*near;support[k]=authority;if(sw>EPS){dx[k]=clamp(sx/sw,-maxDx,maxDx)*authority;dy[k]=clamp(sy/sw,-maxDy,maxDy)*authority;}
    }
    return {cols,rows,dx,dy,support,anchors:anchors.length};
  });
  residuals.sort((a,b)=>a-b);return {width,height,rootIndex:root,frames:fields,anchorCount:raw.reduce((s,a)=>s+a.length,0),medianBaseResidualPx:median(residuals),p90BaseResidualPx:residuals.length?residuals[Math.min(residuals.length-1,Math.floor(residuals.length*.9))]:0};
}

/** Project one source photo pixel into the photo-first atlas, including local parallax correction. */
export function photoPixelToAtlas(frame,orientation,u,v,width,height,localWarp=null,frameIndex=-1){
  const d=qRotate(orientation,pixelRay(frame.K,u,v)),a=directionToAtlas(d,width,height),field=localWarp?.frames?.[frameIndex];if(!field)return a;const o=sampleWarpField(field,u/Math.max(1,frame.width-1),v/Math.max(1,frame.height-1));return {x:wrap(a.x+o.dx,width),y:clamp(a.y+o.dy,0,height-1)};
}

export function sampleLocalPanoramaWarp(localWarp,frameIndex,uNorm,vNorm){const field=localWarp?.frames?.[frameIndex];return field?sampleWarpField(field,uNorm,vNorm):{dx:0,dy:0,support:0};}

function sampleWarpField(field,u,v){
  const cols=field.cols||1,rows=field.rows||1,x=clamp(u,0,1)*Math.max(0,cols-1),y=clamp(v,0,1)*Math.max(0,rows-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(cols-1,x0+1),y1=Math.min(rows-1,y0+1),tx=x-x0,ty=y-y0;
  const mix=(arr)=>{if(!arr?.length)return 0;const a=arr[y0*cols+x0],b=arr[y0*cols+x1],c=arr[y1*cols+x0],d=arr[y1*cols+x1];return a*(1-tx)*(1-ty)+b*tx*(1-ty)+c*(1-tx)*ty+d*tx*ty;};return {dx:mix(field.dx),dy:mix(field.dy),support:mix(field.support)};
}
function wrappedDelta(d,n){d%=n;if(d>n/2)d-=n;if(d<-n/2)d+=n;return d;}

function robustHomography(matches,a,b,{iterations=84,thresholdPx=4}={}){
  if(matches.length<4)return null;let seed=hashSeed(a?.frameId,b?.frameId,matches.length),best=null;
  for(let it=0;it<iterations;it++){
    const ids=[];let guard=0;while(ids.length<4&&guard++<30){seed=lcg(seed);const k=seed%matches.length;if(!ids.includes(k))ids.push(k);}if(ids.length<4)continue;
    const H=fitHomography(ids.map(i=>matches[i]),a,b);if(!H)continue;const inv=invert3(H);if(!inv)continue;const errors=matches.map(m=>symmetricHomographyError(H,inv,m,a,b)),inliers=[];for(let i=0;i<errors.length;i++)if(errors[i]<=thresholdPx)inliers.push(i);if(inliers.length<4)continue;const med=median(inliers.map(i=>errors[i]));const score=inliers.length-med*.08;if(!best||score>best.score)best={H,inliers,errors,medianErrorPx:med,score};
  }
  if(!best)return null;const refined=fitHomography(best.inliers.map(i=>matches[i]),a,b,true);if(refined){const inv=invert3(refined);if(inv){const errors=matches.map(m=>symmetricHomographyError(refined,inv,m,a,b)),inliers=[];for(let i=0;i<errors.length;i++)if(errors[i]<=thresholdPx)inliers.push(i);if(inliers.length>=best.inliers.length*.75)best={H:refined,inliers,errors,medianErrorPx:median(inliers.map(i=>errors[i])),score:inliers.length};}}
  return best;
}
function fitHomography(ms,a,b,leastSquares=false){
  if(ms.length<4)return null;const A=[],Y=[];for(const m of ms){const x=m.aU/Math.max(1,a.width),y=m.aV/Math.max(1,a.height),u=m.bU/Math.max(1,b.width),v=m.bV/Math.max(1,b.height),w=Math.sqrt(clamp(m.probability||.2,.02,1));A.push([x*w,y*w,w,0,0,0,-u*x*w,-u*y*w]);Y.push(u*w);A.push([0,0,0,x*w,y*w,w,-v*x*w,-v*y*w]);Y.push(v*w);}const h=solveLinear(A,Y,leastSquares||A.length!==8);if(!h)return null;return [h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
}
function solveLinear(A,b,leastSquares){
  let M,y;if(leastSquares){const n=8;M=Array.from({length:n},()=>new Array(n).fill(0));y=new Array(n).fill(0);for(let r=0;r<A.length;r++)for(let i=0;i<n;i++){y[i]+=A[r][i]*b[r];for(let j=0;j<n;j++)M[i][j]+=A[r][i]*A[r][j];}for(let i=0;i<n;i++)M[i][i]+=1e-8;}else{M=A.map(r=>r.slice());y=b.slice();}
  const n=M.length;if(n!==8)return null;for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-10)return null;[M[c],M[p]]=[M[p],M[c]];[y[c],y[p]]=[y[p],y[c]];const d=M[c][c];for(let j=c;j<n;j++)M[c][j]/=d;y[c]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];if(Math.abs(f)<1e-14)continue;for(let j=c;j<n;j++)M[r][j]-=f*M[c][j];y[r]-=f*y[c];}}return y;
}
function symmetricHomographyError(H,I,m,a,b){const pa=applyH(H,m.aU/Math.max(1,a.width),m.aV/Math.max(1,a.height)),pb=applyH(I,m.bU/Math.max(1,b.width),m.bV/Math.max(1,b.height));if(!pa||!pb)return Infinity;const e1=Math.hypot((pa[0]-m.bU/b.width)*b.width,(pa[1]-m.bV/b.height)*b.height),e2=Math.hypot((pb[0]-m.aU/a.width)*a.width,(pb[1]-m.aV/a.height)*a.height);return .5*(e1+e2);}
function applyH(H,x,y){const z=H[6]*x+H[7]*y+H[8];if(Math.abs(z)<EPS)return null;return [(H[0]*x+H[1]*y+H[2])/z,(H[3]*x+H[4]*y+H[5])/z];}
function invert3(m){const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d,det=a*A+b*D+c*G;if(Math.abs(det)<1e-11)return null;return [A/det,B/det,C/det,D/det,E/det,F/det,G/det,H/det,I/det];}

function estimateRayRotation(a,b,matches,{thresholdRad=.05}={}){
  if(matches.length<3)return null;let q=rotationFromPairs(a,b,matches);if(!q)return null;
  for(let it=0;it<5;it++){const weighted=[];for(const m of matches){const rb=pixelRay(b.K,m.bU,m.bV),ra=pixelRay(a.K,m.aU,m.aV),r=angle(qRotate(q,rb),ra),w=(m.probability||.2)/(1+(r/thresholdRad)**2);if(w>.003)weighted.push({...m,_w:w});}const nq=rotationFromPairs(a,b,weighted);if(!nq)break;q=nq;}
  const residuals=matches.map(m=>angle(qRotate(q,pixelRay(b.K,m.bU,m.bV)),pixelRay(a.K,m.aU,m.aV))),inliers=[];for(let i=0;i<residuals.length;i++)if(residuals[i]<=thresholdRad)inliers.push(i);return {q:qNormalize(q),inliers,medianResidualRad:median(inliers.map(i=>residuals[i]))};
}
function rotationFromPairs(a,b,ms){
  if(ms.length<2)return null;const S=[[0,0,0],[0,0,0],[0,0,0]];let sw=0;for(const m of ms){const dst=pixelRay(a.K,m.aU,m.aV),src=pixelRay(b.K,m.bU,m.bV),w=Number(m._w??m.probability??1);sw+=w;for(let r=0;r<3;r++)for(let c=0;c<3;c++)S[r][c]+=w*src[r]*dst[c];}if(sw<EPS)return null;
  const sigma=S[0][0]+S[1][1]+S[2][2],z=[S[1][2]-S[2][1],S[2][0]-S[0][2],S[0][1]-S[1][0]],K=[
    [S[0][0]+S[0][0]-sigma,S[0][1]+S[1][0],S[0][2]+S[2][0],z[0]],
    [S[1][0]+S[0][1],S[1][1]+S[1][1]-sigma,S[1][2]+S[2][1],z[1]],
    [S[2][0]+S[0][2],S[2][1]+S[1][2],S[2][2]+S[2][2]-sigma,z[2]],
    [z[0],z[1],z[2],sigma]
  ];const v=largestEigenvectorSym4(K);return v?qNormalize(v):null;
}
function largestEigenvectorSym4(M){const A=M.map(r=>r.slice()),V=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];for(let it=0;it<40;it++){let p=0,q=1,max=0;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)if(Math.abs(A[i][j])>max){max=Math.abs(A[i][j]);p=i;q=j;}if(max<1e-12)break;const phi=.5*Math.atan2(2*A[p][q],A[q][q]-A[p][p]),c=Math.cos(phi),s=Math.sin(phi);for(let k=0;k<4;k++){const apk=A[p][k],aqk=A[q][k];A[p][k]=c*apk-s*aqk;A[q][k]=s*apk+c*aqk;}for(let k=0;k<4;k++){const akp=A[k][p],akq=A[k][q];A[k][p]=c*akp-s*akq;A[k][q]=s*akp+c*akq;}for(let k=0;k<4;k++){const vkp=V[k][p],vkq=V[k][q];V[k][p]=c*vkp-s*vkq;V[k][q]=s*vkp+c*vkq;}}let idx=0;for(let i=1;i<4;i++)if(A[i][i]>A[idx][idx])idx=i;return [V[0][idx],V[1][idx],V[2][idx],V[3][idx]];}

function averageQuaternions(items,ref){const r=qNormalize(ref),sum=[0,0,0,0];for(const x of items){let q=qNormalize(x.q);const sign=dot4(q,r)<0?-1:1;for(let k=0;k<4;k++)sum[k]+=sign*q[k]*x.w;}return qNormalize(sum);}
function rankFeatures(fs,max){return (fs||[]).map((f,index)=>({...f,index})).filter(f=>Number.isFinite(f.x)&&Number.isFinite(f.y)).sort((a,b)=>(+b.score||0)-(+a.score||0)).slice(0,max);}
function featureQuality(f){const s=+f.score||0;return clamp(.62+.30*Math.tanh(s/20)+(f.source==='alva-track'?.08:0),.28,1);}
function angle(a,b){const na=Math.hypot(...a)||1,nb=Math.hypot(...b)||1;return Math.acos(clamp((a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(na*nb),-1,1));}
function quatAngle(a,b){a=qNormalize(a);b=qNormalize(b);return 2*Math.acos(clamp(Math.abs(dot4(a,b)),-1,1));}
function dot4(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];}
function sigmoid(x){return 1/(1+Math.exp(-x));}function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0;}function median(a){if(!a.length)return Infinity;const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length&1?b[m]:.5*(b[m-1]+b[m]);}
function hashSeed(a,b,n){let s=2166136261>>>0;for(const ch of `${a}|${b}|${n}`){s^=ch.charCodeAt(0);s=Math.imul(s,16777619)>>>0;}return s||1;}function lcg(s){return (Math.imul(s,1664525)+1013904223)>>>0;}function wrap(x,n){x%=n;return x<0?x+n:x;}
