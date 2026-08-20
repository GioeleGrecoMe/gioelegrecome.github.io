/**
 * Online information-form 3D Gaussian map.
 *
 * V30.25 uses the spatial hash only as an acceleration structure: Gaussian
 * centres remain continuous and several hypotheses may coexist in the same
 * cell. This is essential at corners, depth discontinuities and thin objects.
 *
 * Every observation carries two different covariances:
 *   - positionCov: uncertainty of the estimated 3D centre (Bayesian fusion);
 *   - surfaceCov: physical footprint of the rendered Gaussian (splatting).
 *
 * Feature tracks / multi-view plane sweep can arrive with evidence from several
 * Alva frames at once. A compact 64-bit Bloom-style view mask prevents the same
 * photographs from manufacturing confidence when a job is replayed, without
 * retaining image history per Gaussian. Hash collisions only under-count
 * support, which is conservative.
 */
export class SparseDenseFusion{
  constructor({
    voxel=.035,hashVoxel=null,truncation=null,maxSurfels=180000,maxTsdf=450000,minSupport=2,
    minConfirmBaseline=null,maxRaySigma=3.0,maxMahalanobis2=11.34,maxNormalAngleRad=1.25,
    tsdfMinSupport=null,tsdfMaxSurfels=70000,provisionalMaxAge=18,observationReservoir=4
  }={}){
    this.voxel=voxel;this.hashVoxel=Math.max(voxel*.28,Number(hashVoxel)||voxel*.60);this.truncation=truncation||voxel*3;
    this.maxSurfels=maxSurfels;this.maxTsdf=maxTsdf;this.minSupport=Math.max(2,minSupport|0);
    this.minConfirmBaseline=Number.isFinite(minConfirmBaseline)?Math.max(0,minConfirmBaseline):voxel*.75;
    this.maxRaySigma=Math.max(1.5,Number(maxRaySigma)||3);this.maxMahalanobis2=Math.max(6,Number(maxMahalanobis2)||11.34);
    this.minNormalDot=Math.cos(Math.max(.2,Math.min(Math.PI/2,Number(maxNormalAngleRad)||1.25)));
    this.tsdfMinSupport=Math.max(this.minSupport,tsdfMinSupport|0||this.minSupport);this.tsdfMaxSurfels=Math.max(1000,tsdfMaxSurfels|0||70000);
    this.provisionalMaxAge=Math.max(8,provisionalMaxAge|0||18);this.observationReservoir=Math.max(2,Math.min(8,observationReservoir|0||4));
    this.surfels=new Map();       // id -> Gaussian. No quantisation of centres.
    this.spatial=new Map();       // hash cell -> Set<id>, candidate lookup only.
    this.tsdf=new Map();this.nextId=1;this.frames=0;this.samplesIn=0;this.rejected=0;this.matched=0;this.created=0;this.pruned=0;this.lastMeshAtFrame=0;
  }

  integrate(samples,{origin=[0,0,0],frameId=`f${this.frames}`,mode='dense'}={}){
    this.frames++;let accepted=0,matched=0,created=0,rejected=0;
    for(const raw of samples||[]){
      if(!finite3(raw?.p)||!(raw.confidence>0)){rejected++;continue;}this.samplesIn++;
      const s=normaliseObservation(raw,origin,this.hashVoxel,mode,frameId),r=this._integrateObservation(s);
      if(r==='matched'){accepted++;matched++;}else if(r==='created'){accepted++;created++;}else rejected++;
    }
    this.matched+=matched;this.created+=created;this.rejected+=rejected;if(this.frames%8===0)this._pruneStaleProvisionals();
    return {accepted,matched,created,rejected,frames:this.frames,surfels:this.surfels.size,spatialCells:this.spatial.size,confirmed:this._confirmedCount(),pruned:this.pruned,tsdfVoxels:this.tsdf.size};
  }

