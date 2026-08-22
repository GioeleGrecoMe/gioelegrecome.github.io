import {normalizeFrame} from './view_puzzle.js';
import {DepthScaleGraph} from './depth_scale_graph.js';
import {pixelRay,qRotate} from '../slam/math.js';
import {matchPhotoFeatures,buildPhotoRegistrationEdge,solvePhotoMosaic,visualAlvaDiagnostics,photoPixelToCanvas,computeMosaicBounds,detectPhotoFeatures,photoAppearanceSimilarity,canvasPointToPhotoPixel,frameCanvasBounds} from './photo_panorama.js';
import {solvePhotoDepthConsensus,sampleConsensusDepth,sampleConsensusDepthInfo} from './photo_depth_consensus.js';
import {createProbabilisticDepthAtlas,addDepthObservation,resolveProbabilisticDepthAtlas,overlapHannWeight} from './probabilistic_depth_atlas.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-8;

/**
 * Live PHOTO-only mosaic + depth evidence monitor.
 *
 * Every survey photograph is frozen on the exact camera frame sent to Deep.
 * The mosaic is observable with or without AlvaAR: corners, descriptors, pairwise
 * registration and global spherical placement all come from the photographs
 * themselves.  A valid Alva pose may be attached as optional metadata
 * for the unchanged metric/3-D path, but it has zero authority over the photo map.
 *
 * Pairwise matches are converted to calibrated camera rays. Each accepted edge
 * estimates only a rigid relative rotation; all frames are then rotation-averaged
 * on a common sphere. No homography/affine/local mesh warp is allowed to stretch a
 * photograph. Disconnected photos remain pending until a real RGB overlap is found.
 *
 * Deep is a second, independent layer. Raw monocular maps are statistically
 * aligned through the SAME visual overlaps and fused by source confidence. The
 * existing metric Deep/Alva scale graph is retained for metric values, but it is
 * not allowed to blur or reposition the photographic panorama.
 *
 * Important rendering rule: overlapping RGB is NOT averaged indiscriminately.
 * Best-view compositing keeps one sharp source observation per atlas pixel and
 * only performs a tiny colour-consistent seam blend.
 */
export class LivePhotoPuzzleMap{
  constructor({
    width=640,height=320,maxFrames=90,maxRenderFrames=64,temporalRadius=8,
    maxLoopCandidates=8,maxRecoveryCandidates=18,minEdgeMatches=6,minEdgeProbability=.10,
    maxWorldSamples=12000,photoMaxSide=256,depthMaxSide=168,
    depthMinPairs=6,depthRegularizeIterations=8,maxPhotoSamples=260000,
    maxDepthSamples=190000
  }={}){
    Object.assign(this,{width,height,maxFrames,maxRenderFrames,temporalRadius,maxLoopCandidates,maxRecoveryCandidates,minEdgeMatches,minEdgeProbability,maxWorldSamples,photoMaxSide,depthMaxSide,depthMinPairs,depthRegularizeIterations,maxPhotoSamples,maxDepthSamples});
    this.frames=[];this.frameMap=new Map();this.edges=[];this.adj=new Map();this.worldSamples=[];
    // Kept only for the unchanged metric/3-D evidence path. The PHOTO mosaic has
    // its own arbitrary 2-D coordinate system and never reads this Alva origin.
    this.origin=null;this.fallbackDepth=2.2;this.lastRenderStats=null;this.depthScaleDirty=true;
    this.depthScaleStats=null;this.depthScaleModel=null;this.depthScaleTransforms=new Map();this.visualSolution=null;this.visualDirty=true;this.depthConsensus=null;this.depthConsensusDirty=true;this.depthDisplayRange=null;this.lastDepthFusionStats=null;
  }
  reset(){this.frames=[];this.frameMap.clear();this.edges=[];this.adj.clear();this.worldSamples=[];this.origin=null;this.lastRenderStats=null;this.depthScaleDirty=true;this.depthScaleStats=null;this.depthScaleModel=null;this.depthScaleTransforms=new Map();this.visualSolution=null;this.visualDirty=true;this.depthConsensus=null;this.depthConsensusDirty=true;this.depthDisplayRange=null;this.lastDepthFusionStats=null;}
  setFallbackDepth(z){if(Number.isFinite(+z)&&+z>.15)this.fallbackDepth=clamp(+z,.2,12);}

  /**
   * Rehydrate the same sharp atlas from a persisted probabilistic graph after the
   * photo/depth graphs have already been solved in post-processing. This avoids
   * falling back to the old orientation-only averaged panorama in Review.
   */
  loadSolvedGraph(graph,puzzle,depthScale){
    this.reset();
    const pf=puzzle?.frames||[];
    for(const src of pf){
      const f={...src,pose:clonePoseNullable(src.pose),K:{...src.K},gray:new Uint8Array(src.gray||[]),rgb:new Uint8Array(src.rgb||[]),features:(src.features||[]).map(x=>({...x,desc:Array.from(x.desc||[])})),at:Number(src.at||0),metricLocked:true,source:'post-scan'};
      f.relativeDepth=null;f.relativeDepthWidth=0;f.relativeDepthHeight=0;f.relativeQuality=null;f.relativeConfidence=0;f.metricDepth=null;f.metricDepthWidth=0;f.metricDepthHeight=0;f.metricConfidence=0;f.metricCalibration=null;f.depthPending=false;f.depthTransform=null;f.depthConfidence=0;f.photoGain=1;f.photoGainRgb=[1,1,1];f.fallbackDepth=this.fallbackDepth;f.connected=false;
      if(!this.origin&&f.pose?.p)this.origin=f.pose.p.slice(0,3).map(Number);this.frameMap.set(String(f.frameId),this.frames.length);this.frames.push(f);
    }
    this.adj=new Map(this.frames.map((_,i)=>[i,[]]));
    // V30.35 stores rigid spherical rotations plus layer-wise probabilistic Depth evidence.  When an older persisted puzzle
    // only contains photographic correspondences, rebuild the spherical edge
    // from those matches instead of trusting a legacy homography.
    this.edges=[];for(const src of puzzle?.edges||[]){let e={...src,matches:(src.matches||[]).map(m=>({...m}))};if(!Array.isArray(e.rotationBToA)||e.rotationBToA.length!==9){const a=this.frames[e.a],b=this.frames[e.b],reg=buildPhotoRegistrationEdge(a,b,e.matches,{minMatches:this.minEdgeMatches,angularThresholdDeg:6,recovery:true});if(!reg)continue;e={...e,...reg,registration:'photo-spherical-rotation-irls'};}else e.rotationBToA=Array.from(e.rotationBToA,Number);this.edges.push(e);this.adj.get(e.a)?.push(e);this.adj.get(e.b)?.push(e);}
    const deep=new Map((graph?.deepFactors||[]).map(d=>[String(d.frameId),d]));
    for(const f of this.frames){const d=deep.get(String(f.frameId));if(d?.raw?.length){f.relativeDepth=new Float32Array(d.raw);f.relativeDepthWidth=d.cols;f.relativeDepthHeight=d.rows;f.relativeQuality=d.quality||null;f.relativeConfidence=.2;f.metricCalibration=d.calibration||null;}const t=depthScale?.transforms?.get?.(String(f.frameId));if(t?.mode){f.depthTransform={...t};f.depthConfidence=depthScale.frameConfidence?.(String(f.frameId))??t.confidence??.02;}}
    this.depthScaleDirty=false;this.depthScaleStats=depthScale?.stats||null;this.depthScaleModel=depthScale?.metricModel||null;this.depthScaleTransforms=depthScale?.transforms||new Map();this.recomputeConnectivity();this.visualDirty=true;this.recomputeVisualSolution(puzzle);this.recomputePhotoGains();this.depthConsensusDirty=true;
    for(const f of this.frames){const z=this.sampleMetricDepth(f,f.K.cx,f.K.cy);if(Number.isFinite(z)&&z>.08&&z<20){f.fallbackDepth=z;this.fallbackDepth=this.fallbackDepth*.94+z*.06;}}
    return this.stats();
  }

  /** Add a compact already-normalised graph frame (legacy/dense keyframe path). */
  addFrame(frame,{fallbackDepth=null,source='graph'}={}){
    const f=normalizeFrame(frame);if(!f?.frameId||!f.rgb?.length)return this.stats();
    f.poseCov=frame?.poseCov||null;f.at=Number(frame?.at||frame?.captureAt||0);f.source=source;
    f.metricLocked=!!frame?.metricLocked;f.depthPending=false;
    return this.addPreparedFrame(f,{fallbackDepth});
  }

