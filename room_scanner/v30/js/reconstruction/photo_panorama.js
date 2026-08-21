
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-9;
const I3=()=>[1,0,0,0,1,0,0,0,1];
const PHOTO_PAIRS=makePhotoPairs(128,7);

/**
 * Detect FAST-like corners directly from the frozen survey photograph.
 *
 * This detector is intentionally independent from AlvaAR/SLAM.  The photo
 * mosaic must remain observable even when Alva is INIT/LOST or its pose is
 * wrong.  Spatial bucketing avoids concentrating all points on one textured
 * object and keeps the matcher cheap on a phone.
 */
export function detectPhotoFeatures(gray,width,height,{maxFeatures=420,threshold=14,cell=18,minScore=75}={}){
  if(!gray?.length||width<12||height<12)return [];
  const circle=[[0,-3],[1,-3],[2,-2],[3,-1],[3,0],[3,1],[2,2],[1,3],[0,3],[-1,3],[-2,2],[-3,1],[-3,0],[-3,-1],[-2,-2],[-1,-3]],candidates=[];
  const fastRun=(vals,sign)=>{let run=0,best=0;for(let k=0;k<vals.length+8;k++){const v=vals[k%vals.length]*sign;if(v>threshold){run++;best=Math.max(best,run);}else run=0;}return best>=9;};
  for(let y=4;y<height-4;y+=1)for(let x=4;x<width-4;x+=1){
    const c=gray[y*width+x],vals=new Int16Array(16);let abs=0;for(let k=0;k<16;k++){const [dx,dy]=circle[k],d=gray[(y+dy)*width+x+dx]-c;vals[k]=d;abs+=Math.abs(d);}if(abs<minScore)continue;
    const fast=fastRun(vals,1)||fastRun(vals,-1);
    // Harris-style local structure score also provides a fallback for junctions
    // (checkerboard/furniture corners) that are excellent stitching features but
    // do not satisfy the strict 9-pixel FAST arc. This still uses only the photo.
    let a=0,b=0,d=0;for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){const p=(y+yy)*width+x+xx,ix=gray[p+1]-gray[p-1],iy=gray[p+width]-gray[p-width];a+=ix*ix;b+=ix*iy;d+=iy*iy;}const tr=a+d,det=a*d-b*b,score=det-.045*tr*tr;if(score<=0)continue;if(!fast&&score<2.5e7)continue;candidates.push({x,y,score,source:'photo-fast'});
  }
  candidates.sort((a,b)=>b.score-a.score);const perCell=new Map(),out=[];for(const f of candidates){const key=`${Math.floor(f.x/cell)}:${Math.floor(f.y/cell)}`,n=perCell.get(key)||0;if(n>=4)continue;let close=false;for(let k=Math.max(0,out.length-80);k<out.length;k++){const q=out[k];if(Math.abs(q.x-f.x)<4&&Math.abs(q.y-f.y)<4){close=true;break;}}if(close)continue;perCell.set(key,n+1);out.push({...f,angle:cornerOrientation(gray,width,height,f.x,f.y),index:out.length});if(out.length>=maxFeatures)break;}return out;
}

/**
 * Pure photographic matching: BRIEF + local ZNCC + mutual uniqueness.
 * No pose, no epipolar gate, no Alva feature authority.
 */