  _integrateObservation(s){
    const found=this._findCompatible(s);
    if(found){this._updateSurfel(found.surfel,s,found.novelBits,found.obsBits,found.score);this._relocate(found.id,found.surfel);return 'matched';}
    if(this._sameEvidenceDuplicate(s))return 'rejected';
    if(this.surfels.size>=this.maxSurfels){this._pruneStaleProvisionals(true);if(this.surfels.size>=this.maxSurfels)return 'rejected';}
    const id=this.nextId++,a=this._newSurfel(s);this.surfels.set(id,a);a.hashKey=this._index(id,a.p);return 'created';
  }

  _findCompatible(s){
    let best=null,bestScore=Infinity;const axial=Math.min(this.hashVoxel*14,Math.max(this.hashVoxel*1.2,s.sigmaDepth*this.maxRaySigma)),seen=new Set();
    const cross=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0]];
    const obsBits=popcountPair(s.viewMaskLo,s.viewMaskHi);
    for(let off=-axial;off<=axial+1e-9;off+=this.hashVoxel){
      const q=[s.p[0]+s.ray[0]*off,s.p[1]+s.ray[1]*off,s.p[2]+s.ray[2]*off],c=cellOf(q,this.hashVoxel);
      for(const d of cross){const key=`${c[0]+d[0]},${c[1]+d[1]},${c[2]+d[2]}`,ids=this.spatial.get(key);if(!ids)continue;
        for(const id of ids){if(seen.has(id))continue;seen.add(id);const a=this.surfels.get(id);if(!a)continue;
          const novelBits=novelBitCount(a,s);if(novelBits<=0)continue;
          const score=compatibilityScore(a,s,this.hashVoxel,this.maxMahalanobis2,this.minNormalDot);if(score<bestScore){bestScore=score;best={id,surfel:a,novelBits,obsBits,score};}
        }
      }
    }
    return best;
  }

  _sameEvidenceDuplicate(s){
    const c=cellOf(s.p,this.hashVoxel);for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const ids=this.spatial.get(`${c[0]+dx},${c[1]+dy},${c[2]+dz}`);if(!ids)continue;for(const id of ids){const a=this.surfels.get(id);if(!a||novelBitCount(a,s)>0)continue;
        const d=Math.hypot(...sub(a.p,s.p)),limit=Math.max(this.hashVoxel*.30,Math.min(a.radius,s.radius)*.55);if(d>limit)continue;
        if(a.normalReliable&&s.normalReliable&&Math.abs(dot(a.n,s.n))<.82)continue;return true;
      }
    }return false;
  }

  _newSurfel(s){
    const support=Math.max(1,popcountPair(s.viewMaskLo,s.viewMaskHi));return {
      p:[...s.p],positionCov:[...s.cov],surfaceCov:[...s.surfaceCov],n:[...s.n],normalReliable:s.normalReliable,color:[...s.color],descriptor:s.descriptor?.slice()||null,
      radius:s.radius,confidence:s.confidence,weight:s.weight,sigmaDepth:s.sigmaDepth,sigmaLateral:s.sigmaLateral,support,observations:1,
      viewMaskLo:s.viewMaskLo,viewMaskHi:s.viewMaskHi,firstOrigin:[...s.origin],lastOrigin:[...s.origin],firstRay:[...s.ray],maxBaseline:0,maxViewAngle:0,lastSeenFrame:this.frames,
      deepWeight:s.sourceKind==='deep'?s.weight:0,verifiedWeight:s.sourceKind==='verified'?s.weight:0,trackWeight:s.sourceKind==='track'?s.weight:0,
      sourceMask:s.sourceKind==='deep'?1:(s.sourceKind==='verified'?2:4),anchorSupport:s.anchorSupport||0,geometricSupport:s.geometricSupport||0,trackHits:s.trackId?1:0,colorM2:[0,0,0],
      // Keep only a tiny, view-diverse reservoir.  These rays are the compact
      // sufficient data used by the post-scan batch optimiser; image history
      // itself is still discarded.
      optObservations:[compactOptimObservation(s)]
    };
  }

  _updateSurfel(a,s,novelBits,obsBits,score){
    const overlapFraction=1-clamp(novelBits/Math.max(1,obsBits),0,1),baseline=Math.hypot(...sub(s.origin,a.lastOrigin)),viewAngle=Math.acos(clamp(dot(a.firstRay,s.ray),-1,1));
    // Adjacent monocular frames have correlated Deep errors. Novel camera motion
    // controls how much new information is allowed to shrink the covariance.
    const motionNovelty=clamp(Math.max(baseline/Math.max(this.hashVoxel*1.6,.018),viewAngle/.075),s.sourceKind==='deep'?.16:.35,1);
    const robustPenalty=score>4?Math.min(3,1+(score-4)*.18):1,correlationInflation=(1+2.4*overlapFraction)*robustPenalty/Math.max(.12,motionNovelty);
    const measCov=scaleCov(s.cov,correlationInflation),fused=fuseGaussian3(a.p,a.positionCov,s.p,measCov,Math.max(1e-6,this.hashVoxel*.015));
    const oldW=Math.max(.02,a.weight),effectiveW=Math.max(.02,s.weight*clamp(novelBits/Math.max(1,obsBits),.10,1)*motionNovelty),nw=Math.min(1e5,oldW+effectiveW);
    if(fused){a.p=fused.mean;a.positionCov=fused.cov;}else a.p=mix3(a.p,s.p,effectiveW/nw);
    a.sigmaDepth=Math.max(this.hashVoxel*.06,projectSigma(a.positionCov,s.ray));a.sigmaLateral=Math.max(this.hashVoxel*.05,Math.sqrt(Math.max(1e-12,(traceCov(a.positionCov)-a.sigmaDepth*a.sigmaDepth)/2)));

    if(s.normalReliable&&!a.normalReliable){a.n=[...s.n];a.surfaceCov=[...s.surfaceCov];a.normalReliable=true;}
    else{
      let n=s.n;if(dot(a.n,n)<0)n=n.map(v=>-v);const t=Math.min(.42,effectiveW/nw);if(s.normalReliable||!a.normalReliable)a.n=norm(mix3(a.n,n,t));
      // Surface extent is not statistical uncertainty: average its covariance
      // instead of multiplying precisions, otherwise a well-observed wall would
      // collapse to point-sized splats.
      a.surfaceCov=mixCov(a.surfaceCov,s.surfaceCov,Math.min(.34,effectiveW/nw));
    }
    const oldColor=[...a.color],ct=Math.min(.35,effectiveW/nw);a.color=mix3(a.color,s.color,ct);a.radius=(a.radius*oldW+s.radius*effectiveW)/nw;
    for(let k=0;k<3;k++){const delta=s.color[k]-oldColor[k];a.colorM2[k]=(a.colorM2[k]||0)+effectiveW*delta*(s.color[k]-a.color[k]);}
    a.descriptor=mergeDescriptor(a.descriptor,s.descriptor,Math.min(.25,effectiveW/nw));a.confidence=Math.min(1,(a.confidence*oldW+s.confidence*effectiveW)/nw);a.weight=nw;a.observations++;a.lastSeenFrame=this.frames;
    if(s.sourceKind==='deep'){a.deepWeight+=effectiveW;a.sourceMask|=1;}else if(s.sourceKind==='verified'){a.verifiedWeight+=effectiveW;a.sourceMask|=2;}else{a.trackWeight+=effectiveW;a.sourceMask|=4;}
    a.anchorSupport=Math.max(a.anchorSupport||0,s.anchorSupport||0);a.geometricSupport=Math.max(a.geometricSupport||0,s.geometricSupport||0);if(s.trackId)a.trackHits++;
    a.viewMaskLo=(a.viewMaskLo|s.viewMaskLo)>>>0;a.viewMaskHi=(a.viewMaskHi|s.viewMaskHi)>>>0;a.support=popcountPair(a.viewMaskLo,a.viewMaskHi);
    a.lastOrigin=[...s.origin];a.maxBaseline=Math.max(a.maxBaseline,Math.hypot(...sub(s.origin,a.firstOrigin)));a.maxViewAngle=Math.max(a.maxViewAngle,viewAngle);
    this._rememberOptimObservation(a,s);
  }

  _rememberOptimObservation(a,s){
    const item=compactOptimObservation(s),list=a.optObservations||(a.optObservations=[]);
    // Same/near-identical camera centres add almost no independent geometric
    // information. Replace the weakest nearby sample instead of growing history.
    let near=-1,nearD=Infinity;for(let i=0;i<list.length;i++){const d=Math.hypot(...sub(list[i].origin,item.origin));if(d<nearD){nearD=d;near=i;}}
    const duplicateGate=Math.max(this.hashVoxel*.45,Math.min(.03,a.radius*1.5));
    if(near>=0&&nearD<duplicateGate){if(item.confidence>(list[near].confidence||0))list[near]=item;return;}
    if(list.length<this.observationReservoir){list.push(item);return;}
    // Bounded farthest-point reservoir: preserve angular/baseline diversity,
    // because those observations most strongly condition depth along the ray.
    let replace=0,worst=Infinity;for(let i=0;i<list.length;i++){let sep=Infinity;for(let j=0;j<list.length;j++){if(i===j)continue;sep=Math.min(sep,Math.hypot(...sub(list[i].origin,list[j].origin)));}const quality=sep*(.45+.55*(list[i].confidence||.1));if(quality<worst){worst=quality;replace=i;}}
    let newSep=Infinity;for(const old of list)newSep=Math.min(newSep,Math.hypot(...sub(old.origin,item.origin)));const newQuality=newSep*(.45+.55*item.confidence);if(newQuality>worst*1.02)list[replace]=item;
  }

    _index(id,p){const key=voxelKey(p,this.hashVoxel);let ids=this.spatial.get(key);if(!ids)this.spatial.set(key,ids=new Set());ids.add(id);return key;}
  _unindex(id,key){const ids=this.spatial.get(key);if(!ids)return;ids.delete(id);if(!ids.size)this.spatial.delete(key);}
  _relocate(id,s){const old=s.hashKey||null,next=voxelKey(s.p,this.hashVoxel);if(!old){s.hashKey=next;const ids=this.spatial.get(next);if(!ids?.has(id))this._index(id,s.p);return;}if(old===next)return;this._unindex(id,old);this._index(id,s.p);s.hashKey=next;}
  _delete(id,s){this._unindex(id,s.hashKey||voxelKey(s.p,this.hashVoxel));this.surfels.delete(id);this.pruned++;}
  _pruneStaleProvisionals(force=false){
    const cutoff=this.frames-(force?Math.max(5,this.provisionalMaxAge>>1):this.provisionalMaxAge),victims=[];for(const [id,s] of this.surfels){if(this._isConfirmed(s)||s.lastSeenFrame>cutoff)continue;victims.push([id,s]);}
    victims.sort((a,b)=>surfaceRank(a[1])-surfaceRank(b[1]));const max=force?Math.max(1,Math.ceil(victims.length*.35)):victims.length;for(let i=0;i<Math.min(max,victims.length);i++)this._delete(victims[i][0],victims[i][1]);
  }

  _isConfirmed(s){
    if(s.support<this.minSupport||s.confidence<.10)return false;
    const hasTrueMultiView=(s.geometricSupport>=2)||s.maxBaseline>=this.minConfirmBaseline||s.maxViewAngle>=.025;if(!hasTrueMultiView)return false;
    const rms=Math.sqrt(Math.max(0,traceCov(s.positionCov)/3)),limit=Math.max(this.hashVoxel*2.4,s.radius*4.0)*((s.sourceMask&6)?1.7:1);return rms<=limit;
  }
  _confirmedCount(){let n=0;for(const s of this.surfels.values())if(this._isConfirmed(s))n++;return n;}
  confirmedSurfels({max=50000}={}){const arr=[];for(const s of this.surfels.values())if(this._isConfirmed(s))arr.push(s);arr.sort((a,b)=>surfaceRank(b)-surfaceRank(a));return arr.slice(0,max);}

  _splatOf(s,id=null){
    const n=norm(s.n),[t1,t2]=tangentBasis(n),positionSigma=Math.sqrt(Math.max(1e-12,traceCov(s.positionCov)/3));
    let cov=regularizeCov(s.surfaceCov,Math.max(.0006,this.hashVoxel*.015));
    // Keep the physical Gaussian thin along the estimated normal, but never
    // thinner than residual centre uncertainty. Tangential axes are read from
    // the actual 3D covariance, not an axis-aligned radius approximation.
    const normalVar=quadPacked(cov,n),wanted=Math.max(.0008**2,Math.min((s.radius*.34)**2,(positionSigma*.55+this.hashVoxel*.025)**2));if(normalVar<wanted)cov=addCov(cov,scaleCov(outerPacked(n),wanted-normalVar));
    const scale=[Math.sqrt(Math.max(1e-12,quadPacked(cov,t1))),Math.sqrt(Math.max(1e-12,quadPacked(cov,t2))),Math.sqrt(Math.max(1e-12,quadPacked(cov,n)))],mixed=(s.sourceMask&3)===3;
    return {id:id??undefined,position:s.p,normal:n,color:s.color.map(v=>Math.round(clamp(v,0,255))),scale,covariance:cov,positionCovariance:[...s.positionCov],basis:[t1,t2,n],opacity:clamp(.12+.075*Math.min(6,s.support)+.38*s.confidence+(mixed?.06:0)+Math.min(.10,(s.anchorSupport||0)*.025),.18,.96),confidence:s.confidence,support:s.support,observations:s.observations,maxBaseline:s.maxBaseline,positionSigma,anchorSupport:s.anchorSupport||0,geometricSupport:s.geometricSupport||0,mixedEvidence:mixed};
  }
  splats(opts={}){return this.confirmedSurfels(opts).map(s=>this._splatOf(s));}

  /**
   * Export a compact, reloadable post-processing snapshot.  The spatial hash
   * and TSDF are intentionally omitted because both are derived data.  Gaussian
   * order and observation offsets are kept aligned so IndexedDB can restore a
   * post-scan optimisation job without saving source photographs.
   */
  exportPersistentState({maxSurfels=90000,maxObservationsPerSurfel=this.observationReservoir}={}){
    const entries=[];for(const [id,s] of this.surfels)if(this._isConfirmed(s))entries.push([id,s]);entries.sort((a,b)=>surfaceRank(b[1])-surfaceRank(a[1]));if(entries.length>maxSurfels)entries.length=maxSurfels;
    const gaussians=[],offsets=new Uint32Array(entries.length+1),rows=[];let obsCount=0;
    for(let i=0;i<entries.length;i++){const [id,s]=entries[i];gaussians.push(this._splatOf(s,id));offsets[i]=obsCount;const list=(s.optObservations||[]).slice(0,maxObservationsPerSurfel);for(const o of list){rows.push(...o.origin,...o.p,...o.covariance,o.confidence);obsCount++;}}offsets[entries.length]=obsCount;
    return {format:'ROOMSCAN-GS-OPT-1',version:1,voxel:this.voxel,hashVoxel:this.hashVoxel,frames:this.frames,stats:{surfels:this.surfels.size,confirmed:entries.length,samplesIn:this.samplesIn,rejected:this.rejected,matched:this.matched,created:this.created,pruned:this.pruned},gaussians,observations:{stride:13,count:obsCount,offsets,data:new Float32Array(rows)}};
  }

  mesh({maxTriangles=90000,maxSurfels=this.tsdfMaxSurfels}={}){this.tsdf=this._buildTsdfFromConsensus(maxSurfels);this.lastMeshAtFrame=this.frames;return extractTsdfMesh(this.tsdf,this.voxel,maxTriangles);}
  _buildTsdfFromConsensus(maxSurfels=this.tsdfMaxSurfels){
    const map=new Map(),surfels=this.confirmedSurfels({max:Math.max(1000,Math.min(this.tsdfMaxSurfels,maxSurfels|0||this.tsdfMaxSurfels))});
    for(const s of surfels){if(s.support<this.tsdfMinSupport&&s.geometricSupport<3)continue;const n=norm(s.n),positionSigma=Math.sqrt(Math.max(1e-12,traceCov(s.positionCov)/3)),tr=Math.max(this.truncation,positionSigma*2.2,s.radius*1.6),step=this.voxel,[t1,t2]=tangentBasis(n),r1=Math.min(this.voxel*1.35,Math.max(this.voxel*.30,Math.sqrt(Math.max(1e-12,quadPacked(s.surfaceCov,t1)))*1.15)),r2=Math.min(this.voxel*1.35,Math.max(this.voxel*.30,Math.sqrt(Math.max(1e-12,quadPacked(s.surfaceCov,t2)))*1.15)),offsets=[[0,0],[r1,0],[-r1,0],[0,r2],[0,-r2]];
      for(const [aa,bb] of offsets){const base=[s.p[0]+t1[0]*aa+t2[0]*bb,s.p[1]+t1[1]*aa+t2[1]*bb,s.p[2]+t1[2]*aa+t2[2]*bb];for(let off=-tr;off<=tr+1e-9;off+=step){if(map.size>=this.maxTsdf)break;const q=[base[0]+n[0]*off,base[1]+n[1]*off,base[2]+n[2]*off],key=voxelKey(q,this.voxel),sd=clamp(off/tr,-1,1),old=map.get(key),supportGain=Math.min(1,Math.max(0,(s.support-this.tsdfMinSupport+1)/3)),uncertaintyGain=clamp(this.hashVoxel/Math.max(this.hashVoxel,positionSigma),.25,1),w=Math.max(.04,s.confidence*(.60+.40*supportGain)*uncertaintyGain*(1-.32*Math.abs(sd)));if(old){const nw=old.w+w;old.d=(old.d*old.w+sd*w)/nw;old.w=Math.min(255,nw);if(Math.abs(sd)<.45)old.color=mix3(old.color,s.color,w/nw);}else map.set(key,{d:sd,w,color:[...s.color]});}if(map.size>=this.maxTsdf)break;}if(map.size>=this.maxTsdf)break;
    }return map;
  }
}