  /**
   * Add the exact camera frame that is being sent to Deep.  Downsampling happens
   * synchronously here, before the camera buffer can be reused by the next frame.
   */
  addCameraFrame(frame,{fallbackDepth=null,source='deep-survey'}={}){
    // Staging-only API. A camera photo without a bound depth map is deliberately
    // NOT connected to the RGB mosaic. The live measurement path uses
    // commitCameraFrameWithRelativeDepth() after Deep returns for this exact frame.
    const f=compactCameraFrame(frame,this.photoMaxSide);if(!f)return this.stats();f.source=source;f.depthPending=true;
    return this.addPreparedFrame(f,{fallbackDepth});
  }

  /**
   * Atomically admit one exact RGB frame and its exact-frame raw Deep map.
   * If depth is missing/invalid, NOTHING is inserted into the photo graph.
   * This is the only API used by the live measurement mosaic.
   */
  commitCameraFrameWithRelativeDepth(frame,{rawDepth,width,height,quality=null,confidence=.12,calibration=null}={}, {fallbackDepth=null,source='deep-survey'}={}){
    const f=compactCameraFrame(frame,this.photoMaxSide);if(!f)return {ok:false,reason:'invalid-photo',stats:this.stats()};
    const c=compactDepth(rawDepth,width,height,this.depthMaxSide,false);if(!c.depth?.length||c.validRatio<.03)return {ok:false,reason:'invalid-depth',validRatio:c.validRatio||0,stats:this.stats()};
    f.source=source;f.depthPending=false;f.relativeDepth=c.depth;f.relativeDepthWidth=c.width;f.relativeDepthHeight=c.height;f.relativeQuality=quality?compactQuality(quality):null;f.relativeConfidence=clamp(Number(confidence)||.06,.005,1);f.metricCalibration=normaliseCalibration(calibration);
    const stats=this.addPreparedFrame(f,{fallbackDepth});this.depthScaleDirty=true;this.depthConsensusDirty=true;
    return {ok:true,frameId:String(f.frameId),stats};
  }

  addPreparedFrame(f,{fallbackDepth=null}={}){
    const id=String(f.frameId),oldIndex=this.frameMap.get(id),hasRawDepth=!!f.relativeDepth?.length,hasMetricDepth=!!f.metricDepth?.length;
    if(oldIndex!=null){
      const old=this.frames[oldIndex];
      // Prefer new exact RGB resolution and new depth evidence, never erase an
      // already committed depth map with a later metadata-only packet.
      const keep={
        relativeDepth:hasRawDepth?f.relativeDepth:old.relativeDepth,
        relativeDepthWidth:hasRawDepth?f.relativeDepthWidth:old.relativeDepthWidth,
        relativeDepthHeight:hasRawDepth?f.relativeDepthHeight:old.relativeDepthHeight,
        relativeQuality:hasRawDepth?f.relativeQuality:old.relativeQuality,
        relativeConfidence:hasRawDepth?f.relativeConfidence:old.relativeConfidence,
        metricDepth:hasMetricDepth?f.metricDepth:old.metricDepth,
        metricDepthWidth:hasMetricDepth?f.metricDepthWidth:old.metricDepthWidth,
        metricDepthHeight:hasMetricDepth?f.metricDepthHeight:old.metricDepthHeight,
        metricConfidence:hasMetricDepth?f.metricConfidence:old.metricConfidence,
        metricCalibration:f.metricCalibration||old.metricCalibration,
        depthTransform:old.depthTransform,depthConfidence:old.depthConfidence,
        depthPending:!(hasRawDepth||hasMetricDepth)&&(old.depthPending||f.depthPending),
        photoGain:old.photoGain,photoGainRgb:old.photoGainRgb,fallbackDepth:old.fallbackDepth,connected:old.connected,visualQ:old.visualQ,visualConfidence:old.visualConfidence
      };
      if((f.width*f.height)>(old.width*old.height)*1.08)this.frames[oldIndex]={...f,...keep};
      else{old.pose=f.pose||old.pose;old.poseCov=f.poseCov||old.poseCov;old.metricLocked=old.metricLocked||f.metricLocked;old.at=f.at||old.at;if((f.features?.length||0)>(old.features?.length||0))old.features=f.features;Object.assign(old,keep);}
      this.depthScaleDirty=true;this.depthConsensusDirty=true;this.visualDirty=true;this.recomputeOrigin();this.recomputeVisualSolution();return this.stats();
    }
    if(!this.origin&&f.pose?.p)this.origin=f.pose.p.slice(0,3).map(Number);
    if(!hasRawDepth){f.relativeDepth=null;f.relativeDepthWidth=0;f.relativeDepthHeight=0;f.relativeQuality=null;f.relativeConfidence=0;}
    if(!hasMetricDepth){f.metricDepth=null;f.metricDepthWidth=0;f.metricDepthHeight=0;f.metricConfidence=0;}
    f.metricCalibration=f.metricCalibration||null;f.depthTransform=null;f.depthConfidence=0;f.connected=this.frames.length===0&&hasRawDepth;f.photoGain=1;f.photoGainRgb=[1,1,1];
    f.depthPending=!(hasRawDepth||hasMetricDepth)&&!!f.depthPending;f.fallbackDepth=Number.isFinite(+fallbackDepth)?+fallbackDepth:this.fallbackDepth;
    this.frameMap.set(id,this.frames.length);this.frames.push(f);this.adj.set(this.frames.length-1,[]);
    // Structural invariant: only a frame with depth evidence may enter the RGB
    // overlap graph. Pending RGB snapshots are invisible and unconnected.
    if(hasRawDepth||hasMetricDepth)this.connectNewest();while(this.frames.length>this.maxFrames)this.dropOldest();this.visualDirty=true;
    this.recomputeConnectivity();this.recomputeOrigin();this.recomputeVisualSolution();this.recomputePhotoGains();this.depthScaleDirty=true;this.depthConsensusDirty=true;return this.stats();
  }

  /** Raw relative Deep map from the exact photo node. */
  updateRelativeDepth(frameId,{rawDepth,width,height,quality=null,confidence=.12,calibration=null}={}){
    const i=this.frameMap.get(String(frameId));if(i==null||!rawDepth?.length||!(width>1&&height>1))return false;const f=this.frames[i],wasEligible=hasDepthEvidence(f),c=compactDepth(rawDepth,width,height,this.depthMaxSide,false);
    if(c.validRatio<.03)return false;f.relativeDepth=c.depth;f.relativeDepthWidth=c.width;f.relativeDepthHeight=c.height;f.relativeQuality=quality?compactQuality(quality):null;f.relativeConfidence=clamp(Number(confidence)||.06,.005,1);f.metricCalibration=normaliseCalibration(calibration)||f.metricCalibration;f.depthPending=false;
    if(!wasEligible){this.connectFrame(i);this.recomputeConnectivity();this.recomputeVisualSolution();this.recomputePhotoGains();}this.depthScaleDirty=true;this.depthConsensusDirty=true;return true;
  }

  /** Strong metric map from online Deep->Alva calibration. */
  updateDepth(frameId,{depth,width,height,confidence=.25,mode='metric-deep',calibration=null}={}){
    const i=this.frameMap.get(String(frameId));if(i==null||!depth?.length||!(width>1&&height>1))return false;const f=this.frames[i],wasEligible=hasDepthEvidence(f),c=compactDepth(depth,width,height,this.depthMaxSide,true);
    if(c.validRatio<.03)return false;f.metricDepth=c.depth;f.metricDepthWidth=c.width;f.metricDepthHeight=c.height;f.metricConfidence=clamp(+confidence||.05,.02,1);f.depthMode=mode;f.metricCalibration=normaliseCalibration(calibration)||f.metricCalibration;f.depthPending=false;
    if(!wasEligible){this.connectFrame(i);this.recomputeConnectivity();this.recomputeVisualSolution();this.recomputePhotoGains();}if(Number.isFinite(c.median)){f.fallbackDepth=c.median;this.fallbackDepth=this.fallbackDepth*.82+c.median*.18;}this.depthScaleDirty=true;this.depthConsensusDirty=true;return true;
  }

  addWorldSamples(samples,{maxAdd=900,source='mvs'}={}){
    const a=(samples||[]).filter(s=>Array.isArray(s?.p)&&s.p.length>=3&&s.p.every(Number.isFinite));if(!a.length)return 0;const step=Math.max(1,Math.ceil(a.length/Math.max(1,maxAdd)));let n=0;
    for(let i=0;i<a.length;i+=step){const s=a[i],p=s.p.slice(0,3).map(Number),confidence=clamp(Number(s.probability??s.geometryProbability??s.confidence??.12),.005,1),color=Array.isArray(s.color)?s.color.slice(0,3).map(x=>clamp(+x||0,0,255)):null;this.worldSamples.push({p,confidence,color,source});n++;}
    if(this.worldSamples.length>this.maxWorldSamples)this.worldSamples.splice(0,this.worldSamples.length-this.maxWorldSamples);return n;
  }