export function matchPhotoFeatures(ref,src,{maxFeatures=360,maxMatches=190,maxHamming=72,minProbability=.03,patchRadius=2}={}){
  if(!ref?.gray?.length||!src?.gray?.length)return [];
  ensurePhotoFeatures(ref,maxFeatures*1.25);ensurePhotoFeatures(src,maxFeatures*1.25);
  if(!ref.features?.length||!src.features?.length)return [];
  const A=rankFeatures(ref.features,maxFeatures),B=rankFeatures(src.features,maxFeatures),ad=A.map(f=>photoBrief(ref.gray,ref.width,ref.height,f.x,f.y,f.angle)),bd=B.map(f=>photoBrief(src.gray,src.width,src.height,f.x,f.y,f.angle)),bestA=new Array(A.length),bestB=new Array(B.length);
  for(let i=0;i<A.length;i++){
    let best=null,second=null;if(!ad[i])continue;
    for(let j=0;j<B.length;j++){
      if(!bd[j])continue;const ham=hamming128(ad[i],bd[j]);if(ham>maxHamming)continue;const zn=orientedZncc(ref.gray,ref.width,ref.height,A[i],src.gray,src.width,src.height,B[j],patchRadius);if(zn<-.55)continue;const score=ham/128+.25*(1-zn)*.5,item={i,j,ham,zn,score};if(!best||score<best.score){second=best;best=item;}else if(!second||score<second.score)second=item;
    }
    if(best){best.ratio=second?best.score/Math.max(EPS,second.score):0;bestA[i]=best;}
  }
  for(let j=0;j<B.length;j++){let best=null;for(let i=0;i<A.length;i++){const x=bestA[i];if(!x||x.j!==j)continue;if(!best||x.score<best.score)best=x;}if(best)bestB[j]=best;}
  const out=[];for(let i=0;i<A.length;i++){const x=bestA[i];if(!x||bestB[x.j]!==x)continue;const descP=sigmoid((51-x.ham)/8),photoP=clamp((x.zn+.10)/1.10,0,1),uniqueP=clamp((.96-x.ratio)/.40,0,1),qA=featureQuality(A[i]),qB=featureQuality(B[x.j]),p=Math.pow(Math.max(1e-7,descP*photoP*uniqueP*qA*qB),1/5);if(p<minProbability)continue;out.push({i:A[i].index,j:B[x.j].index,probability:p,descriptorProbability:descP,photometricProbability:photoP,uniquenessProbability:uniqueP,hamming:x.ham,zncc:x.zn,ratio:x.ratio,photoOnly:true});}
  return out.sort((a,b)=>b.probability-a.probability).slice(0,maxMatches);
}

/**
 * Robust pairwise registration.  The homography is an initial local overlap
 * model, not a statement that the room is planar.  Parallax is handled by the
 * spatially varying photo warp after the global mosaic graph is solved.
 */
export function buildPhotoRegistrationEdge(a,b,matches,{minMatches=7,ransacIterations=160,reprojectionPx=4.5}={}){
  const compact=[];for(const m of matches||[]){const fa=a?.features?.[m.i],fb=b?.features?.[m.j];if(!fa||!fb)continue;const aU=Number(fa.originalU??fa.x),aV=Number(fa.originalV??fa.y),bU=Number(fb.originalU??fb.x),bV=Number(fb.originalV??fb.y);if([aU,aV,bU,bV].every(Number.isFinite))compact.push({...m,aU,aV,bU,bV});}if(compact.length<minMatches)return null;
  const H=robustHomography(compact,a,b,{iterations:ransacIterations,thresholdPx:reprojectionPx});if(!H||H.inliers.length<minMatches)return null;const kept=H.inliers.map(i=>compact[i]),mean=kept.reduce((s,m)=>s+(m.probability||0),0)/Math.max(1,kept.length),photo=kept.reduce((s,m)=>s+(m.photometricProbability??.5),0)/Math.max(1,kept.length),uniq=kept.reduce((s,m)=>s+(m.uniquenessProbability??.5),0)/Math.max(1,kept.length),support=clamp(kept.length/30,0,1),ratio=kept.length/compact.length,confidence=clamp(Math.sqrt(Math.max(0,mean*photo*uniq))*support*Math.sqrt(ratio)*Math.exp(-H.medianErrorPx/Math.max(1,reprojectionPx*1.3)),.004,1);
  return {matches:kept,allPhotoMatches:compact.length,homography:H.H,homographyInliers:kept.length,homographyMedianErrorPx:H.medianErrorPx,visualConfidence:confidence,meanProbability:mean,photometricProbability:photo,uniquenessProbability:uniq,weight:confidence,registration:'photo-homography-ransac'};
}

/**
 * Solve a global 2-D mosaic coordinate system from pairwise PHOTO homographies.
 * Root = identity.  No camera pose or intrinsics are consulted.  A coordinate-
 * descent bundle step then refits each frame homography from all incident photo
 * correspondences, so loop closures distribute drift rather than snapping to
 * any external tracker.
 */
