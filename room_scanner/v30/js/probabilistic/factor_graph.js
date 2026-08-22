/**
 * Compact probabilistic evidence graph persisted by Room Scanner V30.29.
 *
 * The graph deliberately stores measurements, priors and provenance instead of
 * only the current 3D answer. Post-scan processing can therefore revisit pose,
 * association, Deep scale and surface estimates without needing all video frames.
 */
import {canonicalizePhotoEdgeMatches} from './rgb_translation_direction.js?v=30.54.0';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class ProbabilisticFactorGraph{
  constructor({maxFrames=360,maxFeaturesPerFrame=360,grayMaxSide=120,photoMaxSide=128,deepGridCols=32,deepGridRows=48,mvsPerFrame=420,maxLandmarks=18000}={}){
    Object.assign(this,{maxFrames,maxFeaturesPerFrame,grayMaxSide,photoMaxSide,deepGridCols,deepGridRows,mvsPerFrame,maxLandmarks});
    this.frames=[];this.frameIndex=new Map();this.landmarkFactors=[];this.deepFactors=[];this.mvsFactors=[];this.edgeFactors=[];this.alvaFactors=[];this.measurementIndex=new Map();this.cameraModel=null;this.photoEdgeAudit={inputEdges:0,importedEdges:0,unresolvedEdges:0,importFraction:1,asStoredMatchEdges:0,swappedMatchEdges:0,ambiguousMatchEdges:0};this.version=8;this.createdAt=Date.now();
  }
  addFrame(frame){
    if(!frame?.frameId||!frame?.pose||!frame?.K)return null;const id=String(frame.frameId),old=this.frameIndex.get(id);if(old!=null)return this.frames[old];
    const thumb=downsampleGray(frame.gray,frame.width,frame.height,this.grayMaxSide),features=(frame.features||[]).slice(0,this.maxFeaturesPerFrame).map((f,index)=>({index,x:+f.x,y:+f.y,score:+(f.score||0),source:f.source||'mvs',desc:Array.isArray(f.desc)?f.desc.slice(0,24).map(Number):[],referenceDesc:Array.isArray(f.referenceDesc)?f.referenceDesc.slice(0,24).map(Number):(Array.isArray(f.desc)?f.desc.slice(0,24).map(Number):[])})),photo=downsamplePhoto(frame,this.photoMaxSide,features);
    const observedK={fx:+frame.K.fx,fy:+frame.K.fy,cx:+frame.K.cx,cy:+frame.K.cy,width:+(frame.K.width||frame.width),height:+(frame.K.height||frame.height)};if(!this.cameraModel)this.cameraModel=makeCameraModel(observedK,frame.D||frame.distortion||null);const sessionK=scaledCameraK(this.cameraModel,observedK.width,observedK.height),intrinsicsDeviation=intrinsicDeviation(observedK,sessionK);
    const node={id,frameId:id,keyframeId:frame.id||id,at:+(frame.captureAt??frame.at??0),posePrior:clonePose(frame.pose),poseEstimate:clonePose(frame.pose),poseCov:clonePoseCov(frame.poseCov),K:sessionK,KObserved:observedK,intrinsicsDeviation,D:Array.isArray(this.cameraModel?.D)?this.cameraModel.D.slice():null,width:frame.width|0,height:frame.height|0,grayWidth:thumb.width,grayHeight:thumb.height,gray:thumb.gray,features,photo,metricLocked:!!frame.metricLocked,trackingMode:frame.trackingMode||null,alvaPoseAuthority:frame.alvaPoseAuthority!==false,photoQuality:compactPhotoQuality(frame.photoQuality)};
    const prev=this.frames[this.frames.length-1]||null;this.frameIndex.set(id,this.frames.length);this.frames.push(node);if(prev?.posePrior&&node.posePrior&&prev.alvaPoseAuthority!==false&&node.alvaPoseAuthority!==false)this.addAlvaRelativeFactor(prev,node);while(this.frames.length>this.maxFrames){this.frames.shift();this.reindex();this.pruneOrphans();}return node;
  }
  addSparseAnchors(ref,seeds){
    const refId=String(ref?.frameId||ref?.id||'');if(!refId)return;
    for(const s of seeds||[]){
      if(!Array.isArray(s.p)||!s.measurements?.length)continue;
      const candidate={id:s.trackId||`${refId}:L${this.landmarkFactors.length}`,refFrameId:refId,point:Array.from(s.p.slice(0,3),Number),covariance:cov6(s.covariance),probability:clamp(Number(s.geometryProbability??s.confidence??.1),.001,.999),relativeDepthSigma:Number(s.relativeDepthSigma??(s.sigmaDepth/Math.max(.05,s.depth))??.3),depth:+s.depth,calibrationWeight:+(s.calibrationWeight||0),descriptor:Array.isArray(s.referenceDesc||s.descriptor)?Array.from(s.referenceDesc||s.descriptor).slice(0,24).map(Number):[],measurements:s.measurements.map(m=>({frameId:String(m.frameId),u:+m.u,v:+m.v,probability:clamp(Number(m.probability??.1),.001,.999),epipolarPx:m.epipolarPx==null?null:+m.epipolarPx,zncc:m.zncc==null?null:+m.zncc})),sourceIds:(s.sourceIds||[]).map(String)};
      const existing=this.findLandmarkByMeasurement(candidate.measurements);
      if(existing>=0){mergeLandmarkFactor(this.landmarkFactors[existing],candidate);this.indexLandmark(existing,this.landmarkFactors[existing]);}
      else{const idx=this.landmarkFactors.length;this.landmarkFactors.push(candidate);this.indexLandmark(idx,candidate);}
    }
    const max=Math.max(1000,this.maxLandmarks);if(this.landmarkFactors.length>max){this.landmarkFactors.splice(0,this.landmarkFactors.length-max);this.rebuildMeasurementIndex();}
  }
  addDeepRaw(frameId,{rawDepth,rawWidth,rawHeight,calibration=null,quality=null}={}){
    if(!rawDepth?.length||!(rawWidth>1&&rawHeight>1))return;const id=String(frameId),grid=sampleGrid(rawDepth,rawWidth,rawHeight,this.deepGridCols,this.deepGridRows),item={frameId:id,cols:this.deepGridCols,rows:this.deepGridRows,raw:grid,rawWidth,rawHeight,calibration:calibration?compactCalibration(calibration):null,quality:quality?compactQuality(quality):null};
    const i=this.deepFactors.findIndex(x=>String(x.frameId)===id);if(i>=0)this.deepFactors[i]={...this.deepFactors[i],...item,calibration:item.calibration||this.deepFactors[i].calibration};else this.deepFactors.push(item);trim(this.deepFactors,this.maxFrames);
  }

  /**
   * Attach a post-scan visual-PnP hypothesis to existing sparse landmarks.
   * It creates reprojection evidence only.  In particular it never fabricates
   * an Alva relative-pose factor, so a bad recovery cannot bend the tracked
   * Alva trajectory merely by being adjacent in capture time.
   */
  addReferenceRelocalization(frameId,{observations=[]}={}){
    const fid=String(frameId||'');if(!fid||!this.frameIndex.has(fid))return {attached:0,reason:'frame-missing'};
    const byId=new Map(this.landmarkFactors.map((l,i)=>[String(l.id||''),{l,i}]));let attached=0;
    for(const o of observations||[]){const hit=byId.get(String(o?.landmarkId||''));if(!hit||!Number.isFinite(+o?.u)||!Number.isFinite(+o?.v))continue;const l=hit.l,old=(l.measurements||[]).find(m=>String(m.frameId)===fid&&Math.hypot((+m.u)-(+o.u),(+m.v)-(+o.v))<2.5);if(old){old.probability=Math.max(Number(old.probability)||.001,clamp(Number(o.probability)||.15,.001,.999));continue;}l.measurements.push({frameId:fid,u:+o.u,v:+o.v,probability:clamp(Number(o.probability)||.15,.001,.999),epipolarPx:null,zncc:null,recoveryPnP:true});this.indexLandmark(hit.i,l);attached++;}
    return {attached,reason:attached?'ok':'no-matching-landmarks'};
  }

  addPhotoEdges(edges){
    const input=Array.isArray(edges)?edges:[],live=new Set(this.frames.map(f=>String(f.frameId))),fm=new Map(this.frames.map(f=>[String(f.frameId),f])),oldByPair=new Map((this.edgeFactors||[]).map(x=>[photoPairKey(x.aId,x.bId),x])),out=[];let unresolved=0,asStoredMatchEdges=0,swappedMatchEdges=0,ambiguousMatchEdges=0,scoreGain=0,scoreGainN=0;
    for(const e of input){
      const aId=resolvePhotoFrameId(e,'a',this.frames),bId=resolvePhotoFrameId(e,'b',this.frames);if(!aId||!bId||aId===bId||!live.has(aId)||!live.has(bId)){unresolved++;continue;}
      const raw={aId,bId,loop:!!e.loop,visualConfidence:clamp(Number(e.visualConfidence??e.weight??.1),.001,.999),rotationBToA:Array.isArray(e.rotationBToA)&&e.rotationBToA.length===9?e.rotationBToA.slice(0,9).map(Number):null,matches:(e.matches||[]).slice(0,180).map(m=>({aU:+m.aU,aV:+m.aV,bU:+m.bU,bV:+m.bV,probability:clamp(Number(m.probability??.1),.001,.999),photometricProbability:m.photometricProbability==null?null:+m.photometricProbability}))};
      const prior=oldByPair.get(photoPairKey(aId,bId));let c;
      if(raw.rotationBToA&&prior?.sourceMatchConvention==='swapped-input')c={edge:{...raw,matches:raw.matches.map(m=>({ ...m,aU:m.bU,aV:m.bV,bU:m.aU,bV:m.aV})),matchConvention:'canonical-a-b',sourceMatchConvention:'swapped-input',matchConventionAmbiguous:false,matchConventionScoreGain:prior.matchConventionScoreGain??null,matchConventionResidualDeg:prior.matchConventionResidualDeg??null},convention:'swapped-input',ambiguous:false};
      else if(raw.rotationBToA&&prior?.sourceMatchConvention==='as-stored')c={edge:{...raw,matchConvention:'canonical-a-b',sourceMatchConvention:'as-stored',matchConventionAmbiguous:false,matchConventionScoreGain:prior.matchConventionScoreGain??null,matchConventionResidualDeg:prior.matchConventionResidualDeg??null},convention:'as-stored',ambiguous:false};
      else c=raw.rotationBToA?canonicalizePhotoEdgeMatches(raw,fm.get(aId),fm.get(bId)): {edge:raw,convention:'unresolved',ambiguous:true};
      if(c.convention==='swapped-input')swappedMatchEdges++;else if(c.convention==='as-stored'||c.convention==='canonical-a-b')asStoredMatchEdges++;else ambiguousMatchEdges++;
      if(Number.isFinite(c.edge?.matchConventionScoreGain)){scoreGain+=Number(c.edge.matchConventionScoreGain);scoreGainN++;}
      out.push(c.edge||raw);
    }
    this.edgeFactors=out;this.photoEdgeAudit={inputEdges:input.length,importedEdges:out.length,unresolvedEdges:unresolved,importFraction:input.length?out.length/input.length:1,asStoredMatchEdges,swappedMatchEdges,ambiguousMatchEdges,meanMatchConventionScoreGain:scoreGainN?scoreGain/scoreGainN:null,matchConventionCanonicalized:true};return out.length;
  }

  canonicalizeLegacyPhotoEdges(){
    if(!this.edgeFactors?.length)return this.photoEdgeAudit;const fm=new Map(this.frames.map(f=>[String(f.frameId),f]));let asStoredMatchEdges=0,swappedMatchEdges=0,ambiguousMatchEdges=0,scoreGain=0,scoreGainN=0;
    this.edgeFactors=this.edgeFactors.map(e=>{if(e?.matchConvention==='canonical-a-b'){if(e.sourceMatchConvention==='swapped-input')swappedMatchEdges++;else asStoredMatchEdges++;return e;}const aId=String(e.aId??e.a??''),bId=String(e.bId??e.b??''),c=Array.isArray(e.rotationBToA)?canonicalizePhotoEdgeMatches(e,fm.get(aId),fm.get(bId)):{edge:e,convention:'unresolved',ambiguous:true};if(c.convention==='swapped-input')swappedMatchEdges++;else if(c.convention==='as-stored'||c.convention==='canonical-a-b')asStoredMatchEdges++;else ambiguousMatchEdges++;if(Number.isFinite(c.edge?.matchConventionScoreGain)){scoreGain+=Number(c.edge.matchConventionScoreGain);scoreGainN++;}return c.edge||e;});
    const a=this.photoEdgeAudit||{};this.photoEdgeAudit={...a,inputEdges:Number(a.inputEdges)||this.edgeFactors.length,importedEdges:this.edgeFactors.length,unresolvedEdges:Number(a.unresolvedEdges)||0,importFraction:Number.isFinite(+a.importFraction)?+a.importFraction:1,asStoredMatchEdges,swappedMatchEdges,ambiguousMatchEdges,meanMatchConventionScoreGain:scoreGainN?scoreGain/scoreGainN:null,matchConventionCanonicalized:true};return this.photoEdgeAudit;
  }

  addAlvaRelativeFactor(a,b){
    if(!a?.posePrior||!b?.posePrior)return null;const aId=String(a.frameId),bId=String(b.frameId);if(!aId||!bId||aId===bId)return null;const dp=[b.posePrior.p[0]-a.posePrior.p[0],b.posePrior.p[1]-a.posePrior.p[1],b.posePrior.p[2]-a.posePrior.p[2]],qinv=qConjLocal(a.posePrior.q),p=qRotateLocal(qinv,dp),q=qMulLocal(qinv,b.posePrior.q),priorConfidence=alvaPriorConfidence(a,b),item={aId,bId,relativePose:{p,q:qNormalizeLocal(q)},priorConfidence,translationSwitch:priorConfidence,rotationSwitch:priorConfidence,switchInitializedFromPrior:true};this.alvaFactors.push(item);trim(this.alvaFactors,this.maxFrames*2);return item;
  }
  addMvs(frameId,samples,{sourceFrames=[],estimatedPose=null,sourceEstimatePoses=null,evidenceBuild=null,stage='unknown',scaffoldId=null}={}){
    const src=[...new Set((sourceFrames||[]).map(String).filter(Boolean))],valid=(samples||[]).filter(s=>Array.isArray(s.p)&&Number.isFinite(s.depth)&&s.depth>0);if(!valid.length)return;
    const fid=String(frameId),frame=this.frames[this.frameIndex.get(fid)],explicitReferencePose=clonePoseSafe(estimatedPose),boundPose=explicitReferencePose||clonePoseSafe(frame?.poseEstimate||frame?.posePrior),qinv=boundPose?.q?qConjLocal(boundPose.q):null,step=Math.max(1,Math.ceil(valid.length/this.mvsPerFrame)),picked=[];for(let i=0;i<valid.length;i+=step)picked.push(valid[i]);const n=picked.length,data=new Float32Array(n*8),normal=new Float32Array(n*3),color=new Uint8Array(n*3),flags=new Uint8Array(n),viewMask=new Uint16Array(n),radius=new Float32Array(n);
    for(let i=0;i<n;i++){const s=picked[i],sigma=Number(s.sigmaDepth)||Math.max(.015,s.depth*(.025+.18*(1-(Number(s.confidence)||.1)))),o=i*8;data[o]=+(s.u||0);data[o+1]=+(s.v||0);data[o+2]=+s.depth;data[o+3]=clamp(Number(s.probability??s.confidence??.1),.001,.999);data[o+4]=sigma;data[o+5]=Number.isFinite(+s.cost)?+s.cost:NaN;data[o+6]=Number.isFinite(+s.distinctiveness)?+s.distinctiveness:NaN;data[o+7]=Number.isFinite(+s.photoAgreement)?+s.photoAgreement:NaN;const nn=Array.isArray(s.normal)?s.normal:null,cn=nn&&qinv?qRotateLocal(qinv,nn):nn,nnorm=cn?Math.hypot(Number(cn[0])||0,Number(cn[1])||0,Number(cn[2])||0):0,cc=Array.isArray(s.color)?s.color:null;for(let k=0;k<3;k++){normal[i*3+k]=nnorm>1e-6?Number(cn[k])/nnorm:0;color[i*3+k]=clamp(Math.round(Number(cc?.[k]??180)),0,255);}flags[i]=s.priorEscaped?1:0;viewMask[i]=Number(s.viewMask||0)&0xffff;radius[i]=Number.isFinite(Number(s.radius))&&Number(s.radius)>0?Number(s.radius):0;}
    const sourcePoseMap=normalisePoseBindings(sourceEstimatePoses),sourcePosesAtEstimate=[];for(const sid of src){if(sid===fid)continue;const sf=this.frames[this.frameIndex.get(sid)],pose=clonePoseSafe(sourcePoseMap.get(sid)||sf?.poseEstimate||sf?.posePrior);if(pose)sourcePosesAtEstimate.push({frameId:sid,pose});}
    this.mvsFactors.push({frameId:fid,sourceFrames:src.filter(x=>x&&x!==fid),count:n,data,normal,normalSpace:qinv?'camera':'unknown',color,flags,viewMask,radius,packed:true,depthFrame:'reference-camera-z',estimatedUnder:explicitReferencePose?'explicit-payload-pose':'unbound',referencePoseAtEstimate:explicitReferencePose,sourcePosesAtEstimate:explicitReferencePose?sourcePosesAtEstimate:[],poseBound:!!(explicitReferencePose&&sourcePosesAtEstimate.length),evidenceBuild:evidenceBuild?String(evidenceBuild):null,stage:String(stage||'unknown'),scaffoldId:scaffoldId?String(scaffoldId):null,finalPoseRevalidationRequired:true});trim(this.mvsFactors,this.maxFrames);
  }
  exportState(){return {format:'ROOMSCAN-PROB-GRAPH-1',version:this.version,createdAt:this.createdAt,cameraModel:this.cameraModel,photoEdgeAudit:this.photoEdgeAudit,frames:this.frames,edgeFactors:this.edgeFactors,alvaFactors:this.alvaFactors,landmarkFactors:this.landmarkFactors,deepFactors:this.deepFactors,mvsFactors:this.mvsFactors,summary:this.summary()};}
  summary(){const obs=this.landmarkFactors.reduce((n,x)=>n+x.measurements.length,0),mvs=this.mvsFactors.reduce((n,x)=>n+(x.count??x.samples?.length??0),0),mvsPoseBound=this.mvsFactors.filter(x=>x?.poseBound&&x?.referencePoseAtEstimate).length,mvsPoseUnbound=this.mvsFactors.length-mvsPoseBound,audit=this.photoEdgeAudit||{inputEdges:this.edgeFactors.length,importedEdges:this.edgeFactors.length,unresolvedEdges:0,importFraction:1};return {frames:this.frames.length,photoEdges:this.edgeFactors.length,photoEdgeInput:audit.inputEdges,photoEdgeUnresolved:audit.unresolvedEdges,photoEdgeImportFraction:audit.importFraction,photoEdgeMatchAsStored:audit.asStoredMatchEdges??null,photoEdgeMatchSwapped:audit.swappedMatchEdges??null,photoEdgeMatchAmbiguous:audit.ambiguousMatchEdges??null,alvaEdges:this.alvaFactors.length,landmarks:this.landmarkFactors.length,featureObservations:obs,deepFrames:this.deepFactors.length,mvsSamples:mvs,mvsFactors:this.mvsFactors.length,mvsPoseBoundFactors:mvsPoseBound,mvsPoseUnboundFactors:mvsPoseUnbound,cameraFixed:!!this.cameraModel,bytesApprox:this.approxBytes()};}
  approxBytes(){return this.frames.reduce((n,f)=>n+(f.gray?.byteLength||0)+(f.photo?.gray?.byteLength||0)+(f.photo?.rgb?.byteLength||0)+(f.features?.length||0)*56+(f.photo?.features?.length||0)*48,0)+this.landmarkFactors.length*180+this.deepFactors.reduce((n,d)=>n+(d.raw?.byteLength||0)+100,0)+this.mvsFactors.reduce((n,m)=>n+(m.data?.byteLength||0)+(m.normal?.byteLength||0)+(m.color?.byteLength||0)+(m.flags?.byteLength||0)+(m.viewMask?.byteLength||0)+(m.radius?.byteLength||0)+(m.samples?.length||0)*72,0);}
  reindex(){this.frameIndex.clear();this.frames.forEach((f,i)=>this.frameIndex.set(String(f.frameId),i));}
  indexLandmark(index,l){for(const m of l?.measurements||[]){const fid=String(m.frameId);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const k=measurementKey(fid,m.u+dx*3,m.v+dy*3),a=this.measurementIndex.get(k)||[];if(!a.includes(index)){a.push(index);if(a.length>6)a.shift();this.measurementIndex.set(k,a);}}}}
  rebuildMeasurementIndex(){this.measurementIndex=new Map();this.landmarkFactors.forEach((l,i)=>this.indexLandmark(i,l));}
  findLandmarkByMeasurement(ms){const votes=new Map();for(const m of ms||[]){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=this.measurementIndex.get(measurementKey(String(m.frameId),m.u+dx*3,m.v+dy*3))||[];for(const i of a)votes.set(i,(votes.get(i)||0)+1);}}let best=-1,bv=0;for(const [i,v] of votes){const l=this.landmarkFactors[i];if(!l)continue;let exact=0;for(const a of l.measurements||[])for(const b of ms||[])if(String(a.frameId)===String(b.frameId)&&Math.hypot(a.u-b.u,a.v-b.v)<=3.5){exact++;break;}if(exact>bv){bv=exact;best=i;}}return bv>0?best:-1;}
  pruneOrphans(){const live=new Set(this.frames.map(f=>String(f.frameId)));this.edgeFactors=this.edgeFactors.filter(e=>live.has(String(e.aId))&&live.has(String(e.bId)));this.alvaFactors=this.alvaFactors.filter(e=>live.has(String(e.aId))&&live.has(String(e.bId)));this.landmarkFactors=this.landmarkFactors.map(l=>({...l,measurements:(l.measurements||[]).filter(m=>live.has(String(m.frameId)))})).filter(l=>l.measurements.length>=2);this.deepFactors=this.deepFactors.filter(d=>live.has(String(d.frameId)));this.mvsFactors=this.mvsFactors.filter(d=>live.has(String(d.frameId)));this.rebuildMeasurementIndex();}
  static fromState(s){const g=new ProbabilisticFactorGraph();if(!s)return g;g.version=Math.max(8,s.version||1);g.createdAt=s.createdAt||Date.now();g.cameraModel=s.cameraModel||null;g.frames=s.frames||[];g.edgeFactors=s.edgeFactors||[];g.photoEdgeAudit=s.photoEdgeAudit||{inputEdges:g.edgeFactors.length,importedEdges:g.edgeFactors.length,unresolvedEdges:0,importFraction:1};g.alvaFactors=s.alvaFactors||[];g.landmarkFactors=s.landmarkFactors||[];g.deepFactors=s.deepFactors||[];g.mvsFactors=s.mvsFactors||[];g.reindex();g.canonicalizeLegacyPhotoEdges();g.rebuildMeasurementIndex();return g;}
}