  stats(){
    this.rebuildDepthScaleIfNeeded();this.rebuildDepthConsensusIfNeeded();const comps=this.components(),visible=this.visualSolution?.component||this.rootComponent(),loops=this.edges.reduce((n,e)=>n+(e.loop?1:0),0),rawDepthFrames=this.frames.reduce((n,f)=>n+(f.relativeDepth?.length?1:0),0),metricDepthFrames=this.frames.reduce((n,f)=>n+(this.frameHasMetricDepth(f)?1:0),0),pendingDepthFrames=this.frames.reduce((n,f)=>n+(f.depthPending?1:0),0),connected=this.frames.length?visible.length:0,diag=visualAlvaDiagnostics(this.frames,this.edges,this.visualSolution);
    return {frames:this.frames.length,edges:this.edges.length,loops,connectedFrames:connected,connectedFraction:this.frames.length?connected/this.frames.length:0,components:comps.length,rawDepthFrames,metricDepthFrames,pendingDepthFrames,worldSamples:this.worldSamples.length,coverage:this.lastRenderStats?.coverage||0,origin:(this.origin||[0,0,0]).slice(),depthScaleMode:this.depthScaleStats?.metricMode||null,depthScaleError:this.depthScaleStats?.metricRelativeError??Infinity,depthScalePairs:this.depthScaleStats?.metricPairs||0,depthAlignedFrames:this.depthScaleStats?.alignedFrames||metricDepthFrames,photoOnlyMosaic:true,visualRegisteredFrames:this.visualSolution?Array.from(this.visualSolution.confidence).reduce((n,c)=>n+(c>0?1:0),0):0,meanVisualConfidence:this.edges.length?this.edges.reduce((a,e)=>a+(e.visualConfidence||0),0)/this.edges.length:0,mosaicResidual:this.visualSolution?.medianResidual??0,mosaicP90Residual:this.visualSolution?.p90Residual??0,depthConsensusAlignedFrames:this.depthConsensus?.stats?.alignedFrames||0,depthConsensusEdges:this.depthConsensus?.stats?.pairEdges||0,depthConsensusError:this.depthConsensus?.stats?.medianRelativeError??Infinity,depthLayerAnchors:this.depthConsensus?.stats?.layerAnchors||0,depthOverlapLayerAnchors:this.depthConsensus?.stats?.overlapLayerAnchors||0,depthLayerCoverage:this.depthConsensus?.stats?.medianLayerCoverage||0,depthAmbiguousFraction:this.lastDepthFusionStats?.ambiguousFraction||0,sphericalProjection:true,sphericalResidualDeg:this.visualSolution?.medianResidualDeg??0,sphericalP90ResidualDeg:this.visualSolution?.p90ResidualDeg??0,...diag};
  }

  render(canvas,mode='photo'){
    if(!canvas)return this.stats();this.rebuildDepthScaleIfNeeded();const result=mode==='depth'?this.renderDepthAtlas():this.renderPhotoAtlas();
    // The live preview is deliberately just the reconstructed image.  Feature
    // points, frame centres and graph edges are diagnostics, not scene content,
    // and made the RGB panorama look like an exploding point cloud.
    drawAtlas(canvas,result);this.lastRenderStats={...this.stats(),coverage:result.coverage||0,mode,depthMode:result.depthMode||null,depthMin:result.depthMin??null,depthMax:result.depthMax??null};return this.lastRenderStats;
  }

  renderPhotoAtlas(){
    this.recomputeVisualSolution();const width=this.width,height=this.height,rgba=new Uint8ClampedArray(width*height*4),score=new Float32Array(width*height),visible=new Set(this.visualSolution?.component||[]),indices=this.renderIndices(visible).filter(i=>hasDepthEvidence(this.frames[i])),bounds=this.visualSolution?.bounds||computeMosaicBounds(this.frames,this.visualSolution?.transforms||[],{padding:.055});
    // Rigid spherical inverse warp. Every atlas pixel is a ray on the common
    // sphere, rotated back into the source camera and sampled from its RGB image.
    // There is no projective/affine/local deformation that can stretch a photo.
    for(const fi of indices){const f=this.frames[fi],R=this.visualSolution?.transforms?.[fi],regQ=this.visualSolution?.confidence?.[fi]||0;if(!R||!visible.has(fi))continue;const box=frameCanvasBounds(f,R,width,height,bounds,{edgeSamples:12});if(!box)continue;
      for(let y=box.minY;y<=box.maxY;y++)for(let x=box.minX;x<=box.maxX;x++){const uv=canvasPointToPhotoPixel(f,R,x+.5,y+.5,width,height,bounds);if(!uv)continue;const u=uv.u,v=uv.v,rgb=sampleRgbBilinear(f,u,v);if(!rgb)continue;const un=u/Math.max(1,f.width-1),vn=v/Math.max(1,f.height-1),edge=Math.min(un,1-un,vn,1-vn),centreQ=clamp(edge/.18,0,1),q=Math.max(.08,regQ)*(.18+.82*centreQ),i=y*width+x,j=i*4,gain=f.photoGainRgb||[f.photoGain||1,f.photoGain||1,f.photoGain||1],r=clamp(rgb[0]*gain[0],0,255),g=clamp(rgb[1]*gain[1],0,255),b=clamp(rgb[2]*gain[2],0,255);
        if(!rgba[j+3]||q>score[i]*1.018){score[i]=q;rgba[j]=r;rgba[j+1]=g;rgba[j+2]=b;rgba[j+3]=255;}
        else if(q>score[i]*.94){const delta=Math.abs(r-rgba[j])+Math.abs(g-rgba[j+1])+Math.abs(b-rgba[j+2]);if(delta<24){const a=.12;rgba[j]=rgba[j]*(1-a)+r*a;rgba[j+1]=rgba[j+1]*(1-a)+g*a;rgba[j+2]=rgba[j+2]*(1-a)+b*a;rgba[j+3]=255;}}
      }
    }
    let covered=0;for(let i=0;i<width*height;i++)if(rgba[i*4+3])covered++;return {width,height,rgba,coverage:covered/(width*height),frameCenters:[],photoOnlyMosaic:true,projection:'spherical',bounds};
  }

