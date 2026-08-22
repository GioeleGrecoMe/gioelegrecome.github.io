/**
 * Convert one posed keyframe into a single probabilistic proxy-depth observation.
 *
 * V30.25 hierarchy (strongest -> weakest):
 *   1. descriptor feature tracks triangulated through several Alva poses;
 *   2. plane-sweep depths photometrically verified in several Alva views;
 *   3. locally metric-calibrated Depth Anything pixels that fill the holes.
 *
 * Evidence from the same photographs is deliberately collapsed into ONE sample
 * around a pixel. This avoids the classic statistical mistake of counting Deep,
 * a feature triangulation and plane sweep from the same images as independent
 * measurements. Each sample carries:
 *   - a 3D centre covariance (epistemic localisation uncertainty),
 *   - a 3D surface covariance (the spatial footprint used for splatting),
 *   - the camera/frame ids which actually support it.
 * Raw images can therefore be discarded after fusion; the Gaussian map keeps
 * only sufficient statistics.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function depthMapToRaySamples({
  depth,relativeSigma=null,width,height,ref,K=ref?.K,baseConfidence=.5,calibrationRelativeError=.12,
  sparseSeeds=[],refinedSamples=[],sourceFrames=[],pixelStep=4,maxSamples=6500,source='deep-proxy'
}={}){
  if(!depth?.length||depth.length!==width*height||!ref?.pose||!K||!ref?.rgba?.length)return {samples:[],stats:{reason:'invalid-input'}};
  const step=Math.max(2,pixelStep|0),R=rotationFromQuat(ref.pose.q),origin=ref.pose.p;
  const refined=prepareRefined(refinedSamples,step),tracks=prepareTracks(sparseSeeds,step),verified=[],deepOnly=[],consumedTracks=new Set();
  let valid=0,rejectedEdge=0,anchored=0,shadowedByMvs=0,shadowedByTrack=0,trackEnhanced=0;

  // Multi-view plane-sweep samples are already geometrically checked. When one
  // lands on a descriptor track, use the triangulated landmark centre/covariance
  // and the MVS normal/footprint. This creates one stronger observation instead
  // of two correlated observations from the same photographs.
  for(const r of refined.items){
    if(!finite3(r?.p)||!(r.depth>0)||!(r.confidence>0))continue;
    const u=clamp(Number(r.u)||0,0,width-1),v=clamp(Number(r.v)||0,0,height-1),z=Number(r.depth),pixelFootprint=Math.max(1e-6,z/Math.max(K.fx,K.fy)*step*1.12);
    const seed=nearestTrack(tracks,u,v,Math.max(5,step*1.35)),ray=normalize(sub(r.p,origin));
    let normal=finite3(r.normal)?normalize(r.normal):normalize(sub(origin,r.p));if(dot(normal,normalize(sub(origin,r.p)))<0)normal=normal.map(x=>-x);
    const sigmaDepth=Math.max(pixelFootprint*.85,z*(.008+.035*(1-clamp(r.confidence,0,1)))),sigmaLateral=Math.max(pixelFootprint*.52,z/Math.max(K.fx,K.fy)*.70);
    const mvsCov=rayCovariance(ray,sigmaDepth,sigmaLateral),evidence=uniqueEvidence([ref.frameId||ref.id,...framesFromMask(Number(r.viewMask)||0,sourceFrames)]);
    let p=r.p.slice(0,3),cov=mvsCov,descriptor=null,trackId=null,anchorSupport=0,sourceName='proxy-verified',confidence=clamp(.56+.42*r.confidence,.08,.99);
    if(seed?.p&&finite3(seed.p)){
      consumedTracks.add(seed.trackId||seed._index);trackEnhanced++;p=seed.p.slice(0,3);cov=validCov(seed.covariance)?seed.covariance.slice(0,6):mvsCov;
      descriptor=Array.isArray(seed.descriptor)?seed.descriptor.slice(0,24):null;trackId=seed.trackId||null;anchorSupport=seed.viewSupport||0;sourceName='proxy-track-mvs';confidence=clamp(.68+.22*r.confidence+.10*(seed.confidence||.5),.12,.995);
      evidence.push(...uniqueEvidence(seed.evidenceFrames||[ref.frameId||ref.id,...(seed.sourceIds||[])]));
    }
    verified.push({
      p,normal,color:r.color||sampleRgb(ref.rgba,width,height,u,v),confidence,radius:pixelFootprint,depth:z,u,v,
      sigmaDepth,sigmaLateral,covariance:regularizeCov(cov,1e-5),surfaceCovariance:surfaceCovarianceFromNormal(normal,pixelFootprint,pixelFootprint*.82,Math.max(.001,pixelFootprint*.16)),
      source:sourceName,anchorBoost:seed?1:0,trackId,anchorSupport,descriptor,normalReliable:true,evidenceFrames:uniqueEvidence(evidence),photoCost:r.cost??null,viewSupport:r.viewSupport||evidence.length
    });
  }

  // Keep track landmarks even if local plane sweep has no accepted pixel there.
  // They are the most metric observations in the system: the same image feature
  // has already intersected rays from several known Alva camera poses.
  for(const seed of tracks.items){
    const sid=seed.trackId||seed._index;if(consumedTracks.has(sid)||!finite3(seed.p)||!(seed.depth>0))continue;
    const u=clamp(seed.u,0,width-1),v=clamp(seed.v,0,height-1),p=seed.p.slice(0,3),ray=normalize(sub(p,origin)),z=seed.depth,pixelFootprint=Math.max(.0015,z/Math.max(K.fx,K.fy)*1.1);
    const sigmaDepth=Math.max(pixelFootprint,Number(seed.sigmaDepth)||z*.025),sigmaLateral=Math.max(pixelFootprint*.42,Math.min(sigmaDepth*.55,Number(seed.worldSigma)||pixelFootprint));
    const cov=validCov(seed.covariance)?seed.covariance.slice(0,6):rayCovariance(ray,sigmaDepth,sigmaLateral),evidence=uniqueEvidence(seed.evidenceFrames||[ref.frameId||ref.id,...(seed.sourceIds||[])]);
    verified.push({
      p,normal:ray.map(x=>-x),color:sampleRgb(ref.rgba,width,height,u,v),confidence:clamp(.62+.34*(seed.confidence||.5),.10,.995),radius:pixelFootprint*.55,depth:z,u,v,
      sigmaDepth,sigmaLateral,covariance:regularizeCov(cov,1e-5),surfaceCovariance:isotropicCov(Math.max(.0015,pixelFootprint*.42)),source:'proxy-track',anchorBoost:1,
      trackId:seed.trackId||null,anchorSupport:seed.viewSupport||0,descriptor:Array.isArray(seed.descriptor)?seed.descriptor.slice(0,24):null,normalReliable:false,evidenceFrames:evidence,viewSupport:evidence.length
    });
  }

  // Deep completes the surface between explicit multi-view landmarks. Its depth
  // uncertainty remains elongated along the viewing ray. Local depth derivatives
  // define an anisotropic *surface* footprint rather than a circular voxel disk.
  for(let v=step;v<height-step;v+=step){
    for(let u=step;u<width-step;u+=step){
      const z=depth[v*width+u];if(!(z>0&&Number.isFinite(z)))continue;valid++;
      if(hasRefinedNearby(refined,u,v,Math.max(3,step*1.4))){shadowedByMvs++;continue;}
      const seed=nearestTrack(tracks,u,v,Math.max(4,step*1.35));if(seed){shadowedByTrack++;continue;}
      const zl=depth[v*width+u-step],zr=depth[v*width+u+step],zu=depth[(v-step)*width+u],zd=depth[(v+step)*width+u];if(!(zl>0&&zr>0&&zu>0&&zd>0))continue;
      const localSpread=Math.max(Math.abs(z-zl),Math.abs(z-zr),Math.abs(z-zu),Math.abs(z-zd))/Math.max(.05,z);if(localSpread>.32){rejectedEdge++;continue;}
      const p=unprojectWorld(origin,R,K,u,v,z),pl=unprojectWorld(origin,R,K,u-step,v,zl),pr=unprojectWorld(origin,R,K,u+step,v,zr),pu=unprojectWorld(origin,R,K,u,v-step,zu),pd=unprojectWorld(origin,R,K,u,v+step,zd);
      let normal=normalize(cross(sub(pr,pl),sub(pd,pu)));const toCam=normalize(sub(origin,p));if(dot(normal,toCam)<0)normal=normal.map(x=>-x);
      const pixelFootprint=Math.max(1e-6,z/Math.max(K.fx,K.fy)*step*1.20),anchor=nearestSeed(sparseSeeds,u,v,Math.max(10,step*2.5));
      const anchorBoost=anchor?clamp(1-Math.hypot(anchor.u-u,anchor.v-v)/Math.max(10,step*2.5),0,1):0;if(anchor)anchored++;
      const localRel=relativeSigma?.length===depth.length&&relativeSigma[v*width+u]>0?relativeSigma[v*width+u]:clamp(.035+1.15*Math.max(0,calibrationRelativeError),.045,.30);
      const anchorSigma=anchor?.sigmaDepth>0?anchor.sigmaDepth/Math.max(.05,z):localRel,relSigma=clamp(localRel*(1-.28*anchorBoost)+anchorSigma*.28*anchorBoost,.035,.30);
      const sigmaDepth=Math.max(pixelFootprint*1.45,z*relSigma),sigmaLateral=Math.max(pixelFootprint*.68,z/Math.max(K.fx,K.fy)*.95),ray=normalize(sub(p,origin));
      const confidence=clamp(baseConfidence*(1-.58*localSpread)*(.78+.22*anchorBoost)*(1-.55*Math.min(.7,relSigma)),.04,.90);
      const du=scale(sub(pr,pl),.5),dv=scale(sub(pd,pu),.5),surfaceCov=surfaceCovarianceFromTangents(du,dv,normal,Math.max(.001,pixelFootprint*.13));
      deepOnly.push({
        p,normal,color:sampleRgb(ref.rgba,width,height,u,v),confidence,radius:pixelFootprint,depth:z,u,v,sigmaDepth,sigmaLateral,
        covariance:rayCovariance(ray,sigmaDepth,sigmaLateral),surfaceCovariance:surfaceCov,source,anchorBoost,trackId:anchor?.trackId||null,anchorSupport:anchor?.viewSupport||0,
        normalReliable:true,evidenceFrames:uniqueEvidence([ref.frameId||ref.id])
      });
    }
  }

  // Preserve high-authority track/MVS observations first; thin only the Deep
  // completion. This keeps memory proportional to the map, not to image count.
  const samples=[];if(verified.length>=maxSamples){const stride=Math.ceil(verified.length/maxSamples);for(let i=0;i<verified.length&&samples.length<maxSamples;i+=stride)samples.push(verified[i]);}
  else{samples.push(...verified);const room=Math.max(0,maxSamples-samples.length);if(deepOnly.length<=room)samples.push(...deepOnly);else if(room>0){const stride=deepOnly.length/room;for(let k=0;k<room;k++)samples.push(deepOnly[Math.min(deepOnly.length-1,Math.floor(k*stride))]);}}
  return {samples,stats:{validPixels:valid,rejectedEdge,anchored,verified:verified.length,trackEnhanced,trackOnly:Math.max(0,verified.length-refined.items.length),deepOnly:deepOnly.length,shadowedByMvs,shadowedByTrack,samples:samples.length,pixelStep:step,relativeSigmaMedian:medianPositive(relativeSigma)}};
}

/** Packed symmetric covariance: [xx,xy,xz,yy,yz,zz]. */
export function rayCovariance(ray,sigmaDepth,sigmaLateral){const r=normalize(ray),sd2=Math.max(1e-10,sigmaDepth*sigmaDepth),sl2=Math.max(1e-10,sigmaLateral*sigmaLateral),d=sd2-sl2;return [sl2+d*r[0]*r[0],d*r[0]*r[1],d*r[0]*r[2],sl2+d*r[1]*r[1],d*r[1]*r[2],sl2+d*r[2]*r[2]];}
export function surfaceCovarianceFromTangents(du,dv,n,normalSigma){const a=scale(du,.55),b=scale(dv,.55),c=scale(normalize(n),normalSigma);return regularizeCov(addPacked(addPacked(outerPacked(a),outerPacked(b)),outerPacked(c)),1e-6);}

