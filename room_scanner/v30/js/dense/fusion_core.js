/**
 * Compact probabilistic multi-view surface fusion.
 *
 * V30.24 changes the authority model of the dense reconstruction:
 * - a single Deep/MVS depth sample is only a ray observation, never a mesh;
 * - observations are stored as anisotropic Gaussian-like surfels;
 * - a new frame must agree with an existing surfel in both lateral ray distance
 *   and axial depth before it can increase multi-view support;
 * - the TSDF is rebuilt from the CURRENT confirmed surfels when a mesh is
 *   requested.  Wrong early observations therefore disappear instead of being
 *   permanently fossilised in an incremental TSDF.
 *
 * Memory stays bounded: each spatial cell stores only a running mean,
 * uncertainty, colour/normal and a few view-consensus statistics.  Raw frames
 * and raw per-pixel histories are not retained here.
 */
export class SparseDenseFusion{
  constructor({
    voxel=.035,truncation=null,maxSurfels=180000,maxTsdf=450000,minSupport=2,
    minConfirmBaseline=null,maxRaySigma=3.0,maxNormalAngleRad=1.25,
    tsdfMinSupport=null,tsdfMaxSurfels=70000
  }={}){
    this.voxel=voxel;this.truncation=truncation||voxel*3;this.maxSurfels=maxSurfels;this.maxTsdf=maxTsdf;this.minSupport=Math.max(2,minSupport|0);
    this.minConfirmBaseline=Number.isFinite(minConfirmBaseline)?Math.max(0,minConfirmBaseline):voxel*.75;
    this.maxRaySigma=Math.max(1.5,Number(maxRaySigma)||3);this.minNormalDot=Math.cos(Math.max(.2,Math.min(Math.PI/2,Number(maxNormalAngleRad)||1.25)));
    this.tsdfMinSupport=Math.max(this.minSupport,tsdfMinSupport|0||this.minSupport);this.tsdfMaxSurfels=Math.max(1000,tsdfMaxSurfels|0||70000);
    this.surfels=new Map();this.tsdf=new Map();this.frames=0;this.samplesIn=0;this.rejected=0;this.matched=0;this.created=0;this.lastMeshAtFrame=0;
  }

  integrate(samples,{origin=[0,0,0],frameId=`f${this.frames}`,mode='dense'}={}){
    this.frames++;let accepted=0,matched=0,created=0,rejected=0;const touched=new Set();
    for(const raw of samples||[]){
      if(!finite3(raw?.p)||!(raw.confidence>0)){rejected++;continue;}
      this.samplesIn++;const s=normaliseObservation(raw,origin,this.voxel,mode),r=this._integrateObservation(s,frameId,touched);
      if(r==='matched'){accepted++;matched++;}else if(r==='created'){accepted++;created++;}else rejected++;
    }
    this.matched+=matched;this.created+=created;this.rejected+=rejected;
    const confirmed=this._confirmedCount();
    return {accepted,matched,created,rejected,frames:this.frames,surfels:this.surfels.size,confirmed,tsdfVoxels:this.tsdf.size};
  }

  _integrateObservation(s,frameId,touched){
    const found=this._findCompatible(s),key=found?.key,surfel=found?.surfel;
    if(surfel){
      // Jobs can finish out of order (e.g. Deep(k+1) before MVS(k)).  A single
      // `lastFrame` marker would then count frame k twice.  Keep only a tiny
      // bounded set of recent frame IDs per surfel so support really means
      // distinct camera viewpoints without retaining the frame history.
      const firstForFrame=!surfel.recentFrames?.includes(frameId);
      this._updateSurfel(surfel,s,frameId,firstForFrame);
      if(firstForFrame)touched.add(key);
      return 'matched';
    }
    const ownKey=voxelKey(s.p,this.voxel),occupied=this.surfels.get(ownKey);
    if(occupied){
      // One bad one-view hypothesis must not block the cell forever.  Replace it
      // only with clearly stronger evidence; confirmed surfaces are immutable to
      // single incompatible observations and require a neighbouring consensus.
      if(occupied.support<=1&&s.weight>occupied.weight*1.45){this.surfels.set(ownKey,this._newSurfel(s,frameId));return 'created';}
      return 'rejected';
    }
    if(this.surfels.size>=this.maxSurfels)return 'rejected';
    this.surfels.set(ownKey,this._newSurfel(s,frameId));return 'created';
  }

