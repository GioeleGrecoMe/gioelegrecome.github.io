const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-9;
const TAU=Math.PI*2;
const DEG=Math.PI/180;
const I3=()=>[1,0,0,0,1,0,0,0,1];
const PHOTO_PAIRS=makePhotoPairs(128,7);

/**
 * Detect corners directly from the frozen survey photograph.
 * This detector is deliberately independent from AlvaAR/SLAM.
 */
export function detectPhotoFeatures(gray,width,height,{maxFeatures=420,threshold=14,cell=18,minScore=75,pyramid=true}={}){
  if(!gray?.length||width<12||height<12)return [];
  // Panorama-style scale pyramid.  We still return coordinates in the frozen
  // RGB frame, but each corner carries the patch scale at which it was found.
  // This makes BRIEF/ZNCC tolerant to modest approach/retreat without changing
  // the geometric model: accepted matches are still fit by a rigid sphere rotation.
  const levels=[1];
  if(pyramid&&Math.min(width,height)>=72)levels.push(1.42);
  if(pyramid&&Math.min(width,height)>=120)levels.push(2.02);
  const candidates=[];
  for(let li=0;li<levels.length;li++){
    const scale=levels[li],lw=Math.max(20,Math.round(width/scale)),lh=Math.max(20,Math.round(height/scale));
    const lg=scale===1?gray:resizeGrayArea(gray,width,height,lw,lh);
    const local=detectFeaturesSingleScale(lg,lw,lh,{threshold:Math.max(9,threshold-li*2),minScore:Math.max(42,minScore*(1-li*.16))});
    for(const f of local){
      const x=(f.x+.5)*width/lw-.5,y=(f.y+.5)*height/lh-.5;
      // Scores from coarser levels are normalised so they compete fairly with
      // fine-scale corners rather than dominating because of the resampling.
      candidates.push({x,y,score:f.score/Math.max(1,scale*scale),source:'photo-fast',angle:f.angle,scale:width/lw,level:li});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const perCell=new Map(),out=[];
  for(const f of candidates){
    if(f.x<10*f.scale||f.y<10*f.scale||f.x>=width-10*f.scale||f.y>=height-10*f.scale)continue;
    const key=`${Math.floor(f.x/cell)}:${Math.floor(f.y/cell)}`,n=perCell.get(key)||0;if(n>=5)continue;
    let close=false;for(let k=Math.max(0,out.length-110);k<out.length;k++){const q=out[k],r=3.2*Math.min(f.scale,q.scale||1);if(Math.abs(q.x-f.x)<r&&Math.abs(q.y-f.y)<r){close=true;break;}}if(close)continue;
    perCell.set(key,n+1);out.push({...f,index:out.length});if(out.length>=maxFeatures)break;
  }
  return out;
}

function detectFeaturesSingleScale(gray,width,height,{threshold=14,minScore=75}={}){
  const circle=[[0,-3],[1,-3],[2,-2],[3,-1],[3,0],[3,1],[2,2],[1,3],[0,3],[-1,3],[-2,2],[-3,1],[-3,0],[-3,-1],[-2,-2],[-1,-3]],candidates=[];
  const fastRun=(vals,sign)=>{let run=0,best=0;for(let k=0;k<vals.length+8;k++){const v=vals[k%vals.length]*sign;if(v>threshold){run++;best=Math.max(best,run);}else run=0;}return best>=9;};
  for(let y=4;y<height-4;y++)for(let x=4;x<width-4;x++){
    const c=gray[y*width+x],vals=new Int16Array(16);let abs=0;for(let k=0;k<16;k++){const [dx,dy]=circle[k],d=gray[(y+dy)*width+x+dx]-c;vals[k]=d;abs+=Math.abs(d);}if(abs<minScore)continue;
    const fast=fastRun(vals,1)||fastRun(vals,-1);let a=0,b=0,d=0;for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){const p=(y+yy)*width+x+xx,ix=gray[p+1]-gray[p-1],iy=gray[p+width]-gray[p-width];a+=ix*ix;b+=ix*iy;d+=iy*iy;}const tr=a+d,det=a*d-b*b,score=det-.045*tr*tr;if(score<=0)continue;if(!fast&&score<2.5e7)continue;candidates.push({x,y,score,angle:cornerOrientation(gray,width,height,x,y)});
  }
  return candidates;
}

function resizeGrayArea(src,sw,sh,dw,dh){
  const out=new Uint8Array(dw*dh),sx=sw/dw,sy=sh/dh;
  for(let y=0;y<dh;y++){const yy=clamp(Math.floor((y+.5)*sy),0,sh-1);for(let x=0;x<dw;x++){const xx=clamp(Math.floor((x+.5)*sx),0,sw-1);out[y*dw+x]=src[yy*sw+xx];}}
  return out;
}

/** Pure photographic matching. No pose, no epipolar gate, no Alva feature authority. */
export function matchPhotoFeatures(ref,src,{maxFeatures=360,maxMatches=190,maxHamming=72,minProbability=.03,patchRadius=2}={}){
  if(!ref?.gray?.length||!src?.gray?.length)return [];
  ensurePhotoFeatures(ref,maxFeatures*1.25);ensurePhotoFeatures(src,maxFeatures*1.25);if(!ref.features?.length||!src.features?.length)return [];
  const A=rankFeatures(ref.features,maxFeatures),B=rankFeatures(src.features,maxFeatures),ad=A.map(f=>photoBrief(ref.gray,ref.width,ref.height,f.x,f.y,f.angle)),bd=B.map(f=>photoBrief(src.gray,src.width,src.height,f.x,f.y,f.angle)),bestA=new Array(A.length),bestB=new Array(B.length);
  for(let i=0;i<A.length;i++){let best=null,second=null;if(!ad[i])continue;for(let j=0;j<B.length;j++){if(!bd[j])continue;const ham=hamming128(ad[i],bd[j]);if(ham>maxHamming)continue;const zn=orientedZncc(ref.gray,ref.width,ref.height,A[i],src.gray,src.width,src.height,B[j],patchRadius);if(zn<-.55)continue;const score=ham/128+.125*(1-zn),item={i,j,ham,zn,score};if(!best||score<best.score){second=best;best=item;}else if(!second||score<second.score)second=item;}if(best){best.ratio=second?best.score/Math.max(EPS,second.score):0;bestA[i]=best;}}
  for(let j=0;j<B.length;j++){let best=null;for(let i=0;i<A.length;i++){const x=bestA[i];if(!x||x.j!==j)continue;if(!best||x.score<best.score)best=x;}if(best)bestB[j]=best;}
  const out=[];for(let i=0;i<A.length;i++){const x=bestA[i];if(!x||bestB[x.j]!==x)continue;const descP=sigmoid((51-x.ham)/8),photoP=clamp((x.zn+.10)/1.10,0,1),uniqueP=clamp((.96-x.ratio)/.40,0,1),qA=featureQuality(A[i]),qB=featureQuality(B[x.j]),p=Math.pow(Math.max(1e-7,descP*photoP*uniqueP*qA*qB),1/5);if(p<minProbability)continue;out.push({i:A[i].index,j:B[x.j].index,probability:p,descriptorProbability:descP,photometricProbability:photoP,uniquenessProbability:uniqueP,hamming:x.ham,zncc:x.zn,ratio:x.ratio,photoOnly:true});}
  return out.sort((a,b)=>b.probability-a.probability).slice(0,maxMatches);
}

/** Cheap appearance score used to find non-temporal overlap candidates. */
export function photoAppearanceSimilarity(ref,src,{maxFeatures=96,maxHamming=62}={}){
  if(!ref?.gray?.length||!src?.gray?.length)return 0;ensurePhotoFeatures(ref,maxFeatures*2);ensurePhotoFeatures(src,maxFeatures*2);const A=rankFeatures(ref.features,maxFeatures),B=rankFeatures(src.features,maxFeatures);if(A.length<8||B.length<8)return 0;
  const ad=A.map(f=>photoBrief(ref.gray,ref.width,ref.height,f.x,f.y,f.angle,f.scale)),bd=B.map(f=>photoBrief(src.gray,src.width,src.height,f.x,f.y,f.angle,f.scale));let votes=0,sum=0;for(let i=0;i<ad.length;i++){if(!ad[i])continue;let best=129,second=129;for(let j=0;j<bd.length;j++){if(!bd[j])continue;const h=hamming128(ad[i],bd[j]);if(h<best){second=best;best=h;}else if(h<second)second=h;}if(best>maxHamming)continue;const ratio=best/Math.max(1,second);if(ratio>.94)continue;votes++;sum+=clamp(1-best/Math.max(1,maxHamming),0,1)*clamp((.96-ratio)/.34,0,1);}const support=votes/Math.max(10,Math.min(A.length,B.length));return clamp(.62*support+.38*(sum/Math.max(1,votes))*Math.min(1,votes/14),0,1);
}

/**
 * Pairwise panorama registration on calibrated rays.
 *
 * Feature matching only proposes correspondences. Geometry is a rigid rotation
 * on the viewing sphere: the solver is not allowed to stretch/shear/projectively
 * distort either photograph. A deterministic hypothesis stage handles gross
 * outliers, then IRLS/Wahba refines all surviving ray correspondences.
 * rotationBToA maps a camera-B ray into camera-A coordinates.
 */
export function buildPhotoRegistrationEdge(a,b,matches,{minMatches=7,angularThresholdDeg=3.2,recovery=false}={}){
  if(!validK(a?.K)||!validK(b?.K))return null;const compact=[];
  for(const m of matches||[]){const fa=a?.features?.[m.i],fb=b?.features?.[m.j];if(!fa||!fb)continue;const aU=Number(fa.originalU??fa.x),aV=Number(fa.originalV??fa.y),bU=Number(fb.originalU??fb.x),bV=Number(fb.originalV??fb.y);if(![aU,aV,bU,bV].every(Number.isFinite))continue;compact.push({...m,aU,aV,bU,bV,aRay:pixelRay(a.K,aU,aV),bRay:pixelRay(b.K,bU,bV)});}
  if(compact.length<minMatches)return null;const threshold=clamp(Number(angularThresholdDeg)||3.2,recovery?2.2:1.1,recovery?7.5:5.0)*DEG,fit=robustSphericalRotation(compact,{threshold,minMatches});if(!fit||fit.inliers.length<minMatches)return null;
  const kept=fit.inliers.map(i=>compact[i]),mean=meanOf(kept,m=>m.probability||0),photo=meanOf(kept,m=>m.photometricProbability??.5),uniq=meanOf(kept,m=>m.uniquenessProbability??.5),support=clamp(kept.length/30,0,1),ratio=kept.length/compact.length,medianDeg=fit.medianError/DEG,p90Deg=fit.p90Error/DEG,confidence=clamp(Math.sqrt(Math.max(0,mean*photo*uniq))*support*Math.sqrt(ratio)*Math.exp(-medianDeg/(recovery?3.8:2.6)),.003,1);
  return {matches:kept,allPhotoMatches:compact.length,rotationBToA:fit.R,rotationInliers:kept.length,rotationMedianErrorDeg:medianDeg,rotationP90ErrorDeg:p90Deg,rotationAngleDeg:rotationAngle(fit.R)/DEG,visualConfidence:confidence,meanProbability:mean,photometricProbability:photo,uniquenessProbability:uniq,weight:confidence,modelType:'spherical-rotation',registration:'photo-spherical-rotation-irls'};
}

/**
 * Global rotation averaging. Root camera = identity.  All transforms are 3x3
 * rotations mapping each camera ray into the common panorama sphere.
 */
export function solvePhotoMosaic(frames,edges,{iterations=10,rootIndex=null}={}){
  const n=frames?.length||0,transforms=new Array(n).fill(null),confidence=new Float32Array(n),parent=new Int32Array(n);parent.fill(-1);if(!n)return {transforms,confidence,parent,rootIndex:-1,bounds:null,projection:'spherical'};
  const components=graphComponents(n,edges);let component;if(Number.isInteger(rootIndex)&&rootIndex>=0&&rootIndex<n){component=components.find(c=>c.includes(rootIndex))||[rootIndex];}else{component=components[0]||[0];rootIndex=component[0];}
  transforms[rootIndex]=I3();confidence[rootIndex]=1;const pending=new Set((edges||[]).filter(e=>validRotation(e?.rotationBToA)&&component.includes(e.a)&&component.includes(e.b)));
  for(let pass=0;pass<n&&pending.size;pass++){let best=null,bestScore=-1;for(const e of pending){const ak=!!transforms[e.a],bk=!!transforms[e.b];if(ak===bk)continue;const s=Number(e.visualConfidence??e.weight??0);if(s>bestScore){best=e;bestScore=s;}}if(!best)break;pending.delete(best);if(transforms[best.a]&&!transforms[best.b]){transforms[best.b]=orthonormalize(mul3(transforms[best.a],best.rotationBToA));confidence[best.b]=Math.max(.01,confidence[best.a]*bestScore);parent[best.b]=best.a;}else if(transforms[best.b]&&!transforms[best.a]){transforms[best.a]=orthonormalize(mul3(transforms[best.b],transpose3(best.rotationBToA)));confidence[best.a]=Math.max(.01,confidence[best.b]*bestScore);parent[best.a]=best.b;}}
  const adj=Array.from({length:n},()=>[]);for(const e of edges||[])if(validRotation(e?.rotationBToA)){adj[e.a]?.push(e);adj[e.b]?.push(e);}
  for(let it=0;it<iterations;it++){
    const next=transforms.slice();for(const i of component){if(i===rootIndex||!transforms[i])continue;const proposals=[];for(const e of adj[i]){const j=e.a===i?e.b:e.a,Rj=transforms[j];if(!Rj)continue;const pred=e.a===i?mul3(Rj,transpose3(e.rotationBToA)):mul3(Rj,e.rotationBToA),w=Math.max(.003,Number(e.visualConfidence??e.weight??.03));proposals.push({R:pred,w});}if(!proposals.length)continue;proposals.push({R:transforms[i],w:.08});const avg=averageRotations(proposals);if(avg)next[i]=slerpRotation(transforms[i],avg,.62);}
    for(let i=0;i<n;i++)if(next[i])transforms[i]=orthonormalize(next[i]);transforms[rootIndex]=I3();
  }
  const residuals=[];for(const e of edges||[]){const Ga=transforms[e.a],Gb=transforms[e.b];if(!Ga||!Gb)continue;for(const m of e.matches||[]){const a=frames[e.a],b=frames[e.b],ra=mulVec(Ga,pixelRay(a.K,m.aU,m.aV)),rb=mulVec(Gb,pixelRay(b.K,m.bU,m.bV));residuals.push(angleBetween(ra,rb));}}
  const bounds=computeMosaicBounds(frames,transforms,{padding:.055});return {transforms,confidence,parent,rootIndex,component,bounds,projection:'spherical',medianResidual:median(residuals),p90Residual:percentile(residuals,.9),medianResidualDeg:median(residuals)/DEG,p90ResidualDeg:percentile(residuals,.9)/DEG};
}

/** Local geometric warping is intentionally disabled in spherical mode. */
export function buildLocalMosaicWarp(){return {disabled:true,reason:'spherical-projection-keeps-rigid-rays',frames:[],anchorCount:0,medianBaseResidual:0,p90BaseResidual:0};}

/** Project one source pixel to the common spherical panorama coordinates (yaw,pitch). */
export function photoPixelToMosaic(frame,rotation,u,v){if(!validRotation(rotation)||!validK(frame?.K))return null;const r=mulVec(rotation,pixelRay(frame.K,u,v)),n=Math.hypot(...r)||1,yaw=Math.atan2(r[0],r[2]),pitch=Math.asin(clamp(r[1]/n,-1,1));return {x:yaw,y:pitch};}

export function mosaicPointToCanvas(p,bounds,width,height){if(!p||!bounds)return null;const x=bounds.wrapX?unwrapYaw(p.x,bounds.yawStart):p.x,bw=Math.max(EPS,bounds.maxX-bounds.minX),bh=Math.max(EPS,bounds.maxY-bounds.minY),scale=Math.min(width/bw,height/bh),ox=(width-bw*scale)/2-bounds.minX*scale,oy=(height-bh*scale)/2-bounds.minY*scale;return {x:x*scale+ox,y:p.y*scale+oy,scale};}
export function photoPixelToCanvas(frame,rotation,u,v,width,height,bounds){return mosaicPointToCanvas(photoPixelToMosaic(frame,rotation,u,v),bounds,width,height);}

/** Inverse spherical warp: destination panorama pixel -> source photo pixel. */
export function canvasPointToPhotoPixel(frame,rotation,x,y,width,height,bounds){if(!validRotation(rotation)||!bounds||!validK(frame?.K))return null;const bw=Math.max(EPS,bounds.maxX-bounds.minX),bh=Math.max(EPS,bounds.maxY-bounds.minY),scale=Math.min(width/bw,height/bh),ox=(width-bw*scale)/2-bounds.minX*scale,oy=(height-bh*scale)/2-bounds.minY*scale,ux=(x-ox)/scale,pitch=(y-oy)/scale;if(pitch<-.5*Math.PI-.02||pitch>.5*Math.PI+.02)return null;const yaw=wrapPi(ux),cp=Math.cos(pitch),global=[Math.sin(yaw)*cp,Math.sin(pitch),Math.cos(yaw)*cp],local=mulVec(transpose3(rotation),global);if(!(local[2]>.02))return null;const u=frame.K.fx*local[0]/local[2]+frame.K.cx,v=frame.K.fy*local[1]/local[2]+frame.K.cy;if(u<-.5||v<-.5||u>frame.width-.5||v>frame.height-.5)return null;return {u,v};}

/** Conservative canvas bbox of a spherical-warped photograph. */
export function frameCanvasBounds(frame,rotation,width,height,bounds,{edgeSamples=10}={}){const pts=[];for(let k=0;k<=edgeSamples;k++){const t=k/edgeSamples;for(const [u,v] of [[t*frame.width,0],[t*frame.width,frame.height],[0,t*frame.height],[frame.width,t*frame.height]]){const p=photoPixelToCanvas(frame,rotation,u,v,width,height,bounds);if(p&&Number.isFinite(p.x+p.y))pts.push(p);}}if(!pts.length)return null;return {minX:clamp(Math.floor(Math.min(...pts.map(p=>p.x)))-2,0,width-1),maxX:clamp(Math.ceil(Math.max(...pts.map(p=>p.x)))+2,0,width-1),minY:clamp(Math.floor(Math.min(...pts.map(p=>p.y)))-2,0,height-1),maxY:clamp(Math.ceil(Math.max(...pts.map(p=>p.y)))+2,0,height-1)};}

export function computeMosaicBounds(frames,transforms,{padding=.05}={}){
  const pts=[];for(let i=0;i<(frames?.length||0);i++){const f=frames[i],R=transforms?.[i];if(!f||!R)continue;for(let gy=0;gy<=4;gy++)for(let gx=0;gx<=5;gx++){if(gx>0&&gx<5&&gy>0&&gy<4)continue;const p=photoPixelToMosaic(f,R,gx/5*f.width,gy/4*f.height);if(p)pts.push(p);}}
  if(!pts.length)return {minX:-.5,maxX:.5,minY:-.35,maxY:.35,yawStart:0,wrapX:true};const yaws=pts.map(p=>wrapTau(p.x)).sort((a,b)=>a-b);let gap=-1,gapIdx=0;for(let i=0;i<yaws.length;i++){const a=yaws[i],b=i===yaws.length-1?yaws[0]+TAU:yaws[i+1],g=b-a;if(g>gap){gap=g;gapIdx=i;}}const yawStart=wrapTau(yaws[(gapIdx+1)%yaws.length]),xs=pts.map(p=>unwrapYaw(p.x,yawStart)),ys=pts.map(p=>p.y);let minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const sx=Math.max(.12,maxX-minX),sy=Math.max(.10,maxY-minY),padX=sx*padding,padY=Math.max(sy*padding,.012);minX-=padX;maxX+=padX;minY=clamp(minY-padY,-Math.PI/2,Math.PI/2);maxY=clamp(maxY+padY,-Math.PI/2,Math.PI/2);return {minX,maxX,minY,maxY,yawStart,wrapX:true,projection:'equirectangular-sphere'};
}

/** Project an A pixel into B using only an edge's rigid spherical rotation. */
export function projectPixelAcrossEdge(a,b,edge,fromSide,u,v){if(!validRotation(edge?.rotationBToA))return null;if(fromSide==='a'){const rb=mulVec(transpose3(edge.rotationBToA),pixelRay(a.K,u,v));return rayToPixel(b.K,rb,b.width,b.height);}const ra=mulVec(edge.rotationBToA,pixelRay(b.K,u,v));return rayToPixel(a.K,ra,a.width,a.height);}

/** Optional diagnostic only: compare existence of recorded Alva poses. */
export function visualAlvaDiagnostics(frames){let withPose=0;for(const f of frames||[])if(f?.pose?.q)withPose++;return {alvaPoseFrames:withPose,alvaPoseFraction:(frames?.length||0)?withPose/frames.length:0};}

function robustSphericalRotation(pairs,{threshold=3.2*DEG,minMatches=7}={}){
  const sorted=pairs.map((p,i)=>({p,i,q:(p.probability||.1)*(p.photometricProbability??.5)*(p.uniquenessProbability??.5)})).sort((a,b)=>b.q-a.q),candidates=[];const all=fitRotationWahba(pairs,pairs.map(p=>Math.max(.01,p.probability||.1)));if(all)candidates.push(all);
  const top=Math.min(sorted.length,30);for(let s=0;s<Math.min(20,Math.max(0,top-2));s++){const ids=[s%top,(s*5+3)%top,(s*11+7)%top];if(new Set(ids).size<3)continue;const ps=ids.map(k=>sorted[k].p),R=fitRotationWahba(ps,ps.map(p=>Math.max(.05,p.probability||.1)));if(R)candidates.push(R);}
  let best=null;for(const R of candidates){const errors=pairs.map(p=>angleBetween(p.aRay,mulVec(R,p.bRay))),inliers=[];for(let i=0;i<errors.length;i++)if(errors[i]<=threshold*1.5)inliers.push(i);if(inliers.length<minMatches)continue;const med=median(inliers.map(i=>errors[i])),score=inliers.length-4.0*med/Math.max(threshold,EPS);if(!best||score>best.score)best={R,inliers,errors,score};}if(!best)return null;
  let R=best.R,weights=pairs.map((p,i)=>best.inliers.includes(i)?Math.max(.01,p.probability||.1):.001);for(let it=0;it<7;it++){const errors=pairs.map(p=>angleBetween(p.aRay,mulVec(R,p.bRay))),finite=errors.filter(Number.isFinite),med=median(finite),mad=median(finite.map(x=>Math.abs(x-med))),scale=Math.max(threshold*.42,med+2.8*Math.max(mad,threshold*.08));weights=errors.map((e,i)=>{const base=Math.max(.004,(pairs[i].probability||.1)*(pairs[i].photometricProbability??.7)*(pairs[i].uniquenessProbability??.7));if(e>threshold*2.1)return .00001;const x=e/Math.max(scale,EPS),rob=x<1?Math.pow(1-x*x,2):.015;return base*rob;});const next=fitRotationWahba(pairs,weights);if(!next)break;R=next;}
  const errors=pairs.map(p=>angleBetween(p.aRay,mulVec(R,p.bRay))),inliers=[];for(let i=0;i<errors.length;i++)if(errors[i]<=threshold)inliers.push(i);if(inliers.length<minMatches)return null;const refit=fitRotationWahba(inliers.map(i=>pairs[i]),inliers.map(i=>Math.max(.01,pairs[i].probability||.1)));if(refit)R=refit;const finalErrors=pairs.map(p=>angleBetween(p.aRay,mulVec(R,p.bRay))),finalInliers=[];for(let i=0;i<finalErrors.length;i++)if(finalErrors[i]<=threshold)finalInliers.push(i);if(finalInliers.length<minMatches)return null;const es=finalInliers.map(i=>finalErrors[i]);return {R:orthonormalize(R),inliers:finalInliers,medianError:median(es),p90Error:percentile(es,.9)};
}

function fitRotationWahba(pairs,weights){if(!pairs?.length)return null;const B=new Float64Array(9);let sw=0;for(let i=0;i<pairs.length;i++){const p=pairs[i],w=Math.max(0,Number(weights?.[i]??1));if(!(w>0)||!p?.aRay||!p?.bRay)continue;sw+=w;for(let r=0;r<3;r++)for(let c=0;c<3;c++)B[r*3+c]+=w*p.bRay[r]*p.aRay[c];}if(sw<EPS)return null;const [b00,b01,b02,b10,b11,b12,b20,b21,b22]=B,sigma=b00+b11+b22,z0=b12-b21,z1=b20-b02,z2=b01-b10,S00=2*b00,S01=b01+b10,S02=b02+b20,S11=2*b11,S12=b12+b21,S22=2*b22,K=[[sigma,z0,z1,z2],[z0,S00-sigma,S01,S02],[z1,S01,S11-sigma,S12],[z2,S02,S12,S22-sigma]];const shift=4*sw;let q=[1,0,0,0];for(let it=0;it<45;it++){const n=[0,0,0,0];for(let r=0;r<4;r++){for(let c=0;c<4;c++)n[r]+=K[r][c]*q[c];n[r]+=shift*q[r];}const l=Math.hypot(...n);if(l<EPS)return null;q=n.map(x=>x/l);}return quatToMat(q);
}
function averageRotations(items){if(!items?.length)return null;let ref=null,sum=[0,0,0,0],sw=0;for(const x of items){if(!validRotation(x.R)||!(x.w>0))continue;let q=matToQuat(x.R);if(!ref)ref=q;if(dot4(q,ref)<0)q=q.map(v=>-v);for(let k=0;k<4;k++)sum[k]+=x.w*q[k];sw+=x.w;}if(sw<EPS)return null;const n=Math.hypot(...sum);return n>EPS?quatToMat(sum.map(v=>v/n)):null;}
function slerpRotation(A,B,t){let qa=matToQuat(A),qb=matToQuat(B),d=dot4(qa,qb);if(d<0){qb=qb.map(v=>-v);d=-d;}d=clamp(d,-1,1);if(d>.9995){const q=qa.map((v,i)=>v*(1-t)+qb[i]*t),n=Math.hypot(...q);return quatToMat(q.map(v=>v/n));}const th=Math.acos(d),s=Math.sin(th),a=Math.sin((1-t)*th)/s,b=Math.sin(t*th)/s;return quatToMat(qa.map((v,i)=>v*a+qb[i]*b));}
function quatToMat(q){let [w,x,y,z]=q,n=Math.hypot(w,x,y,z)||1;w/=n;x/=n;y/=n;z/=n;return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];}
function matToQuat(m){const t=m[0]+m[4]+m[8];let w,x,y,z;if(t>0){const s=Math.sqrt(t+1)*2;w=.25*s;x=(m[7]-m[5])/s;y=(m[2]-m[6])/s;z=(m[3]-m[1])/s;}else if(m[0]>m[4]&&m[0]>m[8]){const s=Math.sqrt(1+m[0]-m[4]-m[8])*2;w=(m[7]-m[5])/s;x=.25*s;y=(m[1]+m[3])/s;z=(m[2]+m[6])/s;}else if(m[4]>m[8]){const s=Math.sqrt(1+m[4]-m[0]-m[8])*2;w=(m[2]-m[6])/s;x=(m[1]+m[3])/s;y=.25*s;z=(m[5]+m[7])/s;}else{const s=Math.sqrt(1+m[8]-m[0]-m[4])*2;w=(m[3]-m[1])/s;x=(m[2]+m[6])/s;y=(m[5]+m[7])/s;z=.25*s;}const n=Math.hypot(w,x,y,z)||1;return [w/n,x/n,y/n,z/n];}
function orthonormalize(m){const x=normalize3([m[0],m[3],m[6]]),y0=[m[1],m[4],m[7]],y=normalize3(sub3(y0,scale3(x,dot3(x,y0)))),z=normalize3(cross3(x,y));return [x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]];}
function rotationAngle(R){return Math.acos(clamp((R[0]+R[4]+R[8]-1)/2,-1,1));}
function pixelRay(K,u,v){return normalize3([(u-K.cx)/Math.max(EPS,K.fx),(v-K.cy)/Math.max(EPS,K.fy),1]);}
function rayToPixel(K,r,w,h){if(!(r?.[2]>.02))return null;const u=K.fx*r[0]/r[2]+K.cx,v=K.fy*r[1]/r[2]+K.cy;return u>=0&&v>=0&&u<w&&v<h?{u,v}:null;}
function graphComponents(n,edges){const adj=Array.from({length:n},()=>[]);for(const e of edges||[]){if(e?.a>=0&&e?.b>=0&&e.a<n&&e.b<n&&validRotation(e.rotationBToA)){adj[e.a].push(e.b);adj[e.b].push(e.a);}}const seen=new Set(),out=[];for(let s=0;s<n;s++){if(seen.has(s))continue;const q=[s],c=[];seen.add(s);while(q.length){const i=q.pop();c.push(i);for(const j of adj[i])if(!seen.has(j)){seen.add(j);q.push(j);}}out.push(c);}return out.sort((a,b)=>b.length-a.length||a[0]-b[0]);}
function validK(K){return !!K&&Number.isFinite(+K.fx)&&Number.isFinite(+K.fy)&&Number.isFinite(+K.cx)&&Number.isFinite(+K.cy)&&K.fx>1&&K.fy>1;}
function validRotation(R){return Array.isArray(R)&&R.length===9&&R.every(Number.isFinite);}
function mul3(A,B){const C=new Array(9).fill(0);for(let r=0;r<3;r++)for(let c=0;c<3;c++)for(let k=0;k<3;k++)C[r*3+c]+=A[r*3+k]*B[k*3+c];return C;}
function transpose3(A){return [A[0],A[3],A[6],A[1],A[4],A[7],A[2],A[5],A[8]];}
function mulVec(A,v){return [A[0]*v[0]+A[1]*v[1]+A[2]*v[2],A[3]*v[0]+A[4]*v[1]+A[5]*v[2],A[6]*v[0]+A[7]*v[1]+A[8]*v[2]];}
function normalize3(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function dot4(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];}function cross3(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}function sub3(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function scale3(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
function angleBetween(a,b){return Math.acos(clamp(dot3(normalize3(a),normalize3(b)),-1,1));}
function wrapTau(x){x%=TAU;return x<0?x+TAU:x;}function wrapPi(x){x=(x+Math.PI)%TAU;if(x<0)x+=TAU;return x-Math.PI;}function unwrapYaw(yaw,start){let x=wrapTau(yaw),s=wrapTau(start);if(x<s)x+=TAU;return x;}
function ensurePhotoFeatures(f,max=440){if(!f.features?.length||f.features.some(x=>x?.source!=='photo-fast'||!Number.isFinite(x?.angle)||!Number.isFinite(x?.scale)))f.features=detectPhotoFeatures(f.gray,f.width,f.height,{maxFeatures:Math.round(max)});}
function cornerOrientation(gray,w,h,x,y){x=Math.round(x);y=Math.round(y);let mx=0,my=0,sw=0;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const xx=x+dx,yy=y+dy;if(xx<1||yy<1||xx>=w-1||yy>=h-1||dx*dx+dy*dy>27)continue;const v=gray[yy*w+xx],weight=1+.004*v;mx+=dx*v*weight;my+=dy*v*weight;sw+=v*weight;}if(Math.hypot(mx,my)<1e-6||sw<1)return 0;return Math.atan2(my,mx);}
function photoBrief(gray,w,h,x,y,angle=0,scale=1){x=Number(x);y=Number(y);scale=clamp(Number(scale)||1,.72,2.5);const margin=10*scale;if(x<margin||y<margin||x>=w-margin||y>=h-margin)return null;const ca=Math.cos(Number.isFinite(angle)?angle:0),sa=Math.sin(Number.isFinite(angle)?angle:0),out=new Uint32Array(4);for(let k=0;k<128;k++){const p=PHOTO_PAIRS[k],px=p[0]*scale,py=p[1]*scale,qx=p[2]*scale,qy=p[3]*scale,ax=Math.round(x+px*ca-py*sa),ay=Math.round(y+px*sa+py*ca),bx=Math.round(x+qx*ca-qy*sa),by=Math.round(y+qx*sa+qy*ca),a=gray[ay*w+ax],b=gray[by*w+bx];if(a<b)out[k>>>5]|=(1<<(k&31))>>>0;}return out;}
function orientedZncc(A,aw,ah,fa,B,bw,bh,fb,r=2){const aa=Number.isFinite(fa?.angle)?fa.angle:0,ab=Number.isFinite(fb?.angle)?fb.angle:0,sa0=clamp(Number(fa?.scale)||1,.72,2.5),sb0=clamp(Number(fb?.scale)||1,.72,2.5),ca=Math.cos(aa),sa=Math.sin(aa),cb=Math.cos(ab),sb=Math.sin(ab),va=[],vb=[];for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const dax=dx*sa0,day=dy*sa0,dbx=dx*sb0,dby=dy*sb0,ax=fa.x+dax*ca-day*sa,ay=fa.y+dax*sa+day*ca,bx=fb.x+dbx*cb-dby*sb,by=fb.y+dbx*sb+dby*cb,a=bilinearGray(A,aw,ah,ax,ay),b=bilinearGray(B,bw,bh,bx,by);if(!Number.isFinite(a)||!Number.isFinite(b))return -1;va.push(a);vb.push(b);}let ma=0,mb=0;for(let i=0;i<va.length;i++){ma+=va[i];mb+=vb[i];}ma/=va.length;mb/=vb.length;let xa=0,xb=0,xx=0;for(let i=0;i<va.length;i++){const da=va[i]-ma,db=vb[i]-mb;xa+=da*da;xb+=db*db;xx+=da*db;}return xa>1&&xb>1?clamp(xx/Math.sqrt(xa*xb),-1,1):-1;}
function bilinearGray(g,w,h,x,y){if(x<0||y<0||x>w-1||y>h-1)return NaN;const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0;return g[y0*w+x0]*(1-tx)*(1-ty)+g[y0*w+x1]*tx*(1-ty)+g[y1*w+x0]*(1-tx)*ty+g[y1*w+x1]*tx*ty;}
function hamming128(a,b){let n=0;for(let i=0;i<4;i++)n+=popcnt((a[i]^b[i])>>>0);return n;}function popcnt(x){x=x-((x>>>1)&0x55555555);x=(x&0x33333333)+((x>>>2)&0x33333333);return (((x+(x>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
function makePhotoPairs(n,r){let s=0x9e3779b9>>>0,out=[];const rnd=()=>{s=(Math.imul(s^s>>>15,1|s)+(s^Math.imul(s^s>>>7,61|s)))^s;s^=s>>>14;return (s>>>0)/4294967296;};for(let i=0;i<n;i++){let a,b,c,d;do{a=Math.round((rnd()*2-1)*r);b=Math.round((rnd()*2-1)*r);c=Math.round((rnd()*2-1)*r);d=Math.round((rnd()*2-1)*r);}while(a===c&&b===d);out.push([a,b,c,d]);}return out;}
function rankFeatures(fs,max){return (fs||[]).map((f,index)=>({...f,index})).filter(f=>Number.isFinite(f.x)&&Number.isFinite(f.y)).sort((a,b)=>(+b.score||0)-(+a.score||0)).slice(0,max);}function featureQuality(f){const s=Math.max(0,+f.score||0);return clamp(.55+.35*Math.tanh(Math.log1p(s)/8),.32,1);}function sigmoid(x){return 1/(1+Math.exp(-x));}
function percentile(a,p){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return 0;const z=clamp(p,0,1)*(b.length-1),i=Math.floor(z),t=z-i;return b[i]*(1-t)+b[Math.min(b.length-1,i+1)]*t;}function median(a){return percentile(a,.5);}function meanOf(a,fn){return a.length?a.reduce((s,x)=>s+fn(x),0)/a.length:0;}
