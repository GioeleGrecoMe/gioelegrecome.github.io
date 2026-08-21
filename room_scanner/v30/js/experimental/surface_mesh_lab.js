import {GaussianBatchOptimizer,normalizeObservationState} from '../gaussian/batch_optimizer.js';
import {extractTsdfMesh} from '../dense/fusion_core.js';

/**
 * EXPERIMENTAL / ISOLATED surface-mesh laboratory (EXP-3).
 *
 * Rollback contract
 * -----------------
 * Nothing in this module mutates the production Gaussian map.  The caller sends
 * a bounded copy of confirmed Gaussians and the compact multi-view observation
 * reservoir.  BASE therefore remains byte-for-byte available while this worker
 * is running, stopped, or discarded.
 *
 * EXP-3 geometry changes
 * ----------------------
 * V30.27 EXP-1 already used oriented surfels, but its TSDF was still built from
 * a handful of off-grid samples.  A value evaluated at an arbitrary sample was
 * then stored under floor(sample/voxel), while the mesher correctly interpreted
 * that key as the VOXEL CENTRE.  On a 3 cm grid this can inject almost 1.5 cm of
 * local field jitter before any other source of error is considered.
 *
 * EXP-3 instead:
 *   1. robustly re-estimates each surfel normal from nearby compatible Gaussian
 *      centres (weighted local PCA) without mixing across corners;
 *   2. only nudges a centre along the local surface normal, never tangentially;
 *   3. evaluates an anisotropic Gaussian-weighted signed plane field at the
 *      exact centres of sparse voxels;
 *   4. uses the saved camera origins as a weaker sign/free-space vote;
 *   5. removes genuinely tiny mesh islands by physical area rather than keeping
 *      an arbitrary fixed number of components.
 *
 * This is intentionally post-scan and remains a reversible experiment.
 */
export class SurfaceMeshLab{
  constructor(gaussians=[],observationState=null,options={}){
    this.options={
      voxelM:0.03,
      truncationVoxels:3.0,
      maxVoxels:320000,
      maxTriangles:120000,
      maxGaussians:30000,
      // 2 sigma-ish tangent support is a better approximation of a splat than
      // the old five-point cross, while the hard cap prevents edge flooding.
      tangentSigmaCutoff:1.9,
      tangentFootprintVoxels:2.15,
      // Local PCA is conservative: a candidate must be spatially close AND have
      // a compatible existing normal, so perpendicular room surfaces stay split.
      localPlaneRadiusVoxels:3.4,
      localMaxNeighbors:20,
      localNormalDot:0.82,
      localNormalBlend:0.72,
      localPlaneSnap:0.52,
      localPlaneMaxSnapVoxels:0.45,
      localMinPlanarity:0.20,
      raySignWeight:0.34,
      minComponentFaces:12,
      minComponentAreaM2:0.004,
      priorWeight:0.16,
      planeWeight:0.12,
      damping:0.64,
      ...options
    };
    // GaussianBatchOptimizer clones/normalises its input, preserving isolation.
    this.optimizer=new GaussianBatchOptimizer(gaussians,observationState,{
      priorWeight:this.options.priorWeight,
      planeWeight:this.options.planeWeight,
      damping:this.options.damping
    });
    this.observations=normalizeObservationState(observationState,this.optimizer.items.length);
    this.lastMesh=null;
    this.lastSurface=[];
    this.lastSurfaceIteration=-1;
    this.lastSurfaceMax=null;
  }

  get iteration(){return this.optimizer.iteration;}
  get stats(){return this.optimizer.lastStats;}

  step(count=1){
    const stats=this.optimizer.step(count);
    this.lastSurface=[];
    this.lastSurfaceIteration=-1;
    return stats;
  }