export function solvePhotoMosaic(frames,edges,{iterations=7,rootIndex=null}={}){
  const n=frames?.length||0,transforms=new Array(n).fill(null),confidence=new Float32Array(n),parent=new Int32Array(n);parent.fill(-1);if(!n)return {transforms,confidence,parent,rootIndex:-1,bounds:null};
  const components=graphComponents(n,edges),largest=components[0]||[0];if(rootIndex==null||!largest.includes(rootIndex))rootIndex=largest[0];transforms[rootIndex]=I3();confidence[rootIndex]=1;
  const pending=new Set((edges||[]).filter(e=>validH(e?.homography)&&largest.includes(e.a)&&largest.includes(e.b)));for(let pass=0;pass<n&&pending.size;pass++){let best=null,bestScore=-1;for(const e of pending){const ak=!!transforms[e.a],bk=!!transforms[e.b];if(ak===bk)continue;const s=Number(e.visualConfidence??e.weight??0);if(s>bestScore){best=e;bestScore=s;}}if(!best)break;pending.delete(best);if(transforms[best.a]&&!transforms[best.b]){const inv=invert3(best.homography);if(inv){transforms[best.b]=normalizeH(mul3(transforms[best.a],inv));confidence[best.b]=Math.max(.01,confidence[best.a]*bestScore);parent[best.b]=best.a;}}else if(transforms[best.b]&&!transforms[best.a]){transforms[best.a]=normalizeH(mul3(transforms[best.b],best.homography));confidence[best.a]=Math.max(.01,confidence[best.b]*bestScore);parent[best.a]=best.b;}}
  const adj=Array.from({length:n},()=>[]);for(const e of edges||[])if(e?.matches?.length&&e.a>=0&&e.b>=0&&e.a<n&&e.b<n){adj[e.a].push(e);adj[e.b].push(e);}
  for(let it=0;it<iterations;it++)for(const i of largest){if(i===rootIndex||!transforms[i])continue;const constraints=[];for(const e of adj[i]){const j=e.a===i?e.b:e.a,Gj=transforms[j];if(!Gj)continue;for(const m of e.matches||[]){const own=e.a===i?[m.aU,m.aV]:[m.bU,m.bV],other=e.a===i?[m.bU,m.bV]:[m.aU,m.aV],f=frames[i],g=frames[j],target=applyH(Gj,other[0]/Math.max(1,g.width),other[1]/Math.max(1,g.height));if(!target)continue;const cur=applyH(transforms[i],own[0]/Math.max(1,f.width),own[1]/Math.max(1,f.height)),res=cur?Math.hypot(cur[0]-target[0],cur[1]-target[1]):1,w=(e.visualConfidence||.05)*(m.probability||.2)/(1+(res/.025)**2);if(w>.001)constraints.push({x:own[0]/Math.max(1,f.width),y:own[1]/Math.max(1,f.height),u:target[0],v:target[1],w});}}
    if(constraints.length>=8){const H=fitWeightedHomography(constraints);if(H&&isSaneGlobalH(H))transforms[i]=blendH(transforms[i],H,.58);}
  }
  const residuals=[];for(const e of edges||[]){const Ga=transforms[e.a],Gb=transforms[e.b];if(!Ga||!Gb)continue;for(const m of e.matches||[]){const a=frames[e.a],b=frames[e.b],pa=applyH(Ga,m.aU/Math.max(1,a.width),m.aV/Math.max(1,a.height)),pb=applyH(Gb,m.bU/Math.max(1,b.width),m.bV/Math.max(1,b.height));if(pa&&pb)residuals.push(Math.hypot(pa[0]-pb[0],pa[1]-pb[1]));}}
  const bounds=computeMosaicBounds(frames,transforms,{padding:.06});return {transforms,confidence,parent,rootIndex,component:largest,bounds,medianResidual:median(residuals),p90Residual:percentile(residuals,.9)};
}