function compactOptimObservation(s){return {origin:s.origin.slice(0,3),p:s.p.slice(0,3),covariance:s.cov.slice(0,6),confidence:clamp(Number(s.confidence)||.15,.02,1)};}

function normaliseObservation(s,origin,hashVoxel,mode,frameId){
  const p=s.p.slice(0,3).map(Number),o=finite3(origin)?origin.slice(0,3).map(Number):[0,0,0],v=sub(p,o),depth=Number.isFinite(s.depth)&&s.depth>0?s.depth:Math.hypot(...v),ray=norm(v),radius=Math.max(hashVoxel*.08,Number(s.radius)||hashVoxel*.48),source=s.source||(/deep/i.test(mode)?'deep-proxy':'proxy-verified');
  let n=finite3(s.normal)?norm(s.normal):ray.map(x=>-x);if(dot(n,ray)>0)n=n.map(x=>-x);const normalReliable=s.normalReliable!==false;
  const sigmaLateral=Math.max(hashVoxel*.04,Number(s.sigmaLateral)||radius*.72),defaultRel=/deep/i.test(source)?.10:.022,sigmaDepth=Math.max(hashVoxel*.05,Number(s.sigmaDepth)||Math.max(radius*1.1,depth*defaultRel));
  const cov=validCov(s.covariance)?regularizeCov(s.covariance,hashVoxel*.012):rayCovariance(ray,sigmaDepth,sigmaLateral),surfaceCov=validCov(s.surfaceCovariance)?regularizeCov(s.surfaceCovariance,hashVoxel*.006):surfaceFromRadius(n,radius,normalReliable),confidence=clamp(Number(s.confidence)||.15,.02,1);
  const sourceKind=/track/i.test(source)?'track':(/verified|mvs/i.test(source)?'verified':'deep'),sourceWeight=sourceKind==='deep'?.42:(sourceKind==='track'?1.18:1),precision=1/Math.max(1e-9,traceCov(cov)),weight=clamp(confidence*sourceWeight*precision*hashVoxel*hashVoxel,.02,5.0),evidence=Array.isArray(s.evidenceFrames)&&s.evidenceFrames.length?s.evidenceFrames:[frameId],mask=evidenceMask(evidence);
  return {p,origin:o,ray,depth,n,normalReliable,color:(s.color||[180,200,220]).slice(0,3).map(Number),descriptor:Array.isArray(s.descriptor)?s.descriptor.slice(0,24).map(Number):null,radius,confidence,sigmaDepth,sigmaLateral,cov,surfaceCov,source,sourceKind,weight,anchorSupport:Math.max(0,Number(s.anchorSupport)||0),trackId:s.trackId||null,geometricSupport:Math.max(Number(s.viewSupport)||0,evidence.length),viewMaskLo:mask[0],viewMaskHi:mask[1]};
}