  /** Return locally refined, surface-aligned Gaussian copies for preview/mesh. */
  surfaceSnapshot({max=null}={}){
    const cacheMax=max==null?null:Number(max);
    if(this.lastSurface.length&&this.lastSurfaceIteration===this.iteration&&this.lastSurfaceMax===cacheMax)return this.lastSurface;

    // Keep the optimiser index. Observation offsets are aligned to this exact
    // order; ranked subsets must not attach rays belonging to another surfel.
    let indexed=this.optimizer.snapshot().map((g,index)=>({g,index}));
    if(max&&indexed.length>max){
      indexed=indexed.map(x=>({...x,score:surfaceRank(x.g)})).sort((a,b)=>b.score-a.score).slice(0,max).sort((a,b)=>a.index-b.index);
    }
    const aligned=indexed.map(x=>surfaceAlignGaussian(x.g,this.observations,x.index,this.options.voxelM));
    const out=refineSurfaceNeighborhood(aligned,this.options);
    this.lastSurface=out;
    this.lastSurfaceIteration=this.iteration;
    this.lastSurfaceMax=cacheMax;
    return out;
  }

  /** Build an experimental mesh from the current private Gaussian state. */
  buildMesh(options={}){
    const cfg={...this.options,...options};
    const surface=this.surfaceSnapshot({max:cfg.maxGaussians});
    const selected=rankSurfaceGaussians(surface,cfg.maxGaussians);
    const field=buildSurfaceTsdf(selected,this.observations,cfg);
    const raw=extractTsdfMesh(field.map,cfg.voxelM,cfg.maxTriangles);
    const cleaned=filterSmallComponents(raw,cfg.minComponentFaces,{minAreaM2:cfg.minComponentAreaM2});
    this.lastMesh={
      ...cleaned,
      tsdfVoxels:field.map.size,
      integratedGaussians:field.integratedGaussians,
      integratedRays:field.integratedRays,
      meanPlanarity:field.meanPlanarity,
      experimental:true
    };
    return this.lastMesh;
  }
}

/**
 * Create a bounded copy for the worker.  This function is intentionally pure:
 * production arrays stay intact, which is the central rollback guarantee.
 */
export function selectSurfaceLabDataset(gaussians=[],observationState=null,maxGaussians=30000){
  const count=Math.min(gaussians.length,Math.max(1,maxGaussians|0));
  const ranked=gaussians.map((g,index)=>({index,score:surfaceRank(g)})).sort((a,b)=>b.score-a.score).slice(0,count);
  ranked.sort((a,b)=>a.index-b.index);
  const subset=ranked.map(x=>cloneGaussian(gaussians[x.index]));
  const obs=normalizeObservationState(observationState,gaussians.length);
  if(!obs)return {gaussians:subset,observations:null,sourceIndices:ranked.map(x=>x.index)};
  const offsets=new Uint32Array(subset.length+1),rows=[];let n=0;
  for(let i=0;i<ranked.length;i++){
    offsets[i]=n;const src=ranked[i].index,start=obs.offsets[src]||0,end=obs.offsets[src+1]||start;
    for(let oi=start;oi<end;oi++){
      const k=oi*obs.stride;for(let j=0;j<obs.stride;j++)rows.push(obs.data[k+j]);n++;
    }
  }
  offsets[subset.length]=n;
  return {gaussians:subset,observations:{stride:obs.stride,count:n,offsets,data:new Float32Array(rows)},sourceIndices:ranked.map(x=>x.index)};
}

/**
 * Robust local surface regularisation used only by EXP preview/meshing.
 *
 * The update is deliberately 1-D along the local normal.  Tangential movement
 * would shrink corners and object silhouettes.  A PCA plane is accepted only
 * when the neighbourhood has true 2-D support (planarity test) rather than a
 * line/edge, and neighbours with incompatible normals are rejected before PCA.
 */