/** Local photo-only mesh warp. Offsets are expressed in global mosaic units. */
export function buildLocalMosaicWarp(frames,edges,solution,{cols=9,rows=7,maxAnchorsPerFrame=140,maxOffset=.13}={}){
  const n=frames?.length||0,raw=Array.from({length:n},()=>[]),G=solution?.transforms||[],confidence=solution?.confidence||[],root=solution?.rootIndex??0,residuals=[];
  for(const e of edges||[]){const a=frames[e.a],b=frames[e.b],Ga=G[e.a],Gb=G[e.b];if(!a||!b||!Ga||!Gb)continue;const edgeW=clamp(Number(e.visualConfidence??e.weight??.05),.004,1),ca=Math.max(.03,Number(confidence[e.a]||0)),cb=Math.max(.03,Number(confidence[e.b]||0)),sum=ca+cb;for(const m of e.matches||[]){const pa=applyH(Ga,m.aU/Math.max(1,a.width),m.aV/Math.max(1,a.height)),pb=applyH(Gb,m.bU/Math.max(1,b.width),m.bV/Math.max(1,b.height));if(!pa||!pb)continue;const dx=pa[0]-pb[0],dy=pa[1]-pb[1],mag=Math.hypot(dx,dy);if(mag>.32)continue;residuals.push(mag);const w=edgeW*clamp(Number(m.probability??.2),.02,1)*clamp(Number(m.photometricProbability??.5),.08,1),moveA=e.a===root?0:cb/sum,moveB=e.b===root?0:ca/sum;if(moveA>0)raw[e.a].push({u:m.aU/Math.max(1,a.width-1),v:m.aV/Math.max(1,a.height-1),dx:-dx*moveA,dy:-dy*moveA,w});if(moveB>0)raw[e.b].push({u:m.bU/Math.max(1,b.width-1),v:m.bV/Math.max(1,b.height-1),dx:dx*moveB,dy:dy*moveB,w});}}
  const fields=raw.map((anchors,fi)=>{anchors.sort((x,y)=>y.w-x.w);anchors=anchors.slice(0,maxAnchorsPerFrame);const dx=new Float32Array(cols*rows),dy=new Float32Array(cols*rows),support=new Float32Array(cols*rows);if(fi===root||!anchors.length)return {cols,rows,dx,dy,support,anchors:anchors.length};const sigma2=.17*.17;for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){const u=gx/Math.max(1,cols-1),v=gy/Math.max(1,rows-1);let sw=0,sx=0,sy=0,nearest=Infinity;for(const a of anchors){const du=u-a.u,dv=v-a.v,d2=du*du+dv*dv;nearest=Math.min(nearest,d2);const ww=a.w*Math.exp(-d2/(2*sigma2));sw+=ww;sx+=a.dx*ww;sy+=a.dy*ww;}const k=gy*cols+gx,near=Math.exp(-nearest/(2*.25*.25)),authority=clamp(sw/(sw+.10),0,1)*near;support[k]=authority;if(sw>EPS){dx[k]=clamp(sx/sw,-maxOffset,maxOffset)*authority;dy[k]=clamp(sy/sw,-maxOffset,maxOffset)*authority;}}return {cols,rows,dx,dy,support,anchors:anchors.length};});
  return {rootIndex:root,frames:fields,anchorCount:raw.reduce((s,a)=>s+a.length,0),medianBaseResidual:median(residuals),p90BaseResidual:percentile(residuals,.9)};
}

export function photoPixelToMosaic(frame,transform,u,v,localWarp=null,frameIndex=-1){if(!transform)return null;const p=applyH(transform,u/Math.max(1,frame.width),v/Math.max(1,frame.height));if(!p)return null;const field=localWarp?.frames?.[frameIndex];if(!field)return {x:p[0],y:p[1]};const o=sampleWarpField(field,u/Math.max(1,frame.width-1),v/Math.max(1,frame.height-1));return {x:p[0]+o.dx,y:p[1]+o.dy};}
export function mosaicPointToCanvas(p,bounds,width,height){if(!p||!bounds)return null;const bw=Math.max(EPS,bounds.maxX-bounds.minX),bh=Math.max(EPS,bounds.maxY-bounds.minY),scale=Math.min(width/bw,height/bh),ox=(width-bw*scale)/2-bounds.minX*scale,oy=(height-bh*scale)/2-bounds.minY*scale;return {x:p.x*scale+ox,y:p.y*scale+oy,scale};}
export function photoPixelToCanvas(frame,transform,u,v,width,height,bounds,localWarp=null,frameIndex=-1){return mosaicPointToCanvas(photoPixelToMosaic(frame,transform,u,v,localWarp,frameIndex),bounds,width,height);}

