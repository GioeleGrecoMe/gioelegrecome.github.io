import {normalizeFrame} from './view_puzzle.js';
import {DepthScaleGraph} from './depth_scale_graph.js';
import {pixelRay,qRotate} from '../slam/math.js';
import {matchPhotoFeatures,buildPhotoRegistrationEdge,solvePhotoMosaic,visualAlvaDiagnostics,buildLocalMosaicWarp,photoPixelToCanvas,computeMosaicBounds,detectPhotoFeatures} from './photo_panorama.js';
import {solvePhotoDepthConsensus,sampleConsensusDepth} from './photo_depth_consensus.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-8;

/**
 * Live PHOTO-only mosaic + depth evidence monitor.
 *
 * Every survey photograph is frozen on the exact camera frame sent to Deep.
 * The mosaic is observable with or without AlvaAR: corners, descriptors, pairwise
 * registration, global placement and local parallax correction all come from the
 * photographs themselves.  A valid Alva pose may be attached as optional metadata
 * for the unchanged metric/3-D path, but it has zero authority over the photo map.
 *
 * Pairwise photo homographies seed a global 2-D mosaic graph. Loop closures are
 * redistributed by a correspondence bundle refinement, then a spatially-varying
 * local warp absorbs residual parallax. Disconnected photos are not invented into
 * the panorama: they remain pending until a real photographic overlap is found.
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
    width=640,height=320,maxFrames=90,maxRenderFrames=64,temporalRadius=4,
    maxLoopCandidates=2,minEdgeMatches=6,minEdgeProbability=.10,
    maxWorldSamples=12000,photoMaxSide=256,depthMaxSide=168,
    depthMinPairs=6,depthRegularizeIterations=8,maxPhotoSamples=260000,
    maxDepthSamples=190000
  }={}){
    Object.assign(this,{width,height,maxFrames,maxRenderFrames,temporalRadius,maxLoopCandidates,minEdgeMatches,minEdgeProbability,maxWorldSamples,photoMaxSide,depthMaxSide,depthMinPairs,depthRegularizeIterations,maxPhotoSamples,maxDepthSamples});
    this.frames=[];this.frameMap=new Map();this.edges=[];this.adj=new Map();this.worldSamples=[];
    // Kept only for the unchanged metric/3-D evidence path. The PHOTO mosaic has
    // its own arbitrary 2-D coordinate system and never reads this Alva origin.
    this.origin=null;this.fallbackDepth=2.2;this.lastRenderStats=null;this.depthScaleDirty=true;
    this.depthScaleStats=null;this.depthScaleModel=null;this.depthScaleTransforms=new Map();this.visualSolution=null;this.visualDirty=true;this.depthConsensus=null;this.depthConsensusDirty=true;
  }
  reset(){this.frames=[];this.frameMap.clear();this.edges=[];this.adj.clear();this.worldSamples=[];this.origin=null;this.lastRenderStats=null;this.depthScaleDirty=true;this.depthScaleStats=null;this.depthScaleModel=null;this.depthScaleTransforms=new Map();this.visualSolution=null;this.visualDirty=true;this.depthConsensus=null;this.depthConsensusDirty=true;}
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
      f.relativeDepth=null;f.relativeDepthWidth=0;f.relativeDepthHeight=0;f.relativeQuality=null;f.relativeConfidence=0;f.metricDepth=null;f.metricDepthWidth=0;f.metricDepthHeight=0;f.metricConfidence=0;f.metricCalibration=null;f.depthPending=false;f.depthTransform=null;f.depthConfidence=0;f.photoGain=1;f.fallbackDepth=this.fallbackDepth;f.connected=false;
      if(!this.origin&&f.pose?.p)this.origin=f.pose.p.slice(0,3).map(Number);this.frameMap.set(String(f.frameId),this.frames.length);this.frames.push(f);
    }
    this.adj=new Map(this.frames.map((_,i)=>[i,[]]));this.edges=(puzzle?.edges||[]).map(e=>({...e,matches:(e.matches||[]).map(m=>({...m}))}));for(const e of this.edges){this.adj.get(e.a)?.push(e);this.adj.get(e.b)?.push(e);}
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
        photoGain:old.photoGain,fallbackDepth:old.fallbackDepth,connected:old.connected,visualQ:old.visualQ,visualConfidence:old.visualConfidence
      };
      if((f.width*f.height)>(old.width*old.height)*1.08)this.frames[oldIndex]={...f,...keep};
      else{old.pose=f.pose||old.pose;old.poseCov=f.poseCov||old.poseCov;old.metricLocked=old.metricLocked||f.metricLocked;old.at=f.at||old.at;if((f.features?.length||0)>(old.features?.length||0))old.features=f.features;Object.assign(old,keep);}
      this.depthScaleDirty=true;this.depthConsensusDirty=true;this.visualDirty=true;this.recomputeOrigin();this.recomputeVisualSolution();return this.stats();
    }
    if(!this.origin&&f.pose?.p)this.origin=f.pose.p.slice(0,3).map(Number);
    if(!hasRawDepth){f.relativeDepth=null;f.relativeDepthWidth=0;f.relativeDepthHeight=0;f.relativeQuality=null;f.relativeConfidence=0;}
    if(!hasMetricDepth){f.metricDepth=null;f.metricDepthWidth=0;f.metricDepthHeight=0;f.metricConfidence=0;}
    f.metricCalibration=f.metricCalibration||null;f.depthTransform=null;f.depthConfidence=0;f.connected=this.frames.length===0&&hasRawDepth;f.photoGain=1;
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
    return {frames:this.frames.length,edges:this.edges.length,loops,connectedFrames:connected,connectedFraction:this.frames.length?connected/this.frames.length:0,components:comps.length,rawDepthFrames,metricDepthFrames,pendingDepthFrames,worldSamples:this.worldSamples.length,coverage:this.lastRenderStats?.coverage||0,origin:(this.origin||[0,0,0]).slice(),depthScaleMode:this.depthScaleStats?.metricMode||null,depthScaleError:this.depthScaleStats?.metricRelativeError??Infinity,depthScalePairs:this.depthScaleStats?.metricPairs||0,depthAlignedFrames:this.depthScaleStats?.alignedFrames||metricDepthFrames,photoOnlyMosaic:true,visualRegisteredFrames:this.visualSolution?Array.from(this.visualSolution.confidence).reduce((n,c)=>n+(c>0?1:0),0):0,meanVisualConfidence:this.edges.length?this.edges.reduce((a,e)=>a+(e.visualConfidence||0),0)/this.edges.length:0,mosaicResidual:this.visualSolution?.medianResidual??0,mosaicP90Residual:this.visualSolution?.p90Residual??0,depthConsensusAlignedFrames:this.depthConsensus?.stats?.alignedFrames||0,depthConsensusEdges:this.depthConsensus?.stats?.pairEdges||0,depthConsensusError:this.depthConsensus?.stats?.medianRelativeError??Infinity,localWarpAnchors:this.visualSolution?.localWarp?.anchorCount||0,localWarpResidual:this.visualSolution?.localWarp?.medianBaseResidual??0,...diag};
  }

  render(canvas,mode='photo'){
    if(!canvas)return this.stats();this.rebuildDepthScaleIfNeeded();const result=mode==='depth'?this.renderDepthAtlas():this.renderPhotoAtlas();
    // The live preview is deliberately just the reconstructed image.  Feature
    // points, frame centres and graph edges are diagnostics, not scene content,
    // and made the RGB panorama look like an exploding point cloud.
    drawAtlas(canvas,result);this.lastRenderStats={...this.stats(),coverage:result.coverage||0,mode,depthMode:result.depthMode||null,depthMin:result.depthMin??null,depthMax:result.depthMax??null};return this.lastRenderStats;
  }

  renderPhotoAtlas(){
    this.recomputeVisualSolution();const width=this.width,height=this.height,rgba=new Uint8ClampedArray(width*height*4),score=new Float32Array(width*height),visible=new Set(this.visualSolution?.component||[]),indices=this.renderIndices(visible).filter(i=>hasDepthEvidence(this.frames[i])),bounds=this.visualSolution?.bounds||computeMosaicBounds(this.frames,this.visualSolution?.transforms||[],{localWarp:null});
    // Standard inverse image warp: every destination pixel inside a registered
    // photograph is mapped back into the source RGB raster and sampled densely.
    // This is intentionally NOT a point/splat renderer; it cannot turn a photo
    // into a cloud of coloured dots when the mosaic grows.
    const map=canvasMosaicMap(bounds,width,height);
    for(const fi of indices){const f=this.frames[fi],G=this.visualSolution?.transforms?.[fi],regQ=this.visualSolution?.confidence?.[fi]||0;if(!G||!visible.has(fi))continue;const inv=invertHomography(G);if(!inv)continue;
      const corners=[[0,0],[f.width,0],[f.width,f.height],[0,f.height]].map(([u,v])=>photoPixelToCanvas(f,G,u,v,width,height,bounds,null,fi)).filter(Boolean);if(corners.length!==4)continue;
      const minX=clamp(Math.floor(Math.min(...corners.map(p=>p.x)))-1,0,width-1),maxX=clamp(Math.ceil(Math.max(...corners.map(p=>p.x)))+1,0,width-1),minY=clamp(Math.floor(Math.min(...corners.map(p=>p.y)))-1,0,height-1),maxY=clamp(Math.ceil(Math.max(...corners.map(p=>p.y)))+1,0,height-1);
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const mx=(x+.5-map.ox)/map.scale,my=(y+.5-map.oy)/map.scale,uv=applyHomography(inv,mx,my);if(!uv)continue;const u=uv[0],v=uv[1];if(u<0||v<0||u>1||v>1)continue;
        const rgb=sampleRgbBilinear(f,u*(f.width-1),v*(f.height-1));if(!rgb)continue;const edge=Math.min(u,1-u,v,1-v),centreQ=clamp(edge/.18,0,1),q=Math.max(.08,regQ)*(.22+.78*centreQ),i=y*width+x,j=i*4;
        if(!rgba[j+3]||q>score[i]*1.015){score[i]=q;rgba[j]=clamp(rgb[0]*f.photoGain,0,255);rgba[j+1]=clamp(rgb[1]*f.photoGain,0,255);rgba[j+2]=clamp(rgb[2]*f.photoGain,0,255);rgba[j+3]=255;}
        else if(q>score[i]*.96){const r=rgb[0]*f.photoGain,g=rgb[1]*f.photoGain,b=rgb[2]*f.photoGain,delta=Math.abs(r-rgba[j])+Math.abs(g-rgba[j+1])+Math.abs(b-rgba[j+2]);if(delta<22){rgba[j]=(rgba[j]+r)*.5;rgba[j+1]=(rgba[j+1]+g)*.5;rgba[j+2]=(rgba[j+2]+b)*.5;rgba[j+3]=255;}}
      }
    }
    let covered=0;for(let i=0;i<width*height;i++)if(rgba[i*4+3])covered++;return {width,height,rgba,coverage:covered/(width*height),frameCenters:[],photoOnlyMosaic:true,bounds};
  }

  renderDepthAtlas(){
    this.recomputeVisualSolution();this.rebuildDepthConsensusIfNeeded();const width=this.width,height=this.height,depth=new Float32Array(width*height),score=new Float32Array(width*height),largest=new Set(this.visualSolution?.component||[]),indices=this.renderIndices(largest),bounds=this.visualSolution?.bounds||computeMosaicBounds(this.frames,this.visualSolution?.transforms||[],{localWarp:this.visualSolution?.localWarp});
    const metricFrames=indices.filter(i=>largest.has(i)&&this.frameHasMetricDepth(this.frames[i])).length,rawFrames=indices.filter(i=>largest.has(i)&&this.frames[i]?.relativeDepth?.length).length,useMetric=metricFrames>0&&metricFrames>=Math.max(1,Math.ceil(rawFrames*.30)),totalPixels=indices.reduce((sum,i)=>sum+(this.frames[i]?.width||0)*(this.frames[i]?.height||0),0),stride=Math.max(1,Math.ceil(Math.sqrt(totalPixels/Math.max(10000,this.maxDepthSamples))));
    for(const fi of indices){if(!largest.has(fi))continue;const f=this.frames[fi],G=this.visualSolution?.transforms?.[fi],regQ=this.visualSolution?.confidence?.[fi]||0;if(!G)continue;const consensusT=this.depthConsensus?.transforms?.[fi]||null,consensusQ=this.depthConsensus?.frameConfidence?.[fi]||0;if(useMetric&&!this.frameHasMetricDepth(f))continue;if(!useMetric&&!consensusT)continue;
      for(let y=0;y<f.height;y+=stride)for(let x=0;x<f.width;x+=stride){const a=photoPixelToCanvas(f,G,x+.5,y+.5,width,height,bounds,this.visualSolution?.localWarp,fi);if(!a)continue;let value,q;if(useMetric){const z=this.sampleMetricDepth(f,x+.5,y+.5);if(!(z>.08))continue;const ray=pixelRay(f.K,x+.5,y+.5);value=z/Math.max(.08,ray[2]);q=Math.max(.015,f.depthConfidence||f.metricConfidence||.02);}else{value=sampleConsensusDepth(f,consensusT,x+.5,y+.5);if(!Number.isFinite(value))continue;q=Math.max(.008,consensusQ)*(f.relativeQuality?.suspicious?.28:1)*(f.relativeQuality?.stripe?.suspicious?.35:1);}const cx=f.width*.5,cy=f.height*.5,centre=1-Math.min(.94,Math.hypot((x-cx)/Math.max(1,f.width),(y-cy)/Math.max(1,f.height))),sourceQ=q*Math.max(.15,regQ)*Math.max(.05,centre*centre);splatDepthBest(depth,score,width,height,a.x,a.y,value,sourceQ);}}
    const vals=[];for(let i=0;i<depth.length;i++)if(score[i]>0&&Number.isFinite(depth[i]))vals.push(depth[i]);vals.sort((a,b)=>a-b);const lo=vals.length?vals[Math.floor(vals.length*.03)]:0,hi=vals.length?vals[Math.floor(vals.length*.97)]:1,span=Math.max(1e-6,hi-lo),rgba=new Uint8ClampedArray(width*height*4);let covered=0;for(let i=0;i<depth.length;i++){if(!(score[i]>0))continue;const t=clamp((depth[i]-lo)/span,0,1),c=heatColor(1-t),j=i*4;rgba[j]=c[0];rgba[j+1]=c[1];rgba[j+2]=c[2];rgba[j+3]=clamp(Math.round(100+155*Math.min(1,score[i]*4)),0,255);covered++;}fillTinyHoles(rgba,width,height);return {width,height,rgba,coverage:covered/(width*height),depthMin:lo,depthMax:hi,frameCenters:this.frameCenters(bounds),depthMode:useMetric?'metric-best-confidence':'relative-overlap-consensus',bounds};
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
  frameCenters(bounds=null){this.recomputeVisualSolution();bounds=bounds||this.visualSolution?.bounds;return this.frames.map((f,i)=>{const G=this.visualSolution?.transforms?.[i];if(!G)return {i,x:-9999,y:-9999,connected:false,visual:false,depth:this.frameHasMetricDepth(f),rawDepth:!!f.relativeDepth?.length,pending:!!f.depthPending};const a=photoPixelToCanvas(f,G,f.width*.5,f.height*.5,this.width,this.height,bounds,this.visualSolution?.localWarp,i);return {i,x:a?.x??-9999,y:a?.y??-9999,connected:!!f.connected,visual:(this.visualSolution?.confidence?.[i]||0)>0,depth:this.frameHasMetricDepth(f),rawDepth:!!f.relativeDepth?.length,pending:!!f.depthPending};});}
  drawGraph(canvas,result){
    const ctx=canvas.getContext('2d'),sx=canvas.width/result.width,sy=canvas.height/result.height,centres=(result.frameCenters||[]).filter(c=>c.visual),by=new Map(centres.map(c=>[c.i,c]));ctx.save();ctx.lineWidth=Math.max(1,canvas.width/480);ctx.globalAlpha=.55;for(const e of this.edges){const a=by.get(e.a),b=by.get(e.b);if(!a||!b)continue;ctx.strokeStyle=e.loop?'#7be495':'#d7f2ff';ctx.beginPath();ctx.moveTo(a.x*sx,a.y*sy);ctx.lineTo(b.x*sx,b.y*sy);ctx.stroke();}ctx.globalAlpha=.95;for(const c of centres){ctx.fillStyle=c.depth?'#7be495':c.rawDepth?'#f7d774':'#61d6ff';ctx.beginPath();ctx.arc(c.x*sx,c.y*sy,c.depth?2.9:c.pending?1.8:2.2,0,Math.PI*2);ctx.fill();}ctx.restore();
  }

  connectNewest(){this.connectFrame(this.frames.length-1);}
  connectFrame(j){
    if(j<=0||j>=this.frames.length||!hasDepthEvidence(this.frames[j]))return;const candidates=new Set();for(let i=Math.max(0,j-this.temporalRadius);i<j;i++)if(hasDepthEvidence(this.frames[i]))candidates.add(i);
    // Long-range candidates are selected by image appearance only. Depth is an
    // admission invariant (same frame exists in both modalities), never a 2-D
    // placement cue. Alva pose is optional metadata and is not consulted here.
    const targetHash=imageHash(this.frames[j]),loop=[];for(let i=0;i<j-this.temporalRadius-2;i++)if(hasDepthEvidence(this.frames[i]))loop.push({i,score:hashDistance(imageHash(this.frames[i]),targetHash)});loop.sort((a,b)=>a.score-b.score);for(const x of loop.slice(0,this.maxLoopCandidates))candidates.add(x.i);
    for(const i of candidates){if(this.edges.some(e=>(e.a===i&&e.b===j)||(e.a===j&&e.b===i)))continue;const e=this.matchPair(i,j);if(!e)continue;this.edges.push(e);this.adj.get(i)?.push(e);this.adj.get(j)?.push(e);}this.depthScaleDirty=true;this.depthConsensusDirty=true;this.visualDirty=true;
  }
  matchPair(i,j){
    const a=this.frames[i],b=this.frames[j];if(!hasDepthEvidence(a)||!hasDepthEvidence(b))return null;const far=Math.abs(i-j)>this.temporalRadius+1,raw=matchPhotoFeatures(a,b,{maxFeatures:320,maxMatches:170,maxHamming:70,minProbability:.025,patchRadius:2}),candidate=raw.filter(x=>x.probability>=Math.min(this.minEdgeProbability,.11));if(candidate.length<this.minEdgeMatches)return null;
    const reg=buildPhotoRegistrationEdge(a,b,candidate,{minMatches:this.minEdgeMatches,reprojectionPx:far?5.0:3.8});if(!reg||!reliablePhotoOverlap(reg,a,b,{far,minMatches:this.minEdgeMatches}))return null;const gain=estimateExposureGain(a,b,reg.matches);return {a:i,b:j,aId:a.frameId,bId:b.frameId,...reg,weight:reg.visualConfidence,loop:far,gainAB:gain,registration:'photo-only-ransac'};
  }
  components(){const seen=new Set(),out=[];for(let s=0;s<this.frames.length;s++){if(seen.has(s))continue;const q=[s],c=[];seen.add(s);while(q.length){const i=q.pop();c.push(i);for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(!seen.has(j)){seen.add(j);q.push(j);}}}out.push(c);}return out.sort((a,b)=>b.length-a.length);}
  rootComponent(){const comps=this.components();return comps.find(c=>c.includes(0))||(this.frames.length?[0]:[]);}
  recomputeConnectivity(){const visible=new Set(this.rootComponent());this.frames.forEach((f,i)=>f.connected=visible.has(i));}
  recomputeVisualSolution(persisted=null){
    if(!persisted&&!this.visualDirty&&this.visualSolution)return;if(!this.frames.length){this.visualSolution=null;this.visualDirty=false;return;}
    const saved=persisted?.mosaicTransforms;if(Array.isArray(saved)&&saved.length===this.frames.length){const confidence=Float32Array.from(persisted.visualConfidence||saved.map((H,i)=>H?i===0?1:.25:0));this.visualSolution={transforms:saved.map(H=>Array.isArray(H)&&H.length===9?H.map(Number):null),confidence,rootIndex:Number.isInteger(persisted.rootIndex)?persisted.rootIndex:0,parent:new Int32Array(this.frames.length),component:(persisted.components?.[0]||saved.map((H,i)=>H?i:null).filter(Number.isInteger))};}
    else this.visualSolution=solvePhotoMosaic(this.frames,this.edges,{iterations:7,rootIndex:0});
    // Keep the optional local warp as post-processing evidence, but the live RGB
    // preview/bounds stay on the stable global homographies so already accepted
    // photographs cannot suddenly deform when a new frame arrives.
    this.visualSolution.localWarp=buildLocalMosaicWarp(this.frames,this.edges,this.visualSolution,{});this.visualSolution.bounds=computeMosaicBounds(this.frames,this.visualSolution.transforms,{localWarp:null,padding:.06});this.frames.forEach((f,i)=>{f.mosaicH=this.visualSolution.transforms[i];f.visualConfidence=this.visualSolution.confidence[i];});this.visualDirty=false;
  }
  rebuildDepthConsensusIfNeeded(){if(!this.depthConsensusDirty)return;this.depthConsensusDirty=false;this.depthConsensus=solvePhotoDepthConsensus(this.frames,this.edges,{minPairs:this.depthMinPairs,maxPairs:100});}
  exportState(){this.recomputeVisualSolution();this.rebuildDepthConsensusIfNeeded();return {format:'ROOMSCAN-LIVE-PHOTO-MOSAIC-3',photoOnlyMosaic:true,stats:this.stats(),rootIndex:this.visualSolution?.rootIndex??0,mosaicTransforms:(this.visualSolution?.transforms||[]).map(H=>H?Array.from(H):null),visualConfidence:Array.from(this.visualSolution?.confidence||[]),frames:this.frames.map((f,i)=>({frameId:String(f.frameId),alvaPose:clonePoseNullable(f.pose),poseCov:f.poseCov||null,K:{...f.K},width:f.width,height:f.height,at:f.at||0,mosaicH:this.visualSolution?.transforms?.[i]?Array.from(this.visualSolution.transforms[i]):null,visualConfidence:Number(this.visualSolution?.confidence?.[i]||0),hasRawDepth:!!f.relativeDepth?.length,hasMetricDepth:this.frameHasMetricDepth(f)})),edges:this.edges.map(e=>({a:e.a,b:e.b,aId:e.aId,bId:e.bId,loop:!!e.loop,homography:Array.from(e.homography||[]),visualConfidence:e.visualConfidence||0,homographyMedianErrorPx:e.homographyMedianErrorPx??null,matches:(e.matches||[]).slice(0,140).map(m=>({aU:m.aU,aV:m.aV,bU:m.bU,bV:m.bV,probability:m.probability,photometricProbability:m.photometricProbability,uniquenessProbability:m.uniquenessProbability}))})),localWarp:this.visualSolution?.localWarp?{anchorCount:this.visualSolution.localWarp.anchorCount,medianBaseResidual:this.visualSolution.localWarp.medianBaseResidual,p90BaseResidual:this.visualSolution.localWarp.p90BaseResidual}:null,depthConsensus:this.depthConsensus?{root:this.depthConsensus.root,stats:this.depthConsensus.stats,transforms:this.depthConsensus.transforms.map(t=>t?{a:t.a,b:t.b}:null),frameConfidence:Array.from(this.depthConsensus.frameConfidence),edges:this.depthConsensus.edges}:null};}
  recomputeOrigin(){
    // Intentionally fixed. A moving mean-camera origin makes already pasted RGB
    // slide on every new frame and looks like registration blur. Depth-aware
    // reprojection already accounts for parallax from translated cameras.
    if(!this.origin){const f=this.frames.find(x=>x.pose?.p);if(f)this.origin=f.pose.p.slice(0,3).map(Number);}
  }
  recomputePhotoGains(){
    if(!this.frames.length)return;const gains=new Array(this.frames.length).fill(NaN),largest=this.components()[0]||[];if(!largest.length)return;gains[largest[0]]=1;const q=[largest[0]];while(q.length){const i=q.shift();for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(Number.isFinite(gains[j]))continue;const ratio=e.a===i?e.gainAB:1/Math.max(.2,e.gainAB);gains[j]=clamp(gains[i]*ratio,.55,1.75);q.push(j);}}
    for(let i=0;i<this.frames.length;i++)this.frames[i].photoGain=Number.isFinite(gains[i])?gains[i]:1;
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

function hasDepthEvidence(f){return !!(f?.relativeDepth?.length||f?.metricDepth?.length);}

function applyHomography(H,x,y){if(!Array.isArray(H)||H.length!==9)return null;const z=H[6]*x+H[7]*y+H[8];if(!Number.isFinite(z)||Math.abs(z)<EPS)return null;const u=(H[0]*x+H[1]*y+H[2])/z,v=(H[3]*x+H[4]*y+H[5])/z;return Number.isFinite(u)&&Number.isFinite(v)?[u,v]:null;}
function invertHomography(m){if(!Array.isArray(m)||m.length!==9||!m.every(Number.isFinite))return null;const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d,det=a*A+b*D+c*G;if(Math.abs(det)<1e-12)return null;return [A/det,B/det,C/det,D/det,E/det,F/det,G/det,H/det,I/det];}
function canvasMosaicMap(bounds,width,height){const bw=Math.max(EPS,bounds.maxX-bounds.minX),bh=Math.max(EPS,bounds.maxY-bounds.minY),scale=Math.min(width/bw,height/bh),ox=(width-bw*scale)/2-bounds.minX*scale,oy=(height-bh*scale)/2-bounds.minY*scale;return {scale,ox,oy};}
function sampleRgbBilinear(f,x,y){if(!f?.rgb?.length||x<0||y<0||x>f.width-1||y>f.height-1)return null;const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(f.width-1,x0+1),y1=Math.min(f.height-1,y0+1),tx=x-x0,ty=y-y0,out=[0,0,0];for(let c=0;c<3;c++){const a=f.rgb[(y0*f.width+x0)*3+c],b=f.rgb[(y0*f.width+x1)*3+c],d=f.rgb[(y1*f.width+x0)*3+c],e=f.rgb[(y1*f.width+x1)*3+c];out[c]=a*(1-tx)*(1-ty)+b*tx*(1-ty)+d*(1-tx)*ty+e*tx*ty;}return out;}

export function reliablePhotoOverlap(reg,a,b,{far=false,minMatches=6}={}){
  const m=reg?.matches||[],n=m.length,total=Math.max(n,Number(reg?.allPhotoMatches)||n);if(n<Math.max(8,minMatches)||n/Math.max(1,total)<.45)return false;
  const maxErr=far?3.8:3.0;if(!Number.isFinite(reg.homographyMedianErrorPx)||reg.homographyMedianErrorPx>maxErr||Number(reg.visualConfidence||0)<.035)return false;
  const spread=(keyU,keyV,w,h)=>{const xs=m.map(x=>x[keyU]/Math.max(1,w)).sort((x,y)=>x-y),ys=m.map(x=>x[keyV]/Math.max(1,h)).sort((x,y)=>x-y),lo=Math.floor((n-1)*.08),hi=Math.ceil((n-1)*.92);return [Math.max(0,xs[hi]-xs[lo]),Math.max(0,ys[hi]-ys[lo])];};
  const [ax,ay]=spread('aU','aV',a.width,a.height),[bx,by]=spread('bU','bV',b.width,b.height);if(Math.min(ax,bx)<.10||Math.min(ay,by)<.10||Math.max(ax,ay)<.32||Math.max(bx,by)<.32)return false;
  // A numerically good fit on repeated texture can still produce a wild projective
  // transform. Reject those instead of ever placing a photo "somewhere plausible".
  const H=reg?.homography,corners=[[0,0],[1,0],[1,1],[0,1]].map(p=>applyHomography(H,p[0],p[1]));if(corners.some(p=>!p||Math.abs(p[0])>3||Math.abs(p[1])>3))return false;
  let area=0;for(let i=0;i<4;i++){const p=corners[i],q=corners[(i+1)%4];area+=p[0]*q[1]-p[1]*q[0];}area=Math.abs(area)*.5;if(area<.18||area>4.5)return false;
  const minX=Math.min(...corners.map(p=>p[0])),maxX=Math.max(...corners.map(p=>p[0])),minY=Math.min(...corners.map(p=>p[1])),maxY=Math.max(...corners.map(p=>p[1])),overlapX=Math.max(0,Math.min(1,maxX)-Math.max(0,minX)),overlapY=Math.max(0,Math.min(1,maxY)-Math.max(0,minY));return overlapX*overlapY>.015;
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
function sampleGray(f,x,y){const xx=clamp(Math.round(x),0,f.width-1),yy=clamp(Math.round(y),0,f.height-1);return f.gray[yy*f.width+xx]||0;}

function splatPanoramaSharp(rgba,score,w,h,x,y,color,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.015)continue;const xx=clamp(xi+dx,0,w-1),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,j=i*4,qq=q*bw;if(!rgba[j+3]||qq>score[i]*1.025){score[i]=qq;rgba[j]=clamp(color[0],0,255);rgba[j+1]=clamp(color[1],0,255);rgba[j+2]=clamp(color[2],0,255);rgba[j+3]=clamp(75+qq*180,55,255);}else if(qq>score[i]*.90){const dr=Math.abs(rgba[j]-color[0])+Math.abs(rgba[j+1]-color[1])+Math.abs(rgba[j+2]-color[2]);if(dr<28){const a=.035;rgba[j]=rgba[j]*(1-a)+color[0]*a;rgba[j+1]=rgba[j+1]*(1-a)+color[1]*a;rgba[j+2]=rgba[j+2]*(1-a)+color[2]*a;}}}}
function splatDepthBest(depth,score,w,h,x,y,value,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.02)continue;const xx=clamp(xi+dx,0,w-1),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,qq=q*bw;if(!(score[i]>0)||qq>score[i]*1.04){depth[i]=value;score[i]=qq;}else if(qq>score[i]*.82&&Math.abs(value-depth[i])<Math.max(1e-4,.06*Math.max(Math.abs(value),Math.abs(depth[i])))){const a=qq/(score[i]+qq+EPS);depth[i]=depth[i]*(1-a)+value*a;score[i]=Math.max(score[i],qq);}}}
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