export function refineSurfaceNeighborhood(gaussians,options={}){
  if(!gaussians?.length)return [];
  const voxel=Math.max(.006,Number(options.voxelM)||.03),radius=Math.max(voxel*2,voxel*(Number(options.localPlaneRadiusVoxels)||3.4)),cell=radius;
  const maxNeighbors=Math.max(4,Math.min(32,Number(options.localMaxNeighbors)||20)),normalDot=clamp(Number(options.localNormalDot)||.82,.55,.995),minPlanarity=clamp(Number(options.localMinPlanarity)||.20,0,.9);
  const normalBlend=clamp(Number(options.localNormalBlend)||.72,0,1),snapStrength=clamp(Number(options.localPlaneSnap)||.52,0,1),maxSnap=Math.max(voxel*.08,voxel*(Number(options.localPlaneMaxSnapVoxels)||.45));
  const points=gaussians.map(g=>arr3(g.position||g.p)),hash=buildSpatialHash(points,cell),out=new Array(gaussians.length);

  for(let i=0;i<gaussians.length;i++){
    const g=gaussians[i],p=points[i],n0=norm(arr3(g.normal||g.n,[0,0,-1])),posSigma=Math.max(voxel*.04,Number(g.positionSigma)||positionSigma(g.positionCovariance)),candidates=findCompatibleNeighbours(i,gaussians,points,hash,cell,radius,maxNeighbors,normalDot,posSigma,voxel);
    if(candidates.length<4){out[i]={...cloneGaussian(g),localPlanarity:0,localResidualM:null,localNeighbors:candidates.length};continue;}

    // Include the centre itself with a moderate weight. It stabilises tiny local
    // patches without dominating a well-observed neighbourhood.
    const samples=[{p,w:1.0},...candidates.map(c=>({p:points[c.index],w:c.weight}))],fit=weightedPlaneFit(samples);
    if(!fit||fit.planarity<minPlanarity){out[i]={...cloneGaussian(g),localPlanarity:fit?.planarity||0,localResidualM:fit?.residual??null,localNeighbors:candidates.length};continue;}

    let pn=fit.normal;if(dot(pn,n0)<0)pn=scale3(pn,-1);
    const residualQuality=clamp(1-fit.residual/Math.max(voxel*1.25,posSigma*3),0,1),planarQuality=clamp((fit.planarity-minPlanarity)/Math.max(.05,1-minPlanarity),0,1),quality=planarQuality*residualQuality;
    const blend=normalBlend*quality,newN=norm(add3(scale3(n0,1-blend),scale3(pn,blend)));
    const signed=dot(sub(p,fit.centroid),newN),delta=clamp(-signed*snapStrength*quality,-maxSnap,maxSnap),newP=add3(p,scale3(newN,delta));

    const cov=validCov(g.covariance)?Array.from(g.covariance).slice(0,6):isotropicCov(Math.max(voxel*.55,Number(g.radius)||voxel*.7)),pcov=validCov(g.positionCovariance)?Array.from(g.positionCovariance).slice(0,6):isotropicCov(voxel*.45),[t1,t2]=tangentBasis(newN),s1=Math.sqrt(Math.max(1e-12,quadPacked(cov,t1))),s2=Math.sqrt(Math.max(1e-12,quadPacked(cov,t2))),oldN=Math.sqrt(Math.max(1e-12,quadPacked(cov,newN))),posN=Math.sqrt(Math.max(1e-12,quadPacked(pcov,newN)));
    // Local plane residual is real measured thickness. Never sharpen below the
    // positional uncertainty floor, and never inflate a previously thin splat.
    const wantedN=Math.max(voxel*.04,posN*.52,fit.residual*.85),targetN=Math.min(oldN,Math.max(voxel*.04,wantedN)),surfaceCov=composeCov(t1,s1*s1,t2,s2*s2,newN,targetN*targetN);
    out[i]={...cloneGaussian(g),position:newP,normal:newN,covariance:surfaceCov,scale:[s1,s2,targetN],localPlanarity:fit.planarity,localResidualM:fit.residual,localNeighbors:candidates.length,surfaceLab:true};
  }
  return out;
}

/**
 * Build a sparse signed surface field at exact voxel centres.
 *
 * Each surfel contributes an anisotropic tangent Gaussian multiplied by a TSDF
 * band along its oriented normal.  This is a lightweight approximation of a
 * Gaussian opacity/surface field: the spatial grid is only an extraction index,
 * not the representation itself.
 */