function clonePoseSafe(p){return p?.p?.length>=3&&p?.q?.length>=4?{p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)}:null;}
function normalisePoseBindings(x){const m=new Map();if(Array.isArray(x)){for(const e of x){const id=String(e?.frameId??e?.id??''),p=clonePoseSafe(e?.pose||e);if(id&&p)m.set(id,p);}}else if(x&&typeof x==='object'){for(const [id,v] of Object.entries(x)){const p=clonePoseSafe(v?.pose||v);if(p)m.set(String(id),p);}}return m;}

function makeCameraModel(K,D){return {fxNorm:K.fx/Math.max(1,K.width),fyNorm:K.fy/Math.max(1,K.height),cxNorm:K.cx/Math.max(1,K.width),cyNorm:K.cy/Math.max(1,K.height),referenceWidth:K.width,referenceHeight:K.height,D:Array.isArray(D)?D.slice(0,8).map(Number):null,locked:true};}
function scaledCameraK(m,w,h){return {fx:m.fxNorm*w,fy:m.fyNorm*h,cx:m.cxNorm*w,cy:m.cyNorm*h,width:w,height:h};}
function intrinsicDeviation(a,b){return {fxRel:Math.abs(a.fx-b.fx)/Math.max(1,b.fx),fyRel:Math.abs(a.fy-b.fy)/Math.max(1,b.fy),cxPx:Math.abs(a.cx-b.cx),cyPx:Math.abs(a.cy-b.cy)};}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)};}
function clonePoseCov(c){if(!c)return null;return {diag:Array.isArray(c.diag)?c.diag.slice(0,6).map(Number):null,translationStd:+(c.translationStd||0),rotationStdRad:+(c.rotationStdRad||0),quality:+(c.quality||0),source:c.source||null};}
function cov6(c){return Array.isArray(c)&&c.length>=6?c.slice(0,6).map(Number):[.01,0,0,.01,0,.01];}
function trim(a,n){if(a.length>n)a.splice(0,a.length-n);}
function compactCalibration(c){return {ok:!!c.ok,mode:c.mode||null,a:+(c.a||0),b:+(c.b||0),confidence:+(c.confidence||0),medianRelativeError:+(c.medianRelativeError||0),posteriorConfidence:+(c.posteriorConfidence||c.confidence||0),sequenceMode:c.sequenceMode||c.mode||null};}
function compactQuality(q){return {suspicious:!!q.suspicious,coherenceRatio:+(q.coherenceRatio||0),stripe:{suspicious:!!q.stripe?.suspicious,dominantExplained:+(q.stripe?.dominantExplained||0),dominantCycles:+(q.stripe?.dominantCycles||0)}};}
function compactPhotoQuality(q){if(!q)return null;return {score:+(q.score||0),blurScore:+(q.blurScore||0),exposureScore:+(q.exposureScore||0),textureCoverage:+(q.textureCoverage||0),clippedFraction:+(q.clippedFraction||0),mean:+(q.mean||0),severe:!!q.severe};}
function downsampleGray(gray,w,h,maxSide){if(!gray?.length)return {gray:new Uint8Array(0),width:0,height:0};const scale=Math.min(1,maxSide/Math.max(w,h)),dw=Math.max(1,Math.round(w*scale)),dh=Math.max(1,Math.round(h*scale)),out=new Uint8Array(dw*dh);for(let y=0;y<dh;y++){const sy=Math.min(h-1,Math.floor((y+.5)*h/dh));for(let x=0;x<dw;x++){const sx=Math.min(w-1,Math.floor((x+.5)*w/dw));out[y*dw+x]=gray[sy*w+sx];}}return {gray:out,width:dw,height:dh};}