  _findCompatible(s){
    let best=null,bestScore=Infinity;
    // Search an anisotropic corridor along the current camera ray.  This is the
    // discrete equivalent of intersecting the new elongated depth Gaussian with
    // existing surfels: axial uncertainty may span several voxels, while the
    // lateral search remains only one cell wide.
    const axial=Math.min(this.voxel*9,Math.max(this.voxel*1.25,s.sigmaDepth*this.maxRaySigma)),seen=new Set(),cross=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for(let off=-axial;off<=axial+1e-9;off+=this.voxel){
      const q=[s.p[0]+s.ray[0]*off,s.p[1]+s.ray[1]*off,s.p[2]+s.ray[2]*off],c=cellOf(q,this.voxel);
      for(const d of cross){const key=`${c[0]+d[0]},${c[1]+d[1]},${c[2]+d[2]}`;if(seen.has(key))continue;seen.add(key);const a=this.surfels.get(key);if(!a)continue;const score=compatibilityScore(a,s,this.voxel,this.maxRaySigma,this.minNormalDot);if(score<bestScore){bestScore=score;best={key,surfel:a};}}
    }
    return best;
  }

  _newSurfel(s,frameId){
    return {
      p:[...s.p],n:[...s.n],color:[...s.color],radius:s.radius,confidence:s.confidence,weight:s.weight,
      sigmaDepth:s.sigmaDepth,sigmaLateral:s.sigmaLateral,support:1,observations:1,lastFrame:frameId,recentFrames:[frameId],
      firstOrigin:[...s.origin],lastOrigin:[...s.origin],firstRay:[...s.ray],maxBaseline:0,maxViewAngle:0,
      deepWeight:s.source==='deep-ray'?s.weight:0,mvsWeight:s.source==='deep-ray'?0:s.weight,sourceMask:s.source==='deep-ray'?1:2
    };
  }

  _updateSurfel(a,s,frameId,firstForFrame){
    // Keep normal orientation coherent before averaging.  Deep/MVS normals are
    // locally estimated and can flip sign when the camera crosses a tangent.
    let n=s.n;if(dot(a.n,n)<0)n=n.map(v=>-v);
    const w=Math.max(.02,Math.min(10,s.weight)),oldW=Math.max(.02,a.weight),nw=Math.min(1e5,oldW+w),t=w/nw,newSource=(s.source==='deep-ray'?(a.sourceMask&1)===0:(a.sourceMask&2)===0);
    a.p=mix3(a.p,s.p,t);a.n=norm(mix3(a.n,n,t));a.color=mix3(a.color,s.color,t);a.radius=(a.radius*oldW+s.radius*w)/nw;
    // Precision only adds for a new camera viewpoint, or once when a different
    // estimator (Deep vs multi-view refinement) first touches the surfel.  Many
    // pixels/replayed async jobs from one image must not create fake certainty.
    if(firstForFrame||newSource){a.sigmaDepth=Math.max(this.voxel*.28,combineSigma(a.sigmaDepth,s.sigmaDepth));a.sigmaLateral=Math.max(this.voxel*.18,combineSigma(a.sigmaLateral,s.sigmaLateral));}
    a.confidence=Math.min(1,(a.confidence*oldW+s.confidence*w)/nw);a.weight=nw;a.observations++;
    if(s.source==='deep-ray'){a.deepWeight+=w;a.sourceMask|=1;}else{a.mvsWeight+=w;a.sourceMask|=2;}
    if(firstForFrame){
      a.support++;a.lastFrame=frameId;a.lastOrigin=[...s.origin];a.recentFrames??=[];a.recentFrames.push(frameId);if(a.recentFrames.length>12)a.recentFrames.splice(0,a.recentFrames.length-12);
      const baseline=Math.hypot(...sub(s.origin,a.firstOrigin));a.maxBaseline=Math.max(a.maxBaseline,baseline);
      const ca=clamp(dot(a.firstRay,s.ray),-1,1);a.maxViewAngle=Math.max(a.maxViewAngle,Math.acos(ca));
    }
  }