export function buildSurfaceTsdf(gaussians,observationState,options={}){
  const voxel=Math.max(.006,Number(options.voxelM)||.03),trunc=Math.max(voxel*2,voxel*(Number(options.truncationVoxels)||3)),maxVoxels=Math.max(5000,Number(options.maxVoxels)||320000),cutoff=clamp(Number(options.tangentSigmaCutoff)||1.9,1.1,2.8),footCap=Math.max(voxel*.65,voxel*(Number(options.tangentFootprintVoxels)||2.15)),raySignWeight=clamp(Number(options.raySignWeight)||.34,0,1);
  const obs=normalizeObservationState(observationState,observationState?.offsets?.length?observationState.offsets.length-1:gaussians.length),map=new Map();let integratedGaussians=0,integratedRays=0,planaritySum=0,planarityCount=0;
  const addKey=(x,y,z,sd,w,color)=>{
    if(!(w>0)||!Number.isFinite(sd))return;
    const key=`${x},${y},${z}`,old=map.get(key),clamped=clamp(sd,-1,1);
    if(old){const denom=old.w+w,mix=w/Math.max(1e-9,denom);old.d=(old.d*old.w+clamped*w)/denom;old.w=Math.min(255,denom);if(Math.abs(clamped)<.55)old.color=mix3(old.color,color,mix);}else if(map.size<maxVoxels)map.set(key,{d:clamped,w:Math.min(255,w),color:color.slice(0,3)});
  };
  const centre=(x,y,z)=>[(x+.5)*voxel,(y+.5)*voxel,(z+.5)*voxel];

  for(let gi=0;gi<gaussians.length&&map.size<maxVoxels;gi++){
    const g=gaussians[gi],p=arr3(g.position||g.p),n=norm(arr3(g.normal||g.n,[0,0,-1]));if(!finite3(p)||!finite3(n))continue;
    const [t1,t2]=tangentBasis(n),cov=validCov(g.covariance)?Array.from(g.covariance).slice(0,6):isotropicCov(Math.max(voxel*.55,Number(g.radius)||voxel*.7)),pcov=validCov(g.positionCovariance)?Array.from(g.positionCovariance).slice(0,6):isotropicCov(voxel*.45);
    const s1=Math.max(voxel*.30,Math.sqrt(Math.max(1e-12,quadPacked(cov,t1)))),s2=Math.max(voxel*.30,Math.sqrt(Math.max(1e-12,quadPacked(cov,t2)))),sn=Math.sqrt(Math.max(1e-12,quadPacked(pcov,n))),r1=Math.min(footCap,Math.max(voxel*.72,s1*cutoff)),r2=Math.min(footCap,Math.max(voxel*.72,s2*cutoff));
    const confidence=clamp(Number(g.confidence??.55),.03,1),supportGain=.42+.58*Math.min(1,Math.log2(1+Math.max(1,Number(g.support)||1))/2.8),uncertaintyGain=clamp(voxel/Math.max(voxel*.35,sn),.16,1),planarity=clamp(Number(g.localPlanarity)||0,0,1),shapeGain=.72+.28*planarity,color=arr3(g.color||g.rgb,[180,200,220]),baseWeight=Math.max(.018,confidence*supportGain*uncertaintyGain*shapeGain);
    if(Number.isFinite(g.localPlanarity)){planaritySum+=planarity;planarityCount++;}

    // Axis-aligned bounds of the oriented tangent ellipse + normal TSDF band.
    const extent=[0,1,2].map(a=>Math.abs(t1[a])*r1+Math.abs(t2[a])*r2+Math.abs(n[a])*trunc+voxel*.51),mins=extent.map((e,a)=>Math.floor((p[a]-e)/voxel)),maxs=extent.map((e,a)=>Math.floor((p[a]+e)/voxel));
    for(let z=mins[2];z<=maxs[2]&&map.size<maxVoxels;z++)for(let y=mins[1];y<=maxs[1]&&map.size<maxVoxels;y++)for(let x=mins[0];x<=maxs[0]&&map.size<maxVoxels;x++){
      const q=centre(x,y,z),d=sub(q,p),nd=dot(d,n);if(Math.abs(nd)>trunc)continue;const u=dot(d,t1),v=dot(d,t2);if(Math.abs(u)>r1||Math.abs(v)>r2)continue;
      const rho2=(u/s1)**2+(v/s2)**2;if(rho2>cutoff*cutoff)continue;const tangentWeight=Math.exp(-.5*rho2),normalWeight=1-.22*Math.abs(nd/trunc),w=baseWeight*tangentWeight*normalWeight;if(w<.004)continue;
      addKey(x,y,z,nd/trunc,w,color);
    }

    // Saved camera origins provide a weaker independent sign vote.  Importantly
    // sourceIndex survives ranked previews/subsets, so rays can never be attached
    // to a different Gaussian simply because the preview list was truncated.
    if(obs&&raySignWeight>0){
      const sourceIndex=Number.isInteger(g.surfaceLabSourceIndex)?g.surfaceLabSourceIndex:gi,start=obs.offsets[sourceIndex]||0,end=obs.offsets[sourceIndex+1]||start;
      for(let oi=start;oi<end&&map.size<maxVoxels;oi++){
        const o=readObservation(obs,oi);if(!o)continue;const rayVec=sub(p,o.origin),depth=Math.hypot(...rayVec);if(!(depth>voxel))continue;const ray=scale3(rayVec,1/depth),view=Math.max(.08,Math.abs(dot(n,scale3(ray,-1)))),rw=baseWeight*raySignWeight*clamp(o.confidence,.05,1)*(.35+.65*view),seen=new Set();
        for(let off=-trunc*1.35;off<=trunc+1e-9;off+=voxel*.72){
          const t=depth+off;if(t<=0)continue;const qs=add3(o.origin,scale3(ray,t)),x=Math.floor(qs[0]/voxel),y=Math.floor(qs[1]/voxel),z=Math.floor(qs[2]/voxel),key=`${x},${y},${z}`;if(seen.has(key))continue;seen.add(key);
          const q=centre(x,y,z),tc=dot(sub(q,o.origin),ray),lateral=Math.hypot(...sub(sub(q,o.origin),scale3(ray,tc)));if(lateral>voxel*.92)continue;const centredOff=tc-depth;if(Math.abs(centredOff)>trunc*1.45)continue;
          // Camera/front side (tc < depth) is positive/free.
          addKey(x,y,z,-centredOff/trunc,rw*(1-.16*Math.min(1,Math.abs(centredOff)/trunc)),color);
        }
        integratedRays++;
      }
    }
    integratedGaussians++;
  }
  return {map,integratedGaussians,integratedRays,meanPlanarity:planarityCount?planaritySum/planarityCount:0};
}