function surfaceCovarianceFromNormal(n,s1,s2,sn){const [t1,t2]=tangentBasis(n);return addPacked(addPacked(outerPacked(scale(t1,s1)),outerPacked(scale(t2,s2))),outerPacked(scale(normalize(n),sn)));}
function isotropicCov(s){const q=s*s;return [q,0,0,q,0,q];}
function outerPacked(v){return [v[0]*v[0],v[0]*v[1],v[0]*v[2],v[1]*v[1],v[1]*v[2],v[2]*v[2]];}
function addPacked(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2],a[3]+b[3],a[4]+b[4],a[5]+b[5]];}
function regularizeCov(c,j){const q=c.slice(0,6).map(Number),e=j*j;q[0]+=e;q[3]+=e;q[5]+=e;return q;}
function validCov(c){return Array.isArray(c)&&c.length>=6&&c.slice(0,6).every(Number.isFinite)&&c[0]>0&&c[3]>0&&c[5]>0;}
function prepareRefined(items,cell){const map=new Map(),out=[];for(const r of items||[]){if(!Number.isFinite(r?.u+r?.v+r?.depth)||!finite3(r?.p))continue;const i=out.length;out.push(r);const k=`${Math.floor(r.u/cell)},${Math.floor(r.v/cell)}`;let a=map.get(k);if(!a)map.set(k,a=[]);a.push(i);}return {items:out,map,cell};}
function prepareTracks(items,cell){const map=new Map(),out=[];let index=0;for(const s of items||[]){if(!Number.isFinite(s?.u+s?.v+s?.depth))continue;const x={...s,_index:`track-${index++}`};out.push(x);const k=`${Math.floor(s.u/cell)},${Math.floor(s.v/cell)}`;let a=map.get(k);if(!a)map.set(k,a=[]);a.push(x);}return {items:out,map,cell};}
function hasRefinedNearby(index,u,v,radius){const c=index.cell,cx=Math.floor(u/c),cy=Math.floor(v/c),rr=radius*radius;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ids=index.map.get(`${cx+dx},${cy+dy}`);if(!ids)continue;for(const i of ids){const r=index.items[i],du=r.u-u,dv=r.v-v;if(du*du+dv*dv<=rr)return true;}}return false;}
function nearestTrack(index,u,v,radius){const c=index.cell,cx=Math.floor(u/c),cy=Math.floor(v/c),rr=radius*radius;let best=null,bd=rr;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){for(const s of index.map.get(`${cx+dx},${cy+dy}`)||[]){const du=s.u-u,dv=s.v-v,d=du*du+dv*dv;if(d<bd){bd=d;best=s;}}}return best;}
function nearestSeed(seeds,u,v,radius){let best=null,bd=radius*radius;for(const s of seeds||[]){if(!Number.isFinite(s?.u+s?.v+s?.depth))continue;const dx=s.u-u,dy=s.v-v,d=dx*dx+dy*dy;if(d<bd){bd=d;best=s;}}return best;}
function framesFromMask(mask,frames){const out=[];for(let i=0;i<Math.min(16,frames?.length||0);i++)if(mask&(1<<i))out.push(frames[i]);return out;}
function uniqueEvidence(xs){return [...new Set((xs||[]).filter(x=>x!==null&&x!==undefined&&x!==''))];}
function sampleRgb(rgba,w,h,x,y){const xx=clamp(Math.round(x),0,w-1),yy=clamp(Math.round(y),0,h-1),i=(yy*w+xx)*4;return [rgba[i]||0,rgba[i+1]||0,rgba[i+2]||0];}
function unprojectWorld(o,R,K,u,v,z){const c=[(u-K.cx)/K.fx*z,(v-K.cy)/K.fy*z,z],w=rotate(R,c);return [o[0]+w[0],o[1]+w[1],o[2]+w[2]];}
function rotationFromQuat(q){let [x,y,z,w]=(q||[0,0,0,1]).map(Number),n=Math.hypot(x,y,z,w)||1;x/=n;y/=n;z/=n;w/=n;const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];}
function rotate(R,v){return [R[0]*v[0]+R[1]*v[1]+R[2]*v[2],R[3]*v[0]+R[4]*v[1]+R[5]*v[2],R[6]*v[0]+R[7]*v[1]+R[8]*v[2]];}
function tangentBasis(n){n=normalize(n);const a=Math.abs(n[2])<.85?[0,0,1]:[0,1,0],t1=normalize(cross(a,n)),t2=normalize(cross(n,t1));return [t1,t2];}
function scale(v,s){return [v[0]*s,v[1]*s,v[2]*s];}function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}function medianPositive(a){if(!a?.length)return null;const b=[];for(const x of a)if(Number.isFinite(x)&&x>0)b.push(x);if(!b.length)return null;b.sort((x,y)=>x-y);return b[b.length>>1];}