export function computeMosaicBounds(frames,transforms,{padding=.05,localWarp=null}={}){const pts=[];for(let i=0;i<(frames?.length||0);i++){const f=frames[i],G=transforms?.[i];if(!f||!G)continue;for(const [u,v] of [[0,0],[f.width,0],[f.width,f.height],[0,f.height],[f.width*.5,0],[f.width*.5,f.height],[0,f.height*.5],[f.width,f.height*.5]]){const p=photoPixelToMosaic(f,G,u,v,localWarp,i);if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<50&&Math.abs(p.y)<50)pts.push(p);}}if(!pts.length)return {minX:0,maxX:1,minY:0,maxY:1};let minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x)),minY=Math.min(...pts.map(p=>p.y)),maxY=Math.max(...pts.map(p=>p.y)),span=Math.max(.25,maxX-minX,maxY-minY),pad=span*padding;return {minX:minX-pad,maxX:maxX+pad,minY:minY-pad,maxY:maxY+pad};}

/** Optional diagnostic only: compare photo solution with recorded Alva poses. */
export function visualAlvaDiagnostics(frames,edges,solution){let withPose=0;for(const f of frames||[])if(f?.pose?.q)withPose++;return {alvaPoseFrames:withPose,alvaPoseFraction:(frames?.length||0)?withPose/frames.length:0};}