/** Remove only physically tiny islands. Large disconnected room parts survive. */
export function filterSmallComponents(mesh,minFaces=12,{minAreaM2=.004}={}){
  const F=mesh?.faces||new Uint32Array(),V=mesh?.vertices||new Float32Array(),C=mesh?.colors||new Uint8Array();if(F.length<3)return mesh;
  const nv=V.length/3,parent=new Int32Array(nv);for(let i=0;i<nv;i++)parent[i]=i;
  const find=x=>{let r=x;while(parent[r]!==r)r=parent[r];while(parent[x]!==x){const n=parent[x];parent[x]=r;x=n;}return r;};
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
  for(let i=0;i<F.length;i+=3){join(F[i],F[i+1]);join(F[i],F[i+2]);}
  const stats=new Map();for(let i=0;i<F.length;i+=3){const r=find(F[i]),s=stats.get(r)||{faces:0,area:0};s.faces++;s.area+=triangleArea(V,F[i],F[i+1],F[i+2]);stats.set(r,s);}
  const ranked=[...stats.entries()].sort((a,b)=>b[1].area-a[1].area),largestArea=ranked[0]?.[1]?.area||0,adaptiveFaces=Math.max(4,Math.min(Math.max(4,minFaces|0),Math.ceil((F.length/3)*.001))),areaGate=Math.max(Number(minAreaM2)||.004,largestArea*.0008),keep=new Set();
  for(let i=0;i<ranked.length;i++){const [root,s]=ranked[i];if(i===0||(s.faces>=adaptiveFaces&&s.area>=areaGate*.30)||s.area>=areaGate)keep.add(root);}
  if(keep.size===stats.size)return {...mesh,components:stats.size,keptComponents:keep.size};
  const used=new Map(),vertices=[],colors=[],faces=[];
  const remap=old=>{let n=used.get(old);if(n!==undefined)return n;n=vertices.length/3;used.set(old,n);vertices.push(V[old*3],V[old*3+1],V[old*3+2]);colors.push(C[old*3]??180,C[old*3+1]??200,C[old*3+2]??220);return n;};
  for(let i=0;i<F.length;i+=3){if(!keep.has(find(F[i])))continue;faces.push(remap(F[i]),remap(F[i+1]),remap(F[i+2]));}
  return {...mesh,vertices:new Float32Array(vertices),colors:new Uint8Array(colors),faces:new Uint32Array(faces),components:stats.size,keptComponents:keep.size};
}