function downsamplePhoto(frame,maxSide,features){
  if(!frame?.gray?.length||!(frame.width>0&&frame.height>0))return null;const sw=frame.width,sh=frame.height,scale=Math.min(1,Math.max(48,+maxSide||128)/Math.max(sw,sh)),w=Math.max(16,Math.round(sw*scale)),h=Math.max(16,Math.round(sh*scale)),gray=new Uint8Array(w*h),rgb=new Uint8Array(w*h*3),sx=sw/w,sy=sh/h,rgba=frame.rgba;
  for(let y=0;y<h;y++){const yy=Math.min(sh-1,Math.floor((y+.5)*sy));for(let x=0;x<w;x++){const xx=Math.min(sw-1,Math.floor((x+.5)*sx)),si=yy*sw+xx,di=y*w+x;gray[di]=frame.gray[si];if(rgba?.length>=sw*sh*4){rgb[di*3]=rgba[si*4];rgb[di*3+1]=rgba[si*4+1];rgb[di*3+2]=rgba[si*4+2];}else rgb.fill(gray[di],di*3,di*3+3);}}
  const K={fx:frame.K.fx*w/sw,fy:frame.K.fy*h/sh,cx:frame.K.cx*w/sw,cy:frame.K.cy*h/sh,width:w,height:h},pf=(features||[]).map((f,index)=>({index,originalIndex:index,originalU:+f.x,originalV:+f.y,x:+f.x*w/sw,y:+f.y*h/sh,score:+(f.score||0),source:f.source||'mvs',desc:Array.isArray(f.desc)?f.desc.slice(0,24).map(Number):[]}));return {width:w,height:h,K,gray,rgb,features:pf};
}
function sampleGrid(a,w,h,cols,rows){const out=new Float32Array(cols*rows);for(let y=0;y<rows;y++){const yy=Math.min(h-1,Math.round(y*(h-1)/Math.max(1,rows-1)));for(let x=0;x<cols;x++){const xx=Math.min(w-1,Math.round(x*(w-1)/Math.max(1,cols-1))),v=Number(a[yy*w+xx]);out[y*cols+x]=Number.isFinite(v)?v:0;}}return out;}