function compatibilityScore(a,s,hashVoxel,maxMahalanobis2,minNormalDot){
  const euclid=Math.hypot(...sub(a.p,s.p)),rough=Math.max(hashVoxel*2.4,3.5*Math.sqrt(Math.max(1e-12,traceCov(addCov(a.positionCov,s.cov)))));if(euclid>rough)return Infinity;
  const nd=Math.abs(dot(a.n,s.n));if(a.normalReliable&&s.normalReliable&&nd<minNormalDot)return Infinity;
  const inv=invertSym3(addCov(a.positionCov,s.cov));if(!inv)return Infinity;const d=sub(a.p,s.p),m2=quadPacked(inv,d);if(!Number.isFinite(m2)||m2>maxMahalanobis2)return Infinity;
  const desc=descriptorDistance(a.descriptor,s.descriptor);if(Number.isFinite(desc)&&desc>1.35)return Infinity;const cd=Math.hypot(a.color[0]-s.color[0],a.color[1]-s.color[1],a.color[2]-s.color[2])/441.673;
  return m2+(a.normalReliable&&s.normalReliable ? .28*(1-nd) : .04*(1-nd))+.14*cd*cd+(Number.isFinite(desc) ? .16*desc*desc : 0);
}
function fuseGaussian3(m1,c1,m2,c2,jitter=1e-6){
  const p1=invertSym3(c1),p2=invertSym3(c2);if(!p1||!p2)return null;
  const info=addCov(p1,p2),cov=invertSym3(info);if(!cov)return null;
  const h1=mulPackedVec(p1,m1),h2=mulPackedVec(p2,m2),mean=mulPackedVec(cov,[h1[0]+h2[0],h1[1]+h2[1],h1[2]+h2[2]]);
  return finite3(mean)?{mean,cov:regularizeCov(cov,jitter)}:null;
}
function descriptorDistance(a,b){if(!a?.length||a.length!==b?.length)return NaN;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let sa=0,sb=0;for(let i=0;i<a.length;i++){sa+=(a[i]-ma)**2;sb+=(b[i]-mb)**2;}sa=Math.sqrt(sa/a.length)||1;sb=Math.sqrt(sb/b.length)||1;let d=0;for(let i=0;i<a.length;i++)d+=Math.abs((a[i]-ma)/sa-(b[i]-mb)/sb);return d/a.length;}
function mergeDescriptor(a,b,t){if(!b?.length)return a;if(!a?.length||a.length!==b.length)return b.slice();return a.map((x,i)=>x+(b[i]-x)*t);}
function evidenceMask(xs){let lo=0,hi=0;for(const x of xs||[]){const h=hash32(String(x)),bit=h&63;if(bit<32)lo=(lo|(1<<bit))>>>0;else hi=(hi|(1<<(bit-32)))>>>0;}return [lo>>>0,hi>>>0];}
function novelBitCount(a,s){return popcount32((s.viewMaskLo&~a.viewMaskLo)>>>0)+popcount32((s.viewMaskHi&~a.viewMaskHi)>>>0);}
function popcountPair(lo,hi){return popcount32(lo>>>0)+popcount32(hi>>>0);}function popcount32(x){x=x-((x>>>1)&0x55555555);x=(x&0x33333333)+((x>>>2)&0x33333333);return (((x+(x>>>4))&0x0F0F0F0F)*0x01010101)>>>24;}
function hash32(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;return h>>>0;}
function rayCovariance(ray,sd,sl){const r=norm(ray),sd2=Math.max(1e-12,sd*sd),sl2=Math.max(1e-12,sl*sl),d=sd2-sl2;return [sl2+d*r[0]*r[0],d*r[0]*r[1],d*r[0]*r[2],sl2+d*r[1]*r[1],d*r[1]*r[2],sl2+d*r[2]*r[2]];}
function surfaceFromRadius(n,r,reliable){if(!reliable)return isotropicCov(Math.max(.0015,r*.55));const [t1,t2]=tangentBasis(n),sn=Math.max(.0008,r*.16);return addCov(addCov(scaleCov(outerPacked(t1),r*r),scaleCov(outerPacked(t2),r*r)),scaleCov(outerPacked(n),sn*sn));}
function isotropicCov(s){const q=s*s;return [q,0,0,q,0,q];}function outerPacked(v){return [v[0]*v[0],v[0]*v[1],v[0]*v[2],v[1]*v[1],v[1]*v[2],v[2]*v[2]];}
function validCov(c){return Array.isArray(c)&&c.length>=6&&c.slice(0,6).every(Number.isFinite)&&c[0]>0&&c[3]>0&&c[5]>0;}function regularizeCov(c,j){const q=c.slice(0,6).map(Number),e=Math.max(1e-14,j*j);q[0]+=e;q[3]+=e;q[5]+=e;return q;}function addCov(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2],a[3]+b[3],a[4]+b[4],a[5]+b[5]];}function scaleCov(a,s){return a.map(x=>x*s);}function mixCov(a,b,t){return a.map((x,i)=>x+(b[i]-x)*t);}function traceCov(c){return c[0]+c[3]+c[5];}
function quadPacked(c,v){return v[0]*(c[0]*v[0]+c[1]*v[1]+c[2]*v[2])+v[1]*(c[1]*v[0]+c[3]*v[1]+c[4]*v[2])+v[2]*(c[2]*v[0]+c[4]*v[1]+c[5]*v[2]);}function mulPackedVec(c,v){return [c[0]*v[0]+c[1]*v[1]+c[2]*v[2],c[1]*v[0]+c[3]*v[1]+c[4]*v[2],c[2]*v[0]+c[4]*v[1]+c[5]*v[2]];}
function invertSym3(c){const a=c[0],b=c[1],cc=c[2],d=c[3],e=c[4],f=c[5],A=d*f-e*e,B=cc*e-b*f,C=b*e-cc*d,D=a*f-cc*cc,E=b*cc-a*e,F=a*d-b*b,det=a*A+b*B+cc*C;if(!Number.isFinite(det)||Math.abs(det)<1e-22)return null;const s=1/det;return [A*s,B*s,C*s,D*s,E*s,F*s];}
function projectSigma(c,dir){return Math.sqrt(Math.max(1e-12,quadPacked(c,norm(dir))));}function surfaceRank(s){const pos=Math.sqrt(Math.max(1e-12,traceCov(s.positionCov)/3)),verified=(s.sourceMask&6)?1:0;return 2.4*s.support+1.25*s.confidence+.75*verified+.30*Math.min(4,(s.anchorSupport||0))+.35*Math.min(1,s.maxBaseline/(pos+1e-6))-.18*Math.min(4,pos/Math.max(.002,s.radius));}
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