function surfaceAlignGaussian(g,obs,index,voxel){
  const p=arr3(g.position||g.p),normal=norm(arr3(g.normal||g.n,[0,0,-1])),oriented=orientNormalToObservations(normal,p,obs,index),cov=validCov(g.covariance)?Array.from(g.covariance).slice(0,6).map(Number):isotropicCov(Math.max(voxel*.55,Number(g.radius)||voxel*.7)),pcov=validCov(g.positionCovariance)?Array.from(g.positionCovariance).slice(0,6).map(Number):isotropicCov(voxel*.45),[t1,t2]=tangentBasis(oriented),s1=Math.sqrt(Math.max(1e-12,quadPacked(cov,t1))),s2=Math.sqrt(Math.max(1e-12,quadPacked(cov,t2))),oldN=Math.sqrt(Math.max(1e-12,quadPacked(cov,oriented))),posN=Math.sqrt(Math.max(1e-12,quadPacked(pcov,oriented))),targetN=Math.max(voxel*.045,posN*.58,Math.min(oldN,Math.max(voxel*.12,Math.min(s1,s2)*.14))),surfaceCov=composeCov(t1,s1*s1,t2,s2*s2,oriented,targetN*targetN);
  return {...cloneGaussian(g),position:p,normal:oriented,covariance:surfaceCov,scale:[s1,s2,targetN],surfaceLabSourceIndex:index,surfaceLab:true};
}
function orientNormalToObservations(n,p,obs,index){if(!obs)return n;const start=obs.offsets[index]||0,end=obs.offsets[index+1]||start;let v=[0,0,0],w=0;for(let i=start;i<end;i++){const o=readObservation(obs,i);if(!o)continue;const toCam=norm(sub(o.origin,p)),ww=clamp(o.confidence,.05,1);v=add3(v,scale3(toCam,ww));w+=ww;}if(w<=0||Math.hypot(...v)<1e-8)return n;return dot(n,v)<0?scale3(n,-1):n;}
function readObservation(obs,index){const k=index*obs.stride,a=obs.data;if(k+12>=a.length)return null;const origin=[a[k],a[k+1],a[k+2]],p=[a[k+3],a[k+4],a[k+5]],covariance=[a[k+6],a[k+7],a[k+8],a[k+9],a[k+10],a[k+11]],confidence=a[k+12];return finite3(origin)&&finite3(p)&&validCov(covariance)?{origin,p,covariance,confidence}:null;}