  renderDepthAtlas(){
    this.recomputeVisualSolution();this.rebuildDepthConsensusIfNeeded();const width=this.width,height=this.height,largest=new Set(this.visualSolution?.component||[]),indices=this.renderIndices(largest),bounds=this.visualSolution?.bounds||computeMosaicBounds(this.frames,this.visualSolution?.transforms||[],{padding:.055});
    const globalRelative=(this.depthConsensus?.stats?.alignedFrames||0)>0,eligible=[];let metricUsed=0;
    for(const fi of indices){if(!largest.has(fi))continue;const f=this.frames[fi],R=this.visualSolution?.transforms?.[fi];if(!R)continue;if(globalRelative){if(!this.depthConsensus?.transforms?.[fi])continue;}else if(!this.frameHasMetricDepth(f))continue;eligible.push(fi);}
    // The RGB spherical masks define where a seam really is. Hann feathering is
    // enabled only when >=2 valid photo footprints overlap; a lone source keeps
    // full weight right to its border and therefore never loses coverage.
    const support=buildSphericalOverlapSupport(this.frames,eligible,this.visualSolution?.transforms||[],width,height,bounds),mixture=createProbabilisticDepthAtlas(width*height);
    for(const fi of eligible){const f=this.frames[fi],R=this.visualSolution?.transforms?.[fi],regQ=this.visualSolution?.confidence?.[fi]||0,consensusT=this.depthConsensus?.transforms?.[fi]||null,consensusQ=this.depthConsensus?.frameConfidence?.[fi]||0,box=support.boxes.get(fi)||frameCanvasBounds(f,R,width,height,bounds,{edgeSamples:12});if(!box)continue;
      for(let y=box.minY;y<=box.maxY;y++)for(let x=box.minX;x<=box.maxX;x++){
        const uv=canvasPointToPhotoPixel(f,R,x+.5,y+.5,width,height,bounds);if(!uv)continue;const u=uv.u,v=uv.v,i=y*width+x;let value,sigma,q,layerConfidence=1;
        if(globalRelative){const info=sampleConsensusDepthInfo(f,consensusT,u,v);if(!info)continue;value=info.value;sigma=info.sigma;layerConfidence=info.layerConfidence;q=Math.max(.006,consensusQ)*layerConfidence*(f.relativeQuality?.suspicious?.28:1)*(f.relativeQuality?.stripe?.suspicious?.35:1);}
        else{value=this.sampleMetricDepth(f,u,v);if(!(value>.08))continue;sigma=clamp(.025+.018*Math.abs(value),.025,.18);q=Math.max(.015,f.depthConfidence||f.metricConfidence||.02);metricUsed++;}
        const overlap=supportCountAt(support,x,y),hann=overlapHannWeight(u,v,f.width,f.height,overlap,{feather:.22,floor:.015}),sourceQ=q*Math.max(.10,regQ)*hann;
        addDepthObservation(mixture,i,value,sigma,sourceQ,{gate:2.75});
      }
    }
    const fused=resolveProbabilisticDepthAtlas(mixture),depth=fused.depth,score=fused.score,vals=[];for(let i=0;i<depth.length;i++)if(score[i]>0&&Number.isFinite(depth[i]))vals.push(depth[i]);vals.sort((a,b)=>a-b);
    let lo,hi;if(globalRelative&&this.depthConsensus?.globalRange){lo=this.depthConsensus.globalRange.lo;hi=this.depthConsensus.globalRange.hi;this.depthDisplayRange={lo,hi,root:this.depthConsensus.root};}else{lo=vals.length?vals[Math.floor(vals.length*.03)]:0;hi=vals.length?vals[Math.floor(vals.length*.97)]:1;}if(!(Number.isFinite(lo+hi))||hi-lo<1e-7){lo=0;hi=1;}
    const span=Math.max(1e-6,hi-lo),rgba=new Uint8ClampedArray(width*height*4);let covered=0,ambiguous=0,confSum=0;for(let i=0;i<depth.length;i++){if(!(score[i]>0)||!Number.isFinite(depth[i]))continue;const t=clamp((depth[i]-lo)/span,0,1),c=globalRelative?heatColor(t):heatColor(1-t),j=i*4,amb=clamp(fused.ambiguity[i],0,1),alphaQ=clamp(score[i]*(1-.62*amb),0,1);rgba[j]=c[0];rgba[j+1]=c[1];rgba[j+2]=c[2];rgba[j+3]=clamp(Math.round(85+170*alphaQ),0,255);covered++;confSum+=score[i];if(amb>.42)ambiguous++;}
    this.lastDepthFusionStats={covered,ambiguousFraction:covered?ambiguous/covered:0,meanPosterior:covered?confSum/covered:0,hannOverlap:true,bimodal:true,layerWise:!!globalRelative};
    return {width,height,rgba,coverage:covered/(width*height),depthMin:lo,depthMax:hi,frameCenters:[],depthMode:globalRelative?'relative-global-layerwise-hann-map':'metric-probabilistic-hann',projection:'spherical',bounds,metricSamples:metricUsed,ambiguityFraction:this.lastDepthFusionStats.ambiguousFraction};
  }

  sampleWorld(f,u,v,{allowFallback=true}={}){
    // Metric/world sampling is deliberately separate from the PHOTO mosaic.
    // A photo without an Alva pose remains fully usable by the 2-D stitcher.
    if(!f?.pose)return null;
    const ray=pixelRay(f.K,u,v),z=this.sampleMetricDepth(f,u,v);let optical=z,metric=true;if(!(optical>.08)){if(!allowFallback)return null;optical=clamp(f.fallbackDepth||this.fallbackDepth,.2,12);metric=false;}const range=optical/Math.max(.08,ray[2]),d=qRotate(f.pose.q,ray),p=[f.pose.p[0]+d[0]*range,f.pose.p[1]+d[1]*range,f.pose.p[2]+d[2]*range];return {p,r:distance(p,this.origin||[0,0,0]),metric};
  }

  sampleMetricDepth(f,u,v){
    if(f.metricDepth?.length){const z=bilinearImage(f.metricDepth,f.metricDepthWidth,f.metricDepthHeight,u/f.width*(f.metricDepthWidth-1),v/f.height*(f.metricDepthHeight-1));if(Number.isFinite(z)&&z>.08)return z;}
    const raw=this.sampleRelativeDepth(f,u,v),t=f.depthTransform;if(!t||!Number.isFinite(raw))return NaN;const z=predictDepth(t,raw);return Number.isFinite(z)&&z>.08&&z<30?z:NaN;
  }
  sampleRelativeDepth(f,u,v){if(!f.relativeDepth?.length)return NaN;return bilinearImage(f.relativeDepth,f.relativeDepthWidth,f.relativeDepthHeight,u/f.width*(f.relativeDepthWidth-1),v/f.height*(f.relativeDepthHeight-1));}
  frameHasMetricDepth(f){return !!(f?.metricDepth?.length||(f?.relativeDepth?.length&&f?.depthTransform?.mode&&(f.depthConfidence||0)>.004));}

  renderIndices(largest){const n=this.frames.length;if(n<=this.maxRenderFrames)return [...largest].sort((a,b)=>a-b);return [...largest].slice(-this.maxRenderFrames).sort((a,b)=>a-b);}
  frameCenters(bounds=null){this.recomputeVisualSolution();bounds=bounds||this.visualSolution?.bounds;return this.frames.map((f,i)=>{const G=this.visualSolution?.transforms?.[i];if(!G)return {i,x:-9999,y:-9999,connected:false,visual:false,depth:this.frameHasMetricDepth(f),rawDepth:!!f.relativeDepth?.length,pending:!!f.depthPending};const a=photoPixelToCanvas(f,G,f.width*.5,f.height*.5,this.width,this.height,bounds);return {i,x:a?.x??-9999,y:a?.y??-9999,connected:!!f.connected,visual:(this.visualSolution?.confidence?.[i]||0)>0,depth:this.frameHasMetricDepth(f),rawDepth:!!f.relativeDepth?.length,pending:!!f.depthPending};});}
  drawGraph(canvas,result){
    const ctx=canvas.getContext('2d'),sx=canvas.width/result.width,sy=canvas.height/result.height,centres=(result.frameCenters||[]).filter(c=>c.visual),by=new Map(centres.map(c=>[c.i,c]));ctx.save();ctx.lineWidth=Math.max(1,canvas.width/480);ctx.globalAlpha=.55;for(const e of this.edges){const a=by.get(e.a),b=by.get(e.b);if(!a||!b)continue;ctx.strokeStyle=e.loop?'#7be495':'#d7f2ff';ctx.beginPath();ctx.moveTo(a.x*sx,a.y*sy);ctx.lineTo(b.x*sx,b.y*sy);ctx.stroke();}ctx.globalAlpha=.95;for(const c of centres){ctx.fillStyle=c.depth?'#7be495':c.rawDepth?'#f7d774':'#61d6ff';ctx.beginPath();ctx.arc(c.x*sx,c.y*sy,c.depth?2.9:c.pending?1.8:2.2,0,Math.PI*2);ctx.fill();}ctx.restore();
  }