  _isConfirmed(s){
    // Support must come from multiple frame IDs.  A tiny baseline is still useful
    // for noise reduction, but it cannot by itself turn a monocular ray into a
    // surface.  Very large view-angle diversity can substitute a small baseline.
    return s.support>=this.minSupport&&(s.maxBaseline>=this.minConfirmBaseline||s.maxViewAngle>=.025)&&s.confidence>=.10;
  }
  _confirmedCount(){let n=0;for(const s of this.surfels.values())if(this._isConfirmed(s))n++;return n;}

  confirmedSurfels({max=50000}={}){
    const arr=[];for(const s of this.surfels.values())if(this._isConfirmed(s))arr.push(s);
    arr.sort((a,b)=>surfaceRank(b)-surfaceRank(a));return arr.slice(0,max);
  }
  splats(opts={}){
    return this.confirmedSurfels(opts).map(s=>{
      const axial=Math.max(s.sigmaDepth,s.radius*.75),lat=Math.max(s.sigmaLateral,s.radius*.65),mixed=(s.sourceMask&3)===3;
      return {position:s.p,normal:s.n,color:s.color.map(v=>Math.round(clamp(v,0,255))),scale:[Math.max(.003,lat*1.35),Math.max(.003,lat*1.35),Math.max(.0015,Math.min(axial,lat*2.5)*.38)],opacity:clamp(.18+.12*s.support+.42*s.confidence+(mixed?.08:0),.22,.94),confidence:s.confidence,support:s.support,observations:s.observations,maxBaseline:s.maxBaseline,sigmaDepth:s.sigmaDepth,sigmaLateral:s.sigmaLateral,mixedEvidence:mixed};
    });
  }

  /**
   * Rebuild a fresh TSDF from the current consensus instead of incrementally
   * preserving every historical depth error.  This is the crucial "measurements
   * improve with exploration" property: moving a surfel moves the next mesh too.
   */
  mesh({maxTriangles=90000,maxSurfels=this.tsdfMaxSurfels}={}){
    this.tsdf=this._buildTsdfFromConsensus(maxSurfels);this.lastMeshAtFrame=this.frames;return extractTsdfMesh(this.tsdf,this.voxel,maxTriangles);
  }

  _buildTsdfFromConsensus(maxSurfels=this.tsdfMaxSurfels){
    const map=new Map(),surfels=this.confirmedSurfels({max:Math.max(1000,Math.min(this.tsdfMaxSurfels,maxSurfels|0||this.tsdfMaxSurfels))});
    for(const s of surfels){
      if(s.support<this.tsdfMinSupport)continue;const n=norm(s.n),tr=Math.max(this.truncation,s.sigmaDepth*1.15,s.radius*1.8),step=this.voxel;
      // A tiny tangent footprint makes neighbouring surfels connect without
      // inventing a large disk.  Radius is bounded by the observed pixel scale.
      const [t1,t2]=tangentBasis(n),r=Math.min(this.voxel*1.25,Math.max(this.voxel*.35,s.radius*.75)),offsets=[[0,0],[r,0],[-r,0],[0,r],[0,-r]];
      for(const [a,b] of offsets){const base=[s.p[0]+t1[0]*a+t2[0]*b,s.p[1]+t1[1]*a+t2[1]*b,s.p[2]+t1[2]*a+t2[2]*b];
        for(let off=-tr;off<=tr+1e-9;off+=step){if(map.size>=this.maxTsdf)break;const q=[base[0]+n[0]*off,base[1]+n[1]*off,base[2]+n[2]*off],key=voxelKey(q,this.voxel),sd=clamp(off/tr,-1,1),old=map.get(key),supportGain=Math.min(1,Math.max(0,(s.support-this.tsdfMinSupport+1)/3)),w=Math.max(.04,s.confidence*(.65+.35*supportGain)*(1-.32*Math.abs(sd)));
          if(old){const nw=old.w+w;old.d=(old.d*old.w+sd*w)/nw;old.w=Math.min(255,nw);if(Math.abs(sd)<.45)old.color=mix3(old.color,s.color,w/nw);}else map.set(key,{d:sd,w,color:[...s.color]});
        }
        if(map.size>=this.maxTsdf)break;
      }
      if(map.size>=this.maxTsdf)break;
    }
    return map;
  }
}