function findCompatibleNeighbours(i,items,points,hash,cell,radius,max,normalDot,posSigma,voxel){
  const p=points[i],n=norm(arr3(items[i].normal||items[i].n,[0,0,-1])),c=cellOf(p,cell),out=[],depthGate=Math.max(voxel*1.35,posSigma*3.2),r2=radius*radius;
  for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const j of hash.get(`${c[0]+dx},${c[1]+dy},${c[2]+dz}`)||[]){
    if(j===i)continue;const q=points[j],d=sub(q,p),dd=dot(d,d);if(dd>r2)continue;const nj=norm(arr3(items[j].normal||items[j].n,[0,0,-1])),align=Math.abs(dot(n,nj));if(align<normalDot)continue;if(Math.abs(dot(d,n))>depthGate)continue;
    const sigma=Math.max(voxel*.18,Number(items[j].positionSigma)||positionSigma(items[j].positionCovariance)),conf=clamp(Number(items[j].confidence??.5),.05,1),spatial=Math.exp(-.5*dd/Math.max(1e-12,r2*.42)),weight=conf*spatial*Math.pow(align,4)/(sigma*sigma+(voxel*.22)**2);out.push({index:j,d2:dd,weight});
  }
  out.sort((a,b)=>a.d2-b.d2);return out.slice(0,max);
}
function weightedPlaneFit(samples){
  let sw=0,c=[0,0,0];for(const s of samples){if(!(s.w>0)||!finite3(s.p))continue;sw+=s.w;c=add3(c,scale3(s.p,s.w));}if(!(sw>0))return null;c=scale3(c,1/sw);
  let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0;for(const s of samples){if(!(s.w>0)||!finite3(s.p))continue;const d=sub(s.p,c),w=s.w;xx+=w*d[0]*d[0];xy+=w*d[0]*d[1];xz+=w*d[0]*d[2];yy+=w*d[1]*d[1];yz+=w*d[1]*d[2];zz+=w*d[2]*d[2];}const eig=eigenSym3([xx/sw,xy/sw,xz/sw,yy/sw,yz/sw,zz/sw]);if(!eig)return null;
  const order=[0,1,2].sort((a,b)=>eig.values[a]-eig.values[b]),l0=Math.max(0,eig.values[order[0]]),l1=Math.max(0,eig.values[order[1]]),l2=Math.max(1e-14,eig.values[order[2]]),normal=norm(eig.vectors[order[0]]),planarity=clamp((l1-l0)/l2,0,1);let rss=0;for(const s of samples){if(!(s.w>0))continue;const z=dot(sub(s.p,c),normal);rss+=s.w*z*z;}return {centroid:c,normal,planarity,residual:Math.sqrt(Math.max(0,rss/sw)),eigenvalues:[l0,l1,l2]};
}
function eigenSym3(c){
  if(!c?.length||c.length<6||!Array.from(c).every(Number.isFinite))return null;const a=[[c[0],c[1],c[2]],[c[1],c[3],c[4]],[c[2],c[4],c[5]]],v=[[1,0,0],[0,1,0],[0,0,1]];
  for(let sweep=0;sweep<10;sweep++){
    let p=0,q=1,m=Math.abs(a[0][1]);if(Math.abs(a[0][2])>m){p=0;q=2;m=Math.abs(a[0][2]);}if(Math.abs(a[1][2])>m){p=1;q=2;m=Math.abs(a[1][2]);}if(m<1e-12)break;
    const app=a[p][p],aqq=a[q][q],apq=a[p][q],phi=.5*Math.atan2(2*apq,aqq-app),cs=Math.cos(phi),sn=Math.sin(phi);
    for(let k=0;k<3;k++){if(k===p||k===q)continue;const akp=a[k][p],akq=a[k][q];a[k][p]=a[p][k]=cs*akp-sn*akq;a[k][q]=a[q][k]=sn*akp+cs*akq;}
    a[p][p]=cs*cs*app-2*sn*cs*apq+sn*sn*aqq;a[q][q]=sn*sn*app+2*sn*cs*apq+cs*cs*aqq;a[p][q]=a[q][p]=0;
    for(let k=0;k<3;k++){const vkp=v[k][p],vkq=v[k][q];v[k][p]=cs*vkp-sn*vkq;v[k][q]=sn*vkp+cs*vkq;}
  }
  return {values:[a[0][0],a[1][1],a[2][2]],vectors:[[v[0][0],v[1][0],v[2][0]],[v[0][1],v[1][1],v[2][1]],[v[0][2],v[1][2],v[2][2]]]};
}