  connectNewest(){this.connectFrame(this.frames.length-1);}
  connectFrame(j){
    if(j<=0||j>=this.frames.length||!hasDepthEvidence(this.frames[j]))return;const candidates=new Set(),rootBefore=new Set(this.rootComponent());for(let i=Math.max(0,j-this.temporalRadius);i<j;i++)if(hasDepthEvidence(this.frames[i]))candidates.add(i);
    // Keep several recent members of the already visible component in the pool.
    // This is the panorama-stitcher equivalent of matching against neighbouring
    // keyframes rather than trusting a single predecessor.
    [...rootBefore].filter(i=>i<j&&hasDepthEvidence(this.frames[i])).sort((a,b)=>b-a).slice(0,Math.max(4,Math.ceil(this.temporalRadius*.75))).forEach(i=>candidates.add(i));
    const ranked=this.rankAppearanceCandidates(j,[...Array(j).keys()].filter(i=>hasDepthEvidence(this.frames[i])&&!candidates.has(i)),this.maxLoopCandidates);for(const x of ranked)candidates.add(x.i);
    let added=0;for(const i of candidates)if(this.tryConnectPair(i,j,false))added++;
    this.recomputeConnectivity();let rootNow=new Set(this.rootComponent());
    if(!rootNow.has(j)){
      // Recovery pass: a weak/blurred frame must not permanently break the chain.
      // First rank by appearance, exactly as a panorama stitcher would shortlist
      // candidate images, but validate every accepted edge on calibrated rays.
      const pool=[...rootNow].filter(i=>i<j&&hasDepthEvidence(this.frames[i])),recovery=this.rankAppearanceCandidates(j,pool,this.maxRecoveryCandidates,true);for(const x of recovery){if(this.tryConnectPair(x.i,j,true)){added++;this.recomputeConnectivity();rootNow=new Set(this.rootComponent());if(rootNow.has(j)&&added>=2)break;}}
      // Appearance hashes/descriptors can themselves fail after blur, exposure or
      // scale change.  Only when normal recovery failed, perform a bounded
      // exhaustive relocalisation against recent photos of the visible component.
      // This costs CPU only on a broken chain and is far preferable to placing a
      // frame arbitrarily.  Geometry is still the rigid spherical rotation fit.
      if(!rootNow.has(j)){const emergency=pool.slice().sort((a,b)=>b-a).slice(0,Math.min(30,Math.max(this.maxRecoveryCandidates,24)));for(const i of emergency){if(this.tryConnectPair(i,j,true)){added++;this.recomputeConnectivity();rootNow=new Set(this.rootComponent());if(rootNow.has(j))break;}}}
    }
    if(rootNow.has(j))this.recoverRecentOrphans(j);this.depthScaleDirty=true;this.depthConsensusDirty=true;this.visualDirty=true;
  }
  rankAppearanceCandidates(j,pool,max=6,recovery=false){const target=this.frames[j],scored=[];for(const i of pool||[]){const s=photoAppearanceSimilarity(this.frames[i],target,{maxFeatures:recovery?120:88,maxHamming:recovery?70:62}),recency=1/(1+Math.max(0,j-i-1)*.04);scored.push({i,score:s*(.82+.18*recency)});}return scored.sort((a,b)=>b.score-a.score||b.i-a.i).slice(0,max);}
  tryConnectPair(i,j,recovery=false){if(i===j||this.edges.some(e=>(e.a===i&&e.b===j)||(e.a===j&&e.b===i)))return false;const e=this.matchPair(i,j,{recovery});if(!e)return false;this.edges.push(e);this.adj.get(i)?.push(e);this.adj.get(j)?.push(e);return true;}
  matchPair(i,j,{recovery=false}={}){
    const a=this.frames[i],b=this.frames[j];if(!hasDepthEvidence(a)||!hasDepthEvidence(b))return null;const far=Math.abs(i-j)>this.temporalRadius+1,raw=matchPhotoFeatures(a,b,{maxFeatures:recovery?460:360,maxMatches:recovery?240:190,maxHamming:recovery?82:72,minProbability:recovery?.012:.022,patchRadius:recovery?3:2}),candidate=raw.filter(x=>x.probability>=(recovery?.018:Math.min(this.minEdgeProbability,.085)));if(candidate.length<this.minEdgeMatches)return null;
    const reg=buildPhotoRegistrationEdge(a,b,candidate,{minMatches:this.minEdgeMatches,angularThresholdDeg:recovery?(far?6.0:5.2):(far?4.6:3.7),recovery});if(!reg||!reliablePhotoOverlap(reg,a,b,{far,minMatches:this.minEdgeMatches,recovery}))return null;const gain=estimateExposureGain(a,b,reg.matches),gainRGB=estimateExposureGainRGB(a,b,reg.matches);return {a:i,b:j,aId:a.frameId,bId:b.frameId,...reg,weight:reg.visualConfidence,loop:far,gainAB:gain,gainRGB,recovery:!!recovery,registration:reg.registration||'photo-spherical-rotation-irls'};
  }
  recoverRecentOrphans(anchor){let root=new Set(this.rootComponent()),tries=0;for(let k=Math.max(1,anchor-this.temporalRadius*3);k<anchor&&tries<10;k++){if(root.has(k)||!hasDepthEvidence(this.frames[k]))continue;tries++;if(this.tryConnectPair(k,anchor,true)){this.recomputeConnectivity();root=new Set(this.rootComponent());}}
  }
  components(){const seen=new Set(),out=[];for(let s=0;s<this.frames.length;s++){if(seen.has(s))continue;const q=[s],c=[];seen.add(s);while(q.length){const i=q.pop();c.push(i);for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(!seen.has(j)){seen.add(j);q.push(j);}}}out.push(c);}return out.sort((a,b)=>b.length-a.length);}
  rootComponent(){
    // The first captured photograph is often a pre-init/no-Depth frame.  It
    // can legitimately stay isolated while a later, well-connected component
    // contains the usable panorama.  Pinning visibility to index 0 therefore
    // made a healthy mosaic report one connected frame and discarded its
    // visual/depth consensus.  Select the evidence-rich component instead.
    const comps=this.components();if(!comps.length)return [];
    const score=c=>{let depth=0,rawDepth=0,edges=0,confidence=0;for(const i of c){const f=this.frames[i];if(this.frameHasMetricDepth(f))depth++;if(f?.relativeDepth?.length)rawDepth++;for(const e of this.adj.get(i)||[]){if(e.a===i)edges++;confidence+=Number(e.visualConfidence??e.weight??0);}}return 6*c.length+5*depth+3*rawDepth+2*edges+.25*confidence;};
    return comps.slice().sort((a,b)=>score(b)-score(a)||b.length-a.length||Math.min(...a)-Math.min(...b))[0];
  }
  rootIndex(component=this.rootComponent()){
    if(!component?.length)return -1;
    const score=i=>{const f=this.frames[i],degree=(this.adj.get(i)||[]).length,depth=this.frameHasMetricDepth(f)?1:0,raw=f?.relativeDepth?.length?1:0,q=Number(f?.relativeConfidence??f?.metricConfidence??0);return 5*degree+3*depth+2*raw+q;};
    return component.slice().sort((a,b)=>score(b)-score(a)||b-a)[0];
  }
  recomputeConnectivity(){const visible=new Set(this.rootComponent());this.frames.forEach((f,i)=>f.connected=visible.has(i));}
  recomputeVisualSolution(persisted=null){
    if(!persisted&&!this.visualDirty&&this.visualSolution)return;if(!this.frames.length){this.visualSolution=null;this.visualDirty=false;return;}
    const preferredComponent=this.rootComponent(),preferredRoot=this.rootIndex(preferredComponent),saved=persisted?.sphericalRotations||((persisted?.projection==='spherical'||['ROOMSCAN-LIVE-PHOTO-MOSAIC-4','ROOMSCAN-LIVE-PHOTO-MOSAIC-5'].includes(persisted?.format))?persisted?.mosaicTransforms:null),savedRoot=Number.isInteger(persisted?.rootIndex)?persisted.rootIndex:null;
    if(Array.isArray(saved)&&saved.length===this.frames.length&&savedRoot===preferredRoot){const confidence=Float32Array.from(persisted.visualConfidence||saved.map((R,i)=>R?i===preferredRoot?1:.25:0));this.visualSolution={transforms:saved.map(R=>Array.isArray(R)&&R.length===9?R.map(Number):null),confidence,rootIndex:preferredRoot,parent:new Int32Array(this.frames.length),component:preferredComponent,projection:'spherical'};}
    else this.visualSolution=solvePhotoMosaic(this.frames,this.edges,{iterations:10,rootIndex:preferredRoot});
    this.visualSolution.bounds=computeMosaicBounds(this.frames,this.visualSolution.transforms,{padding:.055});this.frames.forEach((f,i)=>{f.mosaicR=this.visualSolution.transforms[i];f.mosaicH=null;f.visualConfidence=this.visualSolution.confidence[i];});this.visualDirty=false;
  }

  rebuildDepthConsensusIfNeeded(){
    if(!this.depthConsensusDirty)return;this.depthConsensusDirty=false;this.depthConsensus=solvePhotoDepthConsensus(this.frames,this.edges,{minPairs:this.depthMinPairs,maxPairs:240,rootIndex:this.visualSolution?.rootIndex??0,irlsIterations:14});
  }
  exportState(){
    this.recomputeVisualSolution();this.rebuildDepthConsensusIfNeeded();const rotations=(this.visualSolution?.transforms||[]).map(R=>R?Array.from(R):null);
    return {format:'ROOMSCAN-LIVE-PHOTO-MOSAIC-5',photoOnlyMosaic:true,projection:'spherical',stats:this.stats(),rootIndex:this.visualSolution?.rootIndex??0,sphericalRotations:rotations,mosaicTransforms:rotations,visualConfidence:Array.from(this.visualSolution?.confidence||[]),frames:this.frames.map((f,i)=>({frameId:String(f.frameId),alvaPose:clonePoseNullable(f.pose),poseCov:f.poseCov||null,K:{...f.K},width:f.width,height:f.height,at:f.at||0,sphericalR:this.visualSolution?.transforms?.[i]?Array.from(this.visualSolution.transforms[i]):null,visualConfidence:Number(this.visualSolution?.confidence?.[i]||0),hasRawDepth:!!f.relativeDepth?.length,hasMetricDepth:this.frameHasMetricDepth(f),photoGainRgb:(f.photoGainRgb||[1,1,1]).slice(0,3)})),edges:this.edges.map(e=>({a:e.a,b:e.b,aId:e.aId,bId:e.bId,loop:!!e.loop,rotationBToA:Array.from(e.rotationBToA||[]),visualConfidence:e.visualConfidence||0,rotationMedianErrorDeg:e.rotationMedianErrorDeg??null,rotationP90ErrorDeg:e.rotationP90ErrorDeg??null,gainAB:e.gainAB??1,gainRGB:normaliseGainRGB(e.gainRGB,e.gainAB),matches:(e.matches||[]).slice(0,180).map(m=>({aU:m.aU,aV:m.aV,bU:m.bU,bV:m.bV,probability:m.probability,photometricProbability:m.photometricProbability,uniquenessProbability:m.uniquenessProbability}))})),depthConsensus:this.depthConsensus?{format:this.depthConsensus.format,representation:this.depthConsensus.representation,root:this.depthConsensus.root,stats:this.depthConsensus.stats,globalRange:this.depthConsensus.globalRange,transforms:this.depthConsensus.transforms.map(serializeDepthTransfer),frameConfidence:Array.from(this.depthConsensus.frameConfidence),edges:this.depthConsensus.edges}:null};
  }

  recomputeOrigin(){
    // Intentionally fixed. A moving mean-camera origin makes already pasted RGB
    // slide on every new frame and looks like registration blur. Depth-aware
    // reprojection already accounts for parallax from translated cameras.
    if(!this.origin){const f=this.frames.find(x=>x.pose?.p);if(f)this.origin=f.pose.p.slice(0,3).map(Number);}
  }
  recomputePhotoGains(){
    if(!this.frames.length)return;const comp=this.rootComponent();if(!comp.length)return;const root=this.rootIndex(comp),known=new Uint8Array(this.frames.length);known[root]=1;
    // Brown/Lowe-style exposure compensation, but solved independently per RGB
    // channel.  This absorbs auto-exposure/white-balance drift without changing
    // panorama geometry or blurring textures across a seam.
    const logs=[new Float64Array(this.frames.length),new Float64Array(this.frames.length),new Float64Array(this.frames.length)],q=[root];
    while(q.length){const i=q.shift();for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(known[j])continue;const gains=normaliseGainRGB(e.gainRGB,e.gainAB);for(let c=0;c<3;c++){const l=Math.log(clamp(gains[c],.52,1.9));logs[c][j]=e.a===i?logs[c][i]+l:logs[c][i]-l;}known[j]=1;q.push(j);}}
    for(let it=0;it<12;it++)for(const i of comp){if(i===root)continue;for(let c=0;c<3;c++){let sw=.02,sum=0;for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(!known[j])continue;const gains=normaliseGainRGB(e.gainRGB,e.gainAB),l=Math.log(clamp(gains[c],.52,1.9)),target=e.a===i?logs[c][j]-l:logs[c][j]+l,w=Math.max(.004,Number(e.visualConfidence||e.weight||.05));sw+=w;sum+=w*target;}if(sw>.021)logs[c][i]=logs[c][i]*.28+(sum/sw)*.72;}}
    for(let i=0;i<this.frames.length;i++){const g=known[i]?logs.map(x=>clamp(Math.exp(x[i]),.55,1.75)):[1,1,1];this.frames[i].photoGainRgb=g;this.frames[i].photoGain=(g[0]+g[1]+g[2])/3;}
  }
  dropOldest(){
    this.frames.shift();this.frameMap.clear();this.frames.forEach((f,i)=>this.frameMap.set(String(f.frameId),i));this.edges=this.edges.filter(e=>e.a>0&&e.b>0).map(e=>({...e,a:e.a-1,b:e.b-1}));this.adj=new Map(this.frames.map((_,i)=>[i,[]]));for(const e of this.edges){this.adj.get(e.a)?.push(e);this.adj.get(e.b)?.push(e);}this.depthScaleDirty=true;this.depthConsensusDirty=true;this.visualDirty=true;this.recomputeVisualSolution();
  }

  rebuildDepthScaleIfNeeded(){
    if(!this.depthScaleDirty)return;this.depthScaleDirty=false;this.depthScaleStats=null;this.depthScaleModel=null;this.depthScaleTransforms=new Map();for(const f of this.frames){f.depthTransform=null;f.depthConfidence=f.metricDepth?.length?f.metricConfidence:0;}
    const metricIndices=this.frames.map((f,i)=>f.pose?.p&&f.pose?.q?i:-1).filter(i=>i>=0),metricSet=new Set(metricIndices),deepFrames=this.frames.filter((f,i)=>metricSet.has(i)&&f.relativeDepth?.length);if(!deepFrames.length||metricIndices.length<2||!this.edges.length)return;
    try{
      const frames=this.frames.filter((_,i)=>metricSet.has(i)),indexMap=new Map(metricIndices.map((old,i)=>[old,i])),metricEdges=this.edges.filter(e=>metricSet.has(e.a)&&metricSet.has(e.b)).map(e=>({...e,a:indexMap.get(e.a),b:indexMap.get(e.b)}));if(!metricEdges.length)return;
      const graph={format:'ROOMSCAN-PROB-GRAPH-1',frames:frames.map(f=>({frameId:String(f.frameId),posePrior:clonePoseNullable(f.pose),poseEstimate:clonePoseNullable(f.pose),poseCov:f.poseCov||null,K:{...f.K},width:f.width,height:f.height})),landmarkFactors:[],deepFactors:deepFrames.map(f=>({frameId:String(f.frameId),cols:f.relativeDepthWidth,rows:f.relativeDepthHeight,raw:f.relativeDepth,rawWidth:f.relativeDepthWidth,rawHeight:f.relativeDepthHeight,calibration:f.metricCalibration||null,quality:f.relativeQuality||null})),mvsFactors:[]};
      const tmpAdj=new Map(frames.map((_,i)=>[i,[]]));for(const e of metricEdges){tmpAdj.get(e.a).push(e);tmpAdj.get(e.b).push(e);}const puzzle={frames,edges:metricEdges,components:[frames.map((_,i)=>i)],stats:{largestComponent:frames.length,connectedFraction:1}};
      const dsg=new DepthScaleGraph(graph,puzzle,{minPairs:this.depthMinPairs,regularizeIterations:this.depthRegularizeIterations}).build();this.depthScaleStats=dsg.stats;this.depthScaleModel=dsg.metricModel;this.depthScaleTransforms=dsg.transforms;
      for(const f of this.frames){const t=dsg.transforms.get(String(f.frameId));if(!t)continue;f.depthTransform=t;f.depthConfidence=Math.max(f.metricConfidence||0,dsg.frameConfidence(String(f.frameId)));const z=this.sampleMetricDepth(f,f.K.cx,f.K.cy);if(Number.isFinite(z)&&z>.08&&z<20){f.fallbackDepth=z;this.fallbackDepth=this.fallbackDepth*.94+z*.06;}}
    }catch(err){this.depthScaleStats={error:err?.message||String(err),metricRelativeError:Infinity,alignedFrames:0,metricPairs:0};}
  }
}