function normaliseObservation(s,origin,voxel,mode){
  const p=s.p.slice(0,3).map(Number),o=finite3(origin)?origin.slice(0,3).map(Number):[0,0,0],v=sub(p,o),depth=Number.isFinite(s.depth)&&s.depth>0?s.depth:Math.hypot(...v),ray=norm(v),radius=Math.max(voxel*.16,Number(s.radius)||voxel*.55),source=s.source||(/deep/i.test(mode)?'deep-ray':'mvs-refined');
  let n=finite3(s.normal)?norm(s.normal):ray.map(x=>-x);if(dot(n,ray)>0)n=n.map(x=>-x);
  const sigmaLateral=Math.max(voxel*.18,Number(s.sigmaLateral)||radius*.85),defaultRel=source==='deep-ray'?.10:.035,sigmaDepth=Math.max(voxel*.35,Number(s.sigmaDepth)||Math.max(radius*1.5,depth*defaultRel));
  const confidence=clamp(Number(s.confidence)||.15,.02,1),sourceWeight=source==='deep-ray'?.48:1,precision=1/Math.max(1e-8,sigmaDepth*sigmaDepth+2*sigmaLateral*sigmaLateral),weight=clamp(confidence*sourceWeight*precision*voxel*voxel,.025,3.5);
  return {p,origin:o,ray,depth,n,color:(s.color||[180,200,220]).slice(0,3).map(Number),radius,confidence,sigmaDepth,sigmaLateral,source,weight};
}

function compatibilityScore(a,s,voxel,maxSigma,minNormalDot){
  const v=sub(a.p,s.origin),along=dot(v,s.ray);if(along<=0)return Infinity;
  const closest=[s.origin[0]+s.ray[0]*along,s.origin[1]+s.ray[1]*along,s.origin[2]+s.ray[2]*along],lateral=Math.hypot(...sub(a.p,closest)),axial=Math.abs(along-s.depth),euclid=Math.hypot(...sub(a.p,s.p));
  const latSigma=Math.hypot(a.sigmaLateral,s.sigmaLateral),axSigma=Math.hypot(a.sigmaDepth,s.sigmaDepth),latLimit=maxSigma*latSigma+voxel*.35,axLimit=maxSigma*axSigma+voxel*.55;
  if(lateral>latLimit||axial>axLimit||euclid>Math.max(voxel*3.2,axLimit*1.1))return Infinity;
  const nd=Math.abs(dot(a.n,s.n));if(nd<minNormalDot)return Infinity;
  return (lateral/Math.max(voxel*.2,latSigma))**2+.62*(axial/Math.max(voxel*.3,axSigma))**2+.22*(1-nd);
}
function combineSigma(a,b){a=Math.max(1e-8,a);b=Math.max(1e-8,b);return Math.sqrt(1/(1/(a*a)+1/(b*b)));}
function surfaceRank(s){return 2.4*s.support+1.4*s.confidence+.4*Math.min(1,s.maxBaseline/(s.sigmaDepth+1e-6))+.25*Math.min(6,s.observations);}
function tangentBasis(n){const a=Math.abs(n[2])<.85?[0,0,1]:[0,1,0],t1=norm(cross(a,n)),t2=norm(cross(n,t1));return [t1,t2];}