function rankSurfaceGaussians(items,max){if(!max||items.length<=max)return items;return items.map((g,i)=>({g,i,s:surfaceRank(g)})).sort((a,b)=>b.s-a.s).slice(0,max).sort((a,b)=>a.i-b.i).map(x=>x.g);}
function surfaceRank(g){const conf=clamp(Number(g?.confidence??.45),0,1),support=Math.max(1,Number(g?.support)||1),sigma=Number(g?.positionSigma)||positionSigma(g?.positionCovariance),planarity=clamp(Number(g?.localPlanarity)||0,0,1);return 2.4*conf+Math.min(3,Math.log2(1+support))+.45*planarity-.45*Math.min(4,sigma/.02);}
function positionSigma(c){return validCov(c)?Math.sqrt(Math.max(1e-12,(Number(c[0])+Number(c[3])+Number(c[5]))/3)):.04;}
function cloneGaussian(g){const o={...g};for(const k of ['position','p','mean','xyz','normal','n','color','rgb','scale','scales','covariance','positionCovariance','basis','descriptor'])if(Array.isArray(g?.[k])||ArrayBuffer.isView(g?.[k]))o[k]=Array.from(g[k]);return o;}
function composeCov(a,va,b,vb,c,vc){return [va*a[0]*a[0]+vb*b[0]*b[0]+vc*c[0]*c[0],va*a[0]*a[1]+vb*b[0]*b[1]+vc*c[0]*c[1],va*a[0]*a[2]+vb*b[0]*b[2]+vc*c[0]*c[2],va*a[1]*a[1]+vb*b[1]*b[1]+vc*c[1]*c[1],va*a[1]*a[2]+vb*b[1]*b[2]+vc*c[1]*c[2],va*a[2]*a[2]+vb*b[2]*b[2]+vc*c[2]*c[2]];}
function tangentBasis(n){const a=Math.abs(n[2])<.85?[0,0,1]:[0,1,0],t1=norm(cross(a,n)),t2=norm(cross(n,t1));return [t1,t2];}
function isotropicCov(s){const q=s*s;return [q,0,0,q,0,q];}
function validCov(c){return !!c&&c.length>=6&&Array.from(c).slice(0,6).every(Number.isFinite)&&Number(c[0])>0&&Number(c[3])>0&&Number(c[5])>0;}
function quadPacked(c,v){return v[0]*(c[0]*v[0]+c[1]*v[1]+c[2]*v[2])+v[1]*(c[1]*v[0]+c[3]*v[1]+c[4]*v[2])+v[2]*(c[2]*v[0]+c[4]*v[1]+c[5]*v[2]);}
function buildSpatialHash(points,cell){const map=new Map();for(let i=0;i<points.length;i++){const k=cellKey(points[i],cell);let a=map.get(k);if(!a)map.set(k,a=[]);a.push(i);}return map;}
function cellOf(p,v){return [Math.floor(p[0]/v),Math.floor(p[1]/v),Math.floor(p[2]/v)];}
function cellKey(p,v){const c=cellOf(p,v);return `${c[0]},${c[1]},${c[2]}`;}
function triangleArea(V,a,b,c){const p=[V[a*3],V[a*3+1],V[a*3+2]],q=[V[b*3],V[b*3+1],V[b*3+2]],r=[V[c*3],V[c*3+1],V[c*3+2]],cr=cross(sub(q,p),sub(r,p));return .5*Math.hypot(...cr);}
function arr3(x,f=[0,0,0]){return x&&x.length>=3?[Number(x[0]),Number(x[1]),Number(x[2])]:f.slice();}
function finite3(p){return p&&p.length>=3&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2]);}
function norm(v){const d=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/d,v[1]/d,v[2]/d];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function add3(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function scale3(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
function mix3(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