export function backProjectOpticalZ(pose,K,u,v,z){const ray=pixelRay(K,u,v),range=z/Math.max(.08,ray[2]),d=qRotate(pose.q,ray);return [pose.p[0]+d[0]*range,pose.p[1]+d[1]*range,pose.p[2]+d[2]*range];}
export function worldToAtlas(p,origin,width,height){const d=[p[0]-origin[0],p[1]-origin[1],p[2]-origin[2]],n=Math.hypot(...d)||1,yaw=Math.atan2(d[0],d[2]),pitch=Math.asin(clamp(d[1]/n,-1,1));return {x:wrap((yaw/(2*Math.PI)+.5)*width,width),y:clamp((pitch/Math.PI+.5)*height,0,height-1),r:n};}
export function predictDepth(transform,raw){if(!transform||!Number.isFinite(raw))return NaN;if(transform.mode==='direct')return transform.a*raw+transform.b;if(transform.mode==='inverse-raw')return transform.a/Math.max(EPS,Math.abs(raw))+transform.b;if(transform.mode==='inverse-depth'){const q=transform.a*raw+transform.b;return q>EPS?1/q:NaN;}return NaN;}

function buildSphericalOverlapSupport(frames,indices,transforms,width,height,bounds){
  const step=width*height>110000?2:1,sw=Math.ceil(width/step),sh=Math.ceil(height/step),count=new Uint8Array(sw*sh),boxes=new Map();
  for(const fi of indices){const f=frames[fi],R=transforms?.[fi];if(!f||!R)continue;const box=frameCanvasBounds(f,R,width,height,bounds,{edgeSamples:12});if(!box)continue;boxes.set(fi,box);const minX=Math.floor(box.minX/step),maxX=Math.ceil(box.maxX/step),minY=Math.floor(box.minY/step),maxY=Math.ceil(box.maxY/step);for(let sy=minY;sy<=maxY;sy++)for(let sx=minX;sx<=maxX;sx++){if(sx<0||sy<0||sx>=sw||sy>=sh)continue;const x=Math.min(width-1,sx*step+.5*step),y=Math.min(height-1,sy*step+.5*step),uv=canvasPointToPhotoPixel(f,R,x,y,width,height,bounds);if(!uv)continue;const i=sy*sw+sx;if(count[i]<255)count[i]++;}}
  return {count,boxes,step,sw,sh};
}
function supportCountAt(s,x,y){const sx=clamp(Math.floor(x/s.step),0,s.sw-1),sy=clamp(Math.floor(y/s.step),0,s.sh-1);return s.count[sy*s.sw+sx]||0;}