export function extractTsdfMesh(map,voxel,maxTriangles=90000){
  const vertices=[],colors=[],faces=[],vmap=new Map(),get=(x,y,z)=>map.get(`${x},${y},${z}`),keys=[...map.keys()],tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],corner=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  let tri=0;
  for(const k of keys){if(tri>=maxTriangles)break;const [x,y,z]=k.split(',').map(Number),vals=corner.map(c=>get(x+c[0],y+c[1],z+c[2]));
    // Unknown TSDF space is NOT free space.  The previous extractor substituted
    // +1 for missing corners, which manufactured zero crossings at the boundary
    // of the observed volume and produced displaced phantom walls/shells.
    // Require a completely observed cube and a real sign change instead.
    if(vals.some(v=>!v))continue;const d=vals.map(v=>v.d);if(Math.min(...d)>0||Math.max(...d)<0||Math.min(...d.map(Math.abs))>.55)continue;
    // TSDF keys are created with floor(world/voxel), therefore each stored
    // value lives at the voxel CENTRE.  Treating it as the lower corner adds a
    // deterministic -0.5 voxel bias to the reconstructed mesh on every axis.
    const pos=corner.map(c=>[(x+c[0]+.5)*voxel,(y+c[1]+.5)*voxel,(z+c[2]+.5)*voxel]);
    for(const t of tetra){const inside=t.filter(i=>d[i]<0),outside=t.filter(i=>d[i]>=0);if(!inside.length||!outside.length)continue;const pts=[];for(const a of inside)for(const b of outside){const den=d[a]-d[b],u=Math.abs(den)<1e-8?.5:d[a]/den,pp=[pos[a][0]+(pos[b][0]-pos[a][0])*u,pos[a][1]+(pos[b][1]-pos[a][1])*u,pos[a][2]+(pos[b][2]-pos[a][2])*u],ca=vals[a]?.color||[180,200,220],cb=vals[b]?.color||ca,cc=[ca[0]+(cb[0]-ca[0])*u,ca[1]+(cb[1]-ca[1])*u,ca[2]+(cb[2]-ca[2])*u];pts.push({p:pp,c:cc});}
      if(pts.length<3)continue;if(pts.length===3){addTri(pts[0],pts[1],pts[2]);}else{addTri(pts[0],pts[1],pts[2]);if(tri<maxTriangles)addTri(pts[0],pts[2],pts[3]);}if(tri>=maxTriangles)break;
    }
    function addTri(a,b,c){const ia=vid(a),ib=vid(b),ic=vid(c);if(ia===ib||ib===ic||ia===ic)return;faces.push(ia,ib,ic);tri++;}
    function vid(v){const q=.18*voxel,key2=`${Math.round(v.p[0]/q)},${Math.round(v.p[1]/q)},${Math.round(v.p[2]/q)}`;let id=vmap.get(key2);if(id!==undefined)return id;id=vertices.length/3;vertices.push(...v.p);colors.push(...v.c.map(x=>Math.round(clamp(x,0,255))));vmap.set(key2,id);return id;}
  }
  return {voxelM:voxel,occupiedVoxels:map.size,vertices:new Float32Array(vertices),colors:new Uint8Array(colors),faces:new Uint32Array(faces)};
}

function cellOf(p,v){return [Math.floor(p[0]/v),Math.floor(p[1]/v),Math.floor(p[2]/v)];}function voxelKey(p,v){const c=cellOf(p,v);return `${c[0]},${c[1]},${c[2]}`;}function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}function clamp(v,a,b){return Math.max(a,Math.min(b,v));}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}function norm(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}function mix3(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