function measurementKey(fid,u,v){return `${fid}:${Math.round((+u||0)/3)}:${Math.round((+v||0)/3)}`;}
function mergeLandmarkFactor(a,b){
  const wa=mixtureWeight(a),wb=mixtureWeight(b),s=wa+wb||1,alpha=wa/s,mu=a.point.slice(0,3),nu=b.point.slice(0,3),m=[alpha*mu[0]+(1-alpha)*nu[0],alpha*mu[1]+(1-alpha)*nu[1],alpha*mu[2]+(1-alpha)*nu[2]];
  a.covariance=mixtureCov(a.covariance,b.covariance,mu,nu,m,alpha);a.point=m;a.depth=alpha*(+a.depth||0)+(1-alpha)*(+b.depth||0);a.relativeDepthSigma=alpha*(+a.relativeDepthSigma||.3)+(1-alpha)*(+b.relativeDepthSigma||.3);if(!a.descriptor?.length&&b.descriptor?.length)a.descriptor=b.descriptor.slice();
  const pa=clamp(+a.probability||.01,.001,.999),pb=clamp(+b.probability||.01,.001,.999);a.probability=clamp(Math.max(pa,pb)+.25*Math.min(pa,pb)*(1-Math.max(pa,pb)),.001,.999);a.calibrationWeight=Math.max(+a.calibrationWeight||0,+b.calibrationWeight||0);
  const byFrame=new Map((a.measurements||[]).map(x=>[String(x.frameId),{...x}]));for(const x of b.measurements||[]){const k=String(x.frameId),old=byFrame.get(k);if(!old||(+x.probability||0)>(+old.probability||0))byFrame.set(k,{...x});}a.measurements=[...byFrame.values()];a.sourceIds=[...new Set([...(a.sourceIds||[]),...(b.sourceIds||[])].map(String))];return a;
}
function mixtureWeight(l){return clamp(+l?.probability||.05,.01,.999)/Math.max(1e-8,covTrace(l?.covariance));}
function covTrace(c){return Math.max(1e-9,(+c?.[0]||0)+(+c?.[3]||0)+(+c?.[5]||0));}
function mixtureCov(c1,c2,m1,m2,m,a){c1=cov6(c1);c2=cov6(c2);const d1=[m1[0]-m[0],m1[1]-m[1],m1[2]-m[2]],d2=[m2[0]-m[0],m2[1]-m[1],m2[2]-m[2]],o=(d)=>[d[0]*d[0],d[0]*d[1],d[0]*d[2],d[1]*d[1],d[1]*d[2],d[2]*d[2]],q1=o(d1),q2=o(d2);return c1.map((x,i)=>a*(x+q1[i])+(1-a)*(c2[i]+q2[i]));}

function resolvePhotoFrameId(e,side,frames){const explicit=e?.[`${side}Id`];if(explicit!=null&&String(explicit))return String(explicit);const raw=e?.[side];if(Number.isInteger(raw)&&raw>=0&&raw<frames.length)return String(frames[raw]?.frameId||'');if(raw!=null){const id=String(raw);if(frames.some(f=>String(f.frameId)===id))return id;}return '';}
function qConjLocal(q){return [-q[0],-q[1],-q[2],q[3]];}function qMulLocal(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}function qNormalizeLocal(q){const n=Math.hypot(...q)||1;return q.map(x=>x/n);}function qRotateLocal(q,v){const x=q[0],y=q[1],z=q[2],w=q[3],tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];}
function alvaPriorConfidence(a,b){const da=a?.poseCov?.diag||[],db=b?.poseCov?.diag||[],v=[...da,...db].reduce((s,x)=>s+(Number(x)||0),0),mode=`${a?.trackingMode||''} ${b?.trackingMode||''}`.toLowerCase();let q=1/(1+25*v);if(mode.includes('lost'))q*=.03;else if(mode.includes('relocal'))q*=.55;return clamp(q,.02,.99);}

function photoPairKey(a,b){return `${String(a??'')}>${String(b??'')}`;}