function serializeDepthTransfer(t){if(!t)return null;if(t.type?.includes('pwl'))return {type:t.type,xKnots:Array.from(t.xKnots||[]),yKnots:Array.from(t.yKnots||[]),knotConfidence:Array.from(t.knotConfidence||[]),residualSigma:t.residualSigma??null,support:t.support||0,layerSupport:t.layerSupport||0,gauge:!!t.gauge};if(Number.isFinite(t.a)&&Number.isFinite(t.b))return {a:t.a,b:t.b};return null;}

function hasDepthEvidence(f){return !!(f?.relativeDepth?.length||f?.metricDepth?.length);}

function sampleRgbBilinear(f,x,y){if(!f?.rgb?.length||x<0||y<0||x>f.width-1||y>f.height-1)return null;const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(f.width-1,x0+1),y1=Math.min(f.height-1,y0+1),tx=x-x0,ty=y-y0,out=[0,0,0];for(let c=0;c<3;c++){const a=f.rgb[(y0*f.width+x0)*3+c],b=f.rgb[(y0*f.width+x1)*3+c],d=f.rgb[(y1*f.width+x0)*3+c],e=f.rgb[(y1*f.width+x1)*3+c];out[c]=a*(1-tx)*(1-ty)+b*tx*(1-ty)+d*(1-tx)*ty+e*tx*ty;}return out;}

export function reliablePhotoOverlap(reg,a,b,{far=false,minMatches=6,recovery=false}={}){
  const m=reg?.matches||[],n=m.length,total=Math.max(n,Number(reg?.allPhotoMatches)||n),minInliers=Math.max(recovery?9:8,minMatches),minRatio=recovery?.20:.28;if(n<minInliers||n/Math.max(1,total)<minRatio)return false;
  const maxMed=recovery?(far?5.8:5.0):(far?4.3:3.5),maxP90=recovery?(far?8.5:7.3):(far?6.8:5.8),minQ=recovery?.012:.025;if(!Number.isFinite(reg.rotationMedianErrorDeg)||reg.rotationMedianErrorDeg>maxMed||!Number.isFinite(reg.rotationP90ErrorDeg)||reg.rotationP90ErrorDeg>maxP90||Number(reg.visualConfidence||0)<minQ)return false;
  const spread=(keyU,keyV,w,h)=>{const xs=m.map(x=>x[keyU]/Math.max(1,w)).sort((x,y)=>x-y),ys=m.map(x=>x[keyV]/Math.max(1,h)).sort((x,y)=>x-y),lo=Math.floor((n-1)*.08),hi=Math.ceil((n-1)*.92);return [Math.max(0,xs[hi]-xs[lo]),Math.max(0,ys[hi]-ys[lo])];};
  const [ax,ay]=spread('aU','aV',a.width,a.height),[bx,by]=spread('bU','bV',b.width,b.height),minAxis=recovery?.055:.075,minSpan=recovery?.20:.27;if(Math.min(ax,bx)<minAxis||Math.min(ay,by)<minAxis||Math.max(ax,ay)<minSpan||Math.max(bx,by)<minSpan)return false;
  // A spherical edge has only 3 rotational DOF, so there is no projective area
  // or corner distortion to validate. Limit only implausible jumps for temporal
  // neighbours; loop closures may legitimately approach 180 degrees.
  const ang=Math.abs(Number(reg.rotationAngleDeg||0));if(!far&&!recovery&&ang>72)return false;if(!far&&recovery&&ang>95)return false;return true;
}

function compactCameraFrame(frame,maxSide){
  if(!frame?.frameId||!frame?.K||!frame?.gray?.length||!(frame.width>0&&frame.height>0))return null;const sw=frame.width,sh=frame.height,scale=Math.min(1,Math.max(96,+maxSide||256)/Math.max(sw,sh)),w=Math.max(32,Math.round(sw*scale)),h=Math.max(32,Math.round(sh*scale)),gray=new Uint8Array(w*h),rgb=new Uint8Array(w*h*3),sx=sw/w,sy=sh/h,rgba=frame.rgba;
  for(let y=0;y<h;y++){const yy=Math.min(sh-1,Math.floor((y+.5)*sy));for(let x=0;x<w;x++){const xx=Math.min(sw-1,Math.floor((x+.5)*sx)),si=yy*sw+xx,di=y*w+x;gray[di]=frame.gray[si];if(rgba?.length>=sw*sh*4){rgb[di*3]=rgba[si*4];rgb[di*3+1]=rgba[si*4+1];rgb[di*3+2]=rgba[si*4+2];}else rgb[di*3]=rgb[di*3+1]=rgb[di*3+2]=gray[di];}}
  const K={fx:frame.K.fx*w/sw,fy:frame.K.fy*h/sh,cx:frame.K.cx*w/sw,cy:frame.K.cy*h/sh,width:w,height:h},features=detectPhotoFeatures(gray,w,h,{maxFeatures:440});
  return {frameId:String(frame.frameId),pose:clonePoseNullable(frame.pose),poseCov:frame.poseCov||null,K,width:w,height:h,gray,rgb,features,at:Number(frame.at||frame.captureAt||0),metricLocked:!!frame.metricLocked,trackingMode:frame.trackingMode||null};
}
function compactDepth(depth,w,h,maxSide,metric){const scale=Math.min(1,Math.max(48,+maxSide||168)/Math.max(w,h)),dw=Math.max(16,Math.round(w*scale)),dh=Math.max(16,Math.round(h*scale)),out=new Float32Array(dw*dh),vals=[];let good=0;for(let y=0;y<dh;y++){const sy=(y+.5)*h/dh-.5;for(let x=0;x<dw;x++){const sx=(x+.5)*w/dw-.5,v=bilinearImage(depth,w,h,sx,sy),i=y*dw+x;if(Number.isFinite(v)&&(metric?v>.08:Math.abs(v)>1e-9)&&(metric?v<30:true)){out[i]=v;good++;if((i&15)===0&&metric)vals.push(v);}else out[i]=NaN;}}vals.sort((a,b)=>a-b);return {depth:out,width:dw,height:dh,validRatio:good/Math.max(1,out.length),median:vals.length?vals[vals.length>>1]:NaN};}
function normaliseCalibration(c){if(!c||!c.ok||!['direct','inverse-raw','inverse-depth'].includes(c.mode)||!Number.isFinite(+c.a)||!Number.isFinite(+c.b))return null;return {ok:true,mode:c.mode,a:+c.a,b:+c.b,confidence:clamp(Number(c.posteriorConfidence??c.confidence??.05),.005,1),posteriorConfidence:clamp(Number(c.posteriorConfidence??c.confidence??.05),.005,1)};}
function compactQuality(q){return {suspicious:!!q?.suspicious,coherenceRatio:+(q?.coherenceRatio||0),stripe:{suspicious:!!q?.stripe?.suspicious,dominantExplained:+(q?.stripe?.dominantExplained||0),dominantCycles:+(q?.stripe?.dominantCycles||0)}};}
function estimateExposureGain(a,b,matches){const ratios=[];for(const m of matches){const va=sampleGray(a,m.aU,m.aV),vb=sampleGray(b,m.bU,m.bV);if(va>18&&vb>18&&va<245&&vb<245)ratios.push(va/vb);}if(ratios.length<3)return 1;ratios.sort((x,y)=>x-y);return clamp(ratios[ratios.length>>1],.65,1.5);}
function estimateExposureGainRGB(a,b,matches){const ratios=[[],[],[]];for(const m of matches){const ca=sampleRgbBilinear(a,m.aU,m.aV),cb=sampleRgbBilinear(b,m.bU,m.bV);if(!ca||!cb)continue;for(let c=0;c<3;c++)if(ca[c]>16&&cb[c]>16&&ca[c]<246&&cb[c]<246)ratios[c].push(ca[c]/cb[c]);}return ratios.map(r=>{if(r.length<4)return 1;r.sort((x,y)=>x-y);const lo=Math.floor(r.length*.15),hi=Math.max(lo+1,Math.ceil(r.length*.85)),mid=r.slice(lo,hi);return clamp(mid[mid.length>>1],.58,1.72);});}
function normaliseGainRGB(g,scalar=1){return Array.isArray(g)&&g.length>=3?g.slice(0,3).map((x)=>clamp(Number(x)||1,.52,1.9)):[scalar,scalar,scalar].map(x=>clamp(Number(x)||1,.52,1.9));}
function sampleGray(f,x,y){const xx=clamp(Math.round(x),0,f.width-1),yy=clamp(Math.round(y),0,f.height-1);return f.gray[yy*f.width+xx]||0;}