function ensurePhotoFeatures(f,max=440){if(!f.features?.length||f.features.some(x=>x?.source!=='photo-fast'||!Number.isFinite(x?.angle)))f.features=detectPhotoFeatures(f.gray,f.width,f.height,{maxFeatures:Math.round(max)});}
function graphComponents(n,edges){const adj=Array.from({length:n},()=>[]);for(const e of edges||[]){if(e?.a>=0&&e?.b>=0&&e.a<n&&e.b<n){adj[e.a].push(e.b);adj[e.b].push(e.a);}}const seen=new Set(),out=[];for(let s=0;s<n;s++){if(seen.has(s))continue;const q=[s],c=[];seen.add(s);while(q.length){const i=q.pop();c.push(i);for(const j of adj[i])if(!seen.has(j)){seen.add(j);q.push(j);}}out.push(c);}return out.sort((a,b)=>b.length-a.length||a[0]-b[0]);}
function sampleWarpField(field,u,v){const cols=field.cols||1,rows=field.rows||1,x=clamp(u,0,1)*Math.max(0,cols-1),y=clamp(v,0,1)*Math.max(0,rows-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(cols-1,x0+1),y1=Math.min(rows-1,y0+1),tx=x-x0,ty=y-y0,mix=arr=>{if(!arr?.length)return 0;const a=arr[y0*cols+x0],b=arr[y0*cols+x1],c=arr[y1*cols+x0],d=arr[y1*cols+x1];return a*(1-tx)*(1-ty)+b*tx*(1-ty)+c*(1-tx)*ty+d*tx*ty;};return {dx:mix(field.dx),dy:mix(field.dy),support:mix(field.support)};}

function robustHomography(matches,a,b,{iterations=160,thresholdPx=4.5}={}){if(matches.length<4)return null;let seed=hashSeed(a?.frameId,b?.frameId,matches.length),best=null;for(let it=0;it<iterations;it++){const ids=[];let guard=0;while(ids.length<4&&guard++<30){seed=lcg(seed);const k=seed%matches.length;if(!ids.includes(k))ids.push(k);}if(ids.length<4)continue;const H=fitHomography(ids.map(i=>matches[i]),a,b);if(!H)continue;const inv=invert3(H);if(!inv)continue;const errors=matches.map(m=>symmetricHomographyError(H,inv,m,a,b)),inliers=[];for(let i=0;i<errors.length;i++)if(errors[i]<=thresholdPx)inliers.push(i);if(inliers.length<4)continue;const med=median(inliers.map(i=>errors[i])),score=inliers.length-med*.08;if(!best||score>best.score)best={H,inliers,errors,medianErrorPx:med,score};}if(!best)return null;const refined=fitHomography(best.inliers.map(i=>matches[i]),a,b,true);if(refined){const inv=invert3(refined);if(inv){const errors=matches.map(m=>symmetricHomographyError(refined,inv,m,a,b)),inliers=[];for(let i=0;i<errors.length;i++)if(errors[i]<=thresholdPx)inliers.push(i);if(inliers.length>=best.inliers.length*.72)best={H:normalizeH(refined),inliers,errors,medianErrorPx:median(inliers.map(i=>errors[i])),score:inliers.length};}}return best;}
function fitHomography(ms,a,b,leastSquares=false){if(ms.length<4)return null;const c=ms.map(m=>({x:m.aU/Math.max(1,a.width),y:m.aV/Math.max(1,a.height),u:m.bU/Math.max(1,b.width),v:m.bV/Math.max(1,b.height),w:clamp(m.probability||.2,.02,1)}));return fitWeightedHomography(c,leastSquares);}
function fitWeightedHomography(ms){if(ms.length<4)return null;const A=[],Y=[];for(const m of ms){const w=Math.sqrt(clamp(Number(m.w??1),.0001,100)),x=m.x,y=m.y,u=m.u,v=m.v;A.push([x*w,y*w,w,0,0,0,-u*x*w,-u*y*w]);Y.push(u*w);A.push([0,0,0,x*w,y*w,w,-v*x*w,-v*y*w]);Y.push(v*w);}const h=solveLinear(A,Y,true);return h?normalizeH([h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]):null;}
function solveLinear(A,b,leastSquares=true){let M,y;if(leastSquares){const n=8;M=Array.from({length:n},()=>new Array(n).fill(0));y=new Array(n).fill(0);for(let r=0;r<A.length;r++)for(let i=0;i<n;i++){y[i]+=A[r][i]*b[r];for(let j=0;j<n;j++)M[i][j]+=A[r][i]*A[r][j];}for(let i=0;i<n;i++)M[i][i]+=1e-8;}else{M=A.map(r=>r.slice());y=b.slice();}const n=M.length;if(n!==8)return null;for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-11)return null;[M[c],M[p]]=[M[p],M[c]];[y[c],y[p]]=[y[p],y[c]];const d=M[c][c];for(let j=c;j<n;j++)M[c][j]/=d;y[c]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];if(Math.abs(f)<1e-14)continue;for(let j=c;j<n;j++)M[r][j]-=f*M[c][j];y[r]-=f*y[c];}}return y;}
function symmetricHomographyError(H,I,m,a,b){const pa=applyH(H,m.aU/Math.max(1,a.width),m.aV/Math.max(1,a.height)),pb=applyH(I,m.bU/Math.max(1,b.width),m.bV/Math.max(1,b.height));if(!pa||!pb)return Infinity;const e1=Math.hypot((pa[0]-m.bU/b.width)*b.width,(pa[1]-m.bV/b.height)*b.height),e2=Math.hypot((pb[0]-m.aU/a.width)*a.width,(pb[1]-m.aV/a.height)*a.height);return .5*(e1+e2);}
function applyH(H,x,y){if(!validH(H))return null;const z=H[6]*x+H[7]*y+H[8];if(Math.abs(z)<EPS)return null;return [(H[0]*x+H[1]*y+H[2])/z,(H[3]*x+H[4]*y+H[5])/z];}
function invert3(m){if(!validH(m))return null;const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d,det=a*A+b*D+c*G;if(Math.abs(det)<1e-12)return null;return [A/det,B/det,C/det,D/det,E/det,F/det,G/det,H/det,I/det];}
function mul3(A,B){const C=new Array(9).fill(0);for(let r=0;r<3;r++)for(let c=0;c<3;c++)for(let k=0;k<3;k++)C[r*3+c]+=A[r*3+k]*B[k*3+c];return C;}
function normalizeH(H){const s=Math.abs(H[8])>EPS?H[8]:Math.hypot(H[0],H[1],H[3],H[4])||1;return H.map(x=>x/s);}
function blendH(A,B,t){const C=A.map((x,i)=>x*(1-t)+B[i]*t);return normalizeH(C);}
function validH(H){return Array.isArray(H)&&H.length===9&&H.every(Number.isFinite);}
function isSaneGlobalH(H){if(!validH(H)||Math.abs(H[8])<EPS)return false;for(const p of [[0,0],[1,0],[1,1],[0,1],[.5,.5]]){const q=applyH(H,p[0],p[1]);if(!q||Math.abs(q[0])>50||Math.abs(q[1])>50)return false;}return true;}
function cornerOrientation(gray,w,h,x,y){
  x=Math.round(x);y=Math.round(y);let mx=0,my=0,sw=0;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const xx=x+dx,yy=y+dy;if(xx<1||yy<1||xx>=w-1||yy>=h-1||dx*dx+dy*dy>27)continue;const v=gray[yy*w+xx],weight=1+.004*v;mx+=dx*v*weight;my+=dy*v*weight;sw+=v*weight;}if(Math.hypot(mx,my)<1e-6||sw<1)return 0;return Math.atan2(my,mx);
}
function photoBrief(gray,w,h,x,y,angle=0){
  x=Math.round(x);y=Math.round(y);if(x<10||y<10||x>=w-10||y>=h-10)return null;const ca=Math.cos(Number.isFinite(angle)?angle:0),sa=Math.sin(Number.isFinite(angle)?angle:0),out=new Uint32Array(4);for(let k=0;k<128;k++){const p=PHOTO_PAIRS[k],ax=Math.round(x+p[0]*ca-p[1]*sa),ay=Math.round(y+p[0]*sa+p[1]*ca),bx=Math.round(x+p[2]*ca-p[3]*sa),by=Math.round(y+p[2]*sa+p[3]*ca),a=gray[ay*w+ax],b=gray[by*w+bx];if(a<b)out[k>>>5]|=(1<<(k&31))>>>0;}return out;
}
function orientedZncc(A,aw,ah,fa,B,bw,bh,fb,r=2){
  const aa=Number.isFinite(fa?.angle)?fa.angle:0,ab=Number.isFinite(fb?.angle)?fb.angle:0,ca=Math.cos(aa),sa=Math.sin(aa),cb=Math.cos(ab),sb=Math.sin(ab),va=[],vb=[];for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const ax=fa.x+dx*ca-dy*sa,ay=fa.y+dx*sa+dy*ca,bx=fb.x+dx*cb-dy*sb,by=fb.y+dx*sb+dy*cb,a=bilinearGray(A,aw,ah,ax,ay),b=bilinearGray(B,bw,bh,bx,by);if(!Number.isFinite(a)||!Number.isFinite(b))return -1;va.push(a);vb.push(b);}let ma=0,mb=0;for(let i=0;i<va.length;i++){ma+=va[i];mb+=vb[i];}ma/=va.length;mb/=vb.length;let xa=0,xb=0,xx=0;for(let i=0;i<va.length;i++){const da=va[i]-ma,db=vb[i]-mb;xa+=da*da;xb+=db*db;xx+=da*db;}return xa>1&&xb>1?clamp(xx/Math.sqrt(xa*xb),-1,1):-1;
}
function bilinearGray(g,w,h,x,y){if(x<0||y<0||x>w-1||y>h-1)return NaN;const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0;return g[y0*w+x0]*(1-tx)*(1-ty)+g[y0*w+x1]*tx*(1-ty)+g[y1*w+x0]*(1-tx)*ty+g[y1*w+x1]*tx*ty;}
function hamming128(a,b){let n=0;for(let i=0;i<4;i++)n+=popcnt((a[i]^b[i])>>>0);return n;}function popcnt(x){x=x-((x>>>1)&0x55555555);x=(x&0x33333333)+((x>>>2)&0x33333333);return (((x+(x>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
function makePhotoPairs(n,r){let s=0x9e3779b9>>>0,out=[];const rnd=()=>{s=(Math.imul(s^s>>>15,1|s)+(s^Math.imul(s^s>>>7,61|s)))^s;s^=s>>>14;return (s>>>0)/4294967296;};for(let i=0;i<n;i++){let a,b,c,d;do{a=Math.round((rnd()*2-1)*r);b=Math.round((rnd()*2-1)*r);c=Math.round((rnd()*2-1)*r);d=Math.round((rnd()*2-1)*r);}while(a===c&&b===d);out.push([a,b,c,d]);}return out;}
function rankFeatures(fs,max){return (fs||[]).map((f,index)=>({...f,index})).filter(f=>Number.isFinite(f.x)&&Number.isFinite(f.y)).sort((a,b)=>(+b.score||0)-(+a.score||0)).slice(0,max);}
function featureQuality(f){const s=Math.max(0,+f.score||0);return clamp(.55+.35*Math.tanh(Math.log1p(s)/8),.32,1);}
function sigmoid(x){return 1/(1+Math.exp(-x));}function median(a){if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length&1?b[m]:.5*(b[m-1]+b[m]);}function percentile(a,p){if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.max(0,Math.floor((b.length-1)*p)))];}
function hashSeed(a,b,n){let s=2166136261>>>0;for(const ch of `${a}|${b}|${n}`){s^=ch.charCodeAt(0);s=Math.imul(s,16777619)>>>0;}return s||1;}function lcg(s){return (Math.imul(s,1664525)+1013904223)>>>0;}