function splatPanoramaSharp(rgba,score,w,h,x,y,color,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.015)continue;const xx=clamp(xi+dx,0,w-1),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,j=i*4,qq=q*bw;if(!rgba[j+3]||qq>score[i]*1.025){score[i]=qq;rgba[j]=clamp(color[0],0,255);rgba[j+1]=clamp(color[1],0,255);rgba[j+2]=clamp(color[2],0,255);rgba[j+3]=clamp(75+qq*180,55,255);}else if(qq>score[i]*.90){const dr=Math.abs(rgba[j]-color[0])+Math.abs(rgba[j+1]-color[1])+Math.abs(rgba[j+2]-color[2]);if(dr<28){const a=.035;rgba[j]=rgba[j]*(1-a)+color[0]*a;rgba[j+1]=rgba[j+1]*(1-a)+color[1]*a;rgba[j+2]=rgba[j+2]*(1-a)+color[2]*a;}}}}
function splatDepthBest(depth,score,w,h,x,y,value,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.02)continue;const xx=clamp(xi+dx,0,w-1),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,qq=q*bw;if(!(score[i]>0)||qq>score[i]*1.04){depth[i]=value;score[i]=qq;}else if(qq>score[i]*.82&&Math.abs(value-depth[i])<Math.max(1e-4,.06*Math.max(Math.abs(value),Math.abs(depth[i])))){const a=qq/(score[i]+qq+EPS);depth[i]=depth[i]*(1-a)+value*a;score[i]=Math.max(score[i],qq);}}}
function fuseDepthValue(depth,score,i,value,q){if(!Number.isFinite(value)||!(q>0))return;if(!(score[i]>0)){depth[i]=value;score[i]=q;return;}const old=depth[i],span=Math.max(1e-4,.08*Math.max(1,Math.abs(old),Math.abs(value))),delta=Math.abs(value-old);if(delta<=span){const w0=score[i],s=w0+q;depth[i]=(old*w0+value*q)/Math.max(EPS,s);score[i]=Math.min(1.5,s);}else if(q>score[i]*1.35){depth[i]=value;score[i]=q;}else score[i]*=.995;}
function imageHash(f){if(!f?.gray?.length)return 0n;let bits=0n,k=0n;for(let y=0;y<8;y++){const yy=Math.min(f.height-1,Math.floor((y+.5)*f.height/8));for(let x=0;x<8;x++){const a=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+.35)*f.width/9))],b=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+1.35)*f.width/9))];if(a>b)bits|=1n<<k;k++;}}return bits;}
function hashDistance(a,b){let x=a^b,n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;}
function splatPhotoSharp(rgba,radial,score,metricMask,w,h,x,y,r,color,q,metric){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.015)continue;const xx=clamp(xi+dx,0,w-1),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,j=i*4,qq=q*bw,oldMetric=metricMask[i]===1,oldR=radial[i],sameSurface=Number.isFinite(oldR)&&Math.abs(r-oldR)<Math.max(.035,.035*Math.min(r,oldR)),nearer=!Number.isFinite(oldR)||r<oldR-Math.max(.06,.035*r);let replace=false;
    if(!rgba[j+3])replace=true;else if(metric&&!oldMetric)replace=true;else if(!metric&&oldMetric)replace=false;else if(metric&&oldMetric&&!sameSurface)replace=nearer&&qq>score[i]*.42;else replace=qq>score[i]*1.025;
    if(replace){radial[i]=r;score[i]=qq;metricMask[i]=metric?1:0;rgba[j]=clamp(color[0],0,255);rgba[j+1]=clamp(color[1],0,255);rgba[j+2]=clamp(color[2],0,255);rgba[j+3]=metric?clamp(125+qq*130,0,255):clamp(42+qq*120,0,120);}
    else if(metric===oldMetric&&sameSurface&&qq>score[i]*.72){const dr=Math.abs(rgba[j]-color[0])+Math.abs(rgba[j+1]-color[1])+Math.abs(rgba[j+2]-color[2]);if(dr<38){const a=.08*qq/(score[i]+qq+EPS);rgba[j]=rgba[j]*(1-a)+color[0]*a;rgba[j+1]=rgba[j+1]*(1-a)+color[1]*a;rgba[j+2]=rgba[j+2]*(1-a)+color[2]*a;}}
  }}
function splatDepth(depth,weight,radial,w,h,x,y,r,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.02)continue;const xx=clamp(xi+dx,0,w-1),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,ww=q*bw;if(!Number.isFinite(radial[i])||r<radial[i]-.08){radial[i]=r;depth[i]=r;weight[i]=ww;}else if(Math.abs(r-radial[i])<Math.max(.04,.025*r)){const s=weight[i]+ww;depth[i]=(depth[i]*weight[i]+r*ww)/Math.max(EPS,s);weight[i]=s;}}}
function fillTinyHoles(rgba,w,h){const src=new Uint8ClampedArray(rgba);for(let y=1;y<h-1;y++)for(let x=0;x<w;x++){const i=y*w+x;if(src[i*4+3])continue;let r=0,g=0,b=0,a=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=clamp(x+dx,0,w-1),j=((y+dy)*w+xx)*4;if(src[j+3]>60){r+=src[j];g+=src[j+1];b+=src[j+2];a+=src[j+3];n++;}}if(n>=7){rgba[i*4]=r/n;rgba[i*4+1]=g/n;rgba[i*4+2]=b/n;rgba[i*4+3]=Math.min(150,a/n);}}}
function drawAtlas(canvas,a){const dpr=Math.min(2,globalThis.devicePixelRatio||1),rect=canvas.getBoundingClientRect(),cw=Math.max(1,Math.round((rect.width||a.width)*dpr)),ch=Math.max(1,Math.round((rect.height||a.height)*dpr));if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}const tmp=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(a.width,a.height):document.createElement('canvas');tmp.width=a.width;tmp.height=a.height;const g=tmp.getContext('2d'),img=new ImageData(a.rgba instanceof Uint8ClampedArray?a.rgba:new Uint8ClampedArray(a.rgba),a.width,a.height);g.putImageData(img,0,0);const out=canvas.getContext('2d');out.clearRect(0,0,cw,ch);out.imageSmoothingEnabled=true;out.drawImage(tmp,0,0,cw,ch);}
function heatColor(t){const x=clamp(t,0,1),r=Math.round(255*clamp(1.8-Math.abs(4*x-3),0,1)),g=Math.round(255*clamp(1.8-Math.abs(4*x-2),0,1)),b=Math.round(255*clamp(1.8-Math.abs(4*x-1),0,1));return [r,g,b];}
function clonePoseNullable(p){return p?.p&&p?.q?{p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)}:null;}
function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function wrap(x,n){x%=n;return x<0?x+n:x;}
function bilinearImage(a,w,h,x,y){if(!a?.length||!(w>0&&h>0))return NaN;x=clamp(x,0,w-1);y=clamp(y,0,h-1);const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,v00=a[y0*w+x0],v10=a[y0*w+x1],v01=a[y1*w+x0],v11=a[y1*w+x1];const vals=[[v00,(1-tx)*(1-ty)],[v10,tx*(1-ty)],[v01,(1-tx)*ty],[v11,tx*ty]].filter(([v])=>Number.isFinite(v));if(!vals.length)return NaN;let sw=0,s=0;for(const [v,ww] of vals){sw+=ww;s+=v*ww;}return sw>EPS?s/sw:vals[0][0];}
