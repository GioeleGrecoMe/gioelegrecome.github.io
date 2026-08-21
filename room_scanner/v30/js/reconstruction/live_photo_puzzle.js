import {normalizeFrame} from './view_puzzle.js';
import {DepthScaleGraph} from './depth_scale_graph.js';
import {pixelRay,qRotate,qNormalize} from '../slam/math.js';
import {matchPhotoFeatures,buildPhotoRegistrationEdge,solvePhotoOrientations,visualAlvaDiagnostics,buildLocalPanoramaWarp,photoPixelToAtlas} from './photo_panorama.js';
import {solvePhotoDepthConsensus,sampleConsensusDepth} from './photo_depth_consensus.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-8;

/**
 * Live pose-aware photo/depth puzzle.
 *
 * This object is deliberately a VIEWER + evidence monitor, not a second SLAM.
 * Every survey photo is frozen on the exact camera frame sent to Deep and keeps
 * that frame's Alva pose, K and 2-D feature packet.  Deep may finish much later;
 * the result can only update the node with the same frameId.
 *
 * A walking scan cannot be represented by one global planar homography because
 * camera translation creates parallax.  The RGB panorama is therefore solved
 * from PHOTO evidence first: descriptor/ZNCC correspondences -> visual RANSAC ->
 * pairwise calibrated rotations -> robust rotation graph.  Alva never gates a
 * visual match; its 6-DoF pose and covariance remain attached to the same photo
 * as a metric prior that can be checked/corrected later.
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
    // Kept for the unchanged metric/3-D evidence path. The PHOTO panorama itself
    // is direction-based and does not use this Alva translation origin.
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
      const f={...src,pose:clonePose(src.pose),K:{...src.K},gray:new Uint8Array(src.gray||[]),rgb:new Uint8Array(src.rgb||[]),features:(src.features||[]).map(x=>({...x,desc:Array.from(x.desc||[])})),at:Number(src.at||0),metricLocked:true,source:'post-scan'};
      f.relativeDepth=null;f.relativeDepthWidth=0;f.relativeDepthHeight=0;f.relativeQuality=null;f.relativeConfidence=0;f.metricDepth=null;f.metricDepthWidth=0;f.metricDepthHeight=0;f.metricConfidence=0;f.metricCalibration=null;f.depthPending=false;f.depthTransform=null;f.depthConfidence=0;f.photoGain=1;f.fallbackDepth=this.fallbackDepth;f.connected=false;
      if(!this.origin)this.origin=f.pose.p.slice(0,3).map(Number);this.frameMap.set(String(f.frameId),this.frames.length);this.frames.push(f);
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
    const f=compactCameraFrame(frame,this.photoMaxSide);if(!f)return this.stats();f.source=source;f.depthPending=true;
    return this.addPreparedFrame(f,{fallbackDepth});
  }

  addPreparedFrame(f,{fallbackDepth=null}={}){
    const id=String(f.frameId),oldIndex=this.frameMap.get(id);
    if(oldIndex!=null){
      const old=this.frames[oldIndex];
      // Prefer the higher-resolution exact survey RGB packet over a later dense
      // thumbnail of the same camera frame, but allow metadata to be upgraded.
      if((f.width*f.height)>(old.width*old.height)*1.08){
        const keep={relativeDepth:old.relativeDepth,relativeDepthWidth:old.relativeDepthWidth,relativeDepthHeight:old.relativeDepthHeight,relativeQuality:old.relativeQuality,metricDepth:old.metricDepth,metricDepthWidth:old.metricDepthWidth,metricDepthHeight:old.metricDepthHeight,metricConfidence:old.metricConfidence,metricCalibration:old.metricCalibration,depthTransform:old.depthTransform,depthConfidence:old.depthConfidence,depthPending:old.depthPending,photoGain:old.photoGain,fallbackDepth:old.fallbackDepth,connected:old.connected,visualQ:old.visualQ,visualConfidence:old.visualConfidence};
        this.frames[oldIndex]={...f,...keep};
      }else{
        old.pose=f.pose||old.pose;old.poseCov=f.poseCov||old.poseCov;old.metricLocked=old.metricLocked||f.metricLocked;old.at=f.at||old.at;
        if((f.features?.length||0)>(old.features?.length||0))old.features=f.features;
      }
      this.depthScaleDirty=true;this.depthConsensusDirty=true;this.visualDirty=true;this.recomputeOrigin();this.recomputeVisualSolution();return this.stats();
    }
    if(!this.origin)this.origin=f.pose.p.slice(0,3).map(Number);
    f.relativeDepth=null;f.relativeDepthWidth=0;f.relativeDepthHeight=0;f.relativeQuality=null;
    f.metricDepth=null;f.metricDepthWidth=0;f.metricDepthHeight=0;f.metricConfidence=0;f.metricCalibration=null;
    f.depthTransform=null;f.depthConfidence=0;f.connected=this.frames.length===0;f.photoGain=1;
    f.fallbackDepth=Number.isFinite(+fallbackDepth)?+fallbackDepth:this.fallbackDepth;
    this.frameMap.set(id,this.frames.length);this.frames.push(f);this.adj.set(this.frames.length-1,[]);
    this.connectNewest();while(this.frames.length>this.maxFrames)this.dropOldest();this.visualDirty=true;
    this.recomputeConnectivity();this.recomputeOrigin();this.recomputeVisualSolution();this.recomputePhotoGains();this.depthScaleDirty=true;this.depthConsensusDirty=true;return this.stats();
  }

  /** Raw relative Deep map from the exact photo node. */
  updateRelativeDepth(frameId,{rawDepth,width,height,quality=null,confidence=.12,calibration=null}={}){
    const i=this.frameMap.get(String(frameId));if(i==null||!rawDepth?.length||!(width>1&&height>1))return false;const f=this.frames[i],c=compactDepth(rawDepth,width,height,this.depthMaxSide,false);
    if(c.validRatio<.03)return false;f.relativeDepth=c.depth;f.relativeDepthWidth=c.width;f.relativeDepthHeight=c.height;f.relativeQuality=quality?compactQuality(quality):null;f.relativeConfidence=clamp(Number(confidence)||.06,.005,1);f.metricCalibration=normaliseCalibration(calibration)||f.metricCalibration;f.depthPending=false;this.depthScaleDirty=true;this.depthConsensusDirty=true;return true;
  }

  /** Strong metric map from online Deep->Alva calibration. */
  updateDepth(frameId,{depth,width,height,confidence=.25,mode='metric-deep',calibration=null}={}){
    const i=this.frameMap.get(String(frameId));if(i==null||!depth?.length||!(width>1&&height>1))return false;const f=this.frames[i],c=compactDepth(depth,width,height,this.depthMaxSide,true);
    if(c.validRatio<.03)return false;f.metricDepth=c.depth;f.metricDepthWidth=c.width;f.metricDepthHeight=c.height;f.metricConfidence=clamp(+confidence||.05,.02,1);f.depthMode=mode;f.metricCalibration=normaliseCalibration(calibration)||f.metricCalibration;f.depthPending=false;
    if(Number.isFinite(c.median)){f.fallbackDepth=c.median;this.fallbackDepth=this.fallbackDepth*.82+c.median*.18;}this.depthScaleDirty=true;this.depthConsensusDirty=true;return true;
  }

  addWorldSamples(samples,{maxAdd=900,source='mvs'}={}){
    const a=(samples||[]).filter(s=>Array.isArray(s?.p)&&s.p.length>=3&&s.p.every(Number.isFinite));if(!a.length)return 0;const step=Math.max(1,Math.ceil(a.length/Math.max(1,maxAdd)));let n=0;
    for(let i=0;i<a.length;i+=step){const s=a[i],p=s.p.slice(0,3).map(Number),confidence=clamp(Number(s.probability??s.geometryProbability??s.confidence??.12),.005,1),color=Array.isArray(s.color)?s.color.slice(0,3).map(x=>clamp(+x||0,0,255)):null;this.worldSamples.push({p,confidence,color,source});n++;}
    if(this.worldSamples.length>this.maxWorldSamples)this.worldSamples.splice(0,this.worldSamples.length-this.maxWorldSamples);return n;
  }

  stats(){
    this.rebuildDepthScaleIfNeeded();this.rebuildDepthConsensusIfNeeded();const comps=this.components(),largest=comps[0]||[],loops=this.edges.reduce((n,e)=>n+(e.loop?1:0),0),rawDepthFrames=this.frames.reduce((n,f)=>n+(f.relativeDepth?.length?1:0),0),metricDepthFrames=this.frames.reduce((n,f)=>n+(this.frameHasMetricDepth(f)?1:0),0),pendingDepthFrames=this.frames.reduce((n,f)=>n+(f.depthPending?1:0),0),connected=this.frames.length?largest.length:0,diag=visualAlvaDiagnostics(this.frames,this.edges,this.visualSolution?.orientations||[]);
    return {frames:this.frames.length,edges:this.edges.length,loops,connectedFrames:connected,connectedFraction:this.frames.length?connected/this.frames.length:0,components:comps.length,rawDepthFrames,metricDepthFrames,pendingDepthFrames,worldSamples:this.worldSamples.length,coverage:this.lastRenderStats?.coverage||0,origin:(this.origin||[0,0,0]).slice(),depthScaleMode:this.depthScaleStats?.metricMode||null,depthScaleError:this.depthScaleStats?.metricRelativeError??Infinity,depthScalePairs:this.depthScaleStats?.metricPairs||0,depthAlignedFrames:this.depthScaleStats?.alignedFrames||metricDepthFrames,photoFirst:true,visualRegisteredFrames:this.visualSolution?Array.from(this.visualSolution.confidence).reduce((n,c)=>n+(c>0?1:0),0):0,meanVisualConfidence:this.edges.length?this.edges.reduce((a,e)=>a+(e.visualConfidence||0),0)/this.edges.length:0,depthConsensusAlignedFrames:this.depthConsensus?.stats?.alignedFrames||0,depthConsensusEdges:this.depthConsensus?.stats?.pairEdges||0,depthConsensusError:this.depthConsensus?.stats?.medianRelativeError??Infinity,localWarpAnchors:this.visualSolution?.localWarp?.anchorCount||0,localWarpResidualPx:this.visualSolution?.localWarp?.medianBaseResidualPx??0,...diag};
  }

  render(canvas,mode='photo'){
    if(!canvas)return this.stats();this.rebuildDepthScaleIfNeeded();const result=mode==='depth'?this.renderDepthAtlas():this.renderPhotoAtlas();drawAtlas(canvas,result);this.drawGraph(canvas,result,mode);this.lastRenderStats={...this.stats(),coverage:result.coverage||0,mode,depthMode:result.depthMode||null,depthMin:result.depthMin??null,depthMax:result.depthMax??null};return this.lastRenderStats;
  }

  renderPhotoAtlas(){
    this.recomputeVisualSolution();const width=this.width,height=this.height,rgba=new Uint8ClampedArray(width*height*4),score=new Float32Array(width*height),comps=this.components(),largest=new Set(comps[0]||[]),indices=this.renderIndices(largest);
    const totalPixels=indices.reduce((sum,i)=>sum+(this.frames[i]?.width||0)*(this.frames[i]?.height||0),0),stride=Math.max(1,Math.ceil(Math.sqrt(totalPixels/Math.max(10000,this.maxPhotoSamples))));
    for(const fi of indices){const f=this.frames[fi],strong=largest.has(fi),regQ=this.visualSolution?.confidence?.[fi]||0;if(!strong&&regQ<=0)continue;const q=f.visualQ||f.pose.q,conn=strong?1:.12;for(let y=0;y<f.height;y+=stride)for(let x=0;x<f.width;x+=stride){const a=photoPixelToAtlas(f,q,x+.5,y+.5,width,height,this.visualSolution?.localWarp,fi),si=(Math.min(f.height-1,y)*f.width+Math.min(f.width-1,x))*3,centre=1-Math.min(.96,Math.hypot((x-f.K.cx)/Math.max(1,f.width),(y-f.K.cy)/Math.max(1,f.height))),base=conn*Math.max(.12,regQ)*Math.max(.025,centre*centre),color=[f.rgb[si]*f.photoGain,f.rgb[si+1]*f.photoGain,f.rgb[si+2]*f.photoGain];splatPanoramaSharp(rgba,score,width,height,a.x,a.y,color,base);}}
    fillTinyHoles(rgba,width,height);let covered=0;for(let i=0;i<width*height;i++)if(rgba[i*4+3])covered++;return {width,height,rgba,coverage:covered/(width*height),frameCenters:this.frameCenters(),photoFirst:true};
  }

  renderDepthAtlas(){
    this.recomputeVisualSolution();this.rebuildDepthConsensusIfNeeded();const width=this.width,height=this.height,depth=new Float32Array(width*height),score=new Float32Array(width*height),comps=this.components(),largest=new Set(comps[0]||[]),indices=this.renderIndices(largest);
    const metricFrames=indices.filter(i=>largest.has(i)&&this.frameHasMetricDepth(this.frames[i])).length,rawFrames=indices.filter(i=>largest.has(i)&&this.frames[i]?.relativeDepth?.length).length,useMetric=metricFrames>0&&metricFrames>=Math.max(1,Math.ceil(rawFrames*.30));
    const totalPixels=indices.reduce((sum,i)=>sum+(this.frames[i]?.width||0)*(this.frames[i]?.height||0),0),stride=Math.max(1,Math.ceil(Math.sqrt(totalPixels/Math.max(10000,this.maxDepthSamples))));
    for(const fi of indices){if(!largest.has(fi))continue;const f=this.frames[fi],visualQ=f.visualQ||f.pose.q,regQ=this.visualSolution?.confidence?.[fi]||0;if(fi!==this.visualSolution?.rootIndex&&regQ<=0)continue;const consensusT=this.depthConsensus?.transforms?.[fi]||null,consensusQ=this.depthConsensus?.frameConfidence?.[fi]||0;if(useMetric&&!this.frameHasMetricDepth(f))continue;if(!useMetric&&!consensusT)continue;
      for(let y=0;y<f.height;y+=stride)for(let x=0;x<f.width;x+=stride){const ray=pixelRay(f.K,x+.5,y+.5),a=photoPixelToAtlas(f,visualQ,x+.5,y+.5,width,height,this.visualSolution?.localWarp,fi);let value,q;if(useMetric){const z=this.sampleMetricDepth(f,x+.5,y+.5);if(!(z>.08))continue;value=z/Math.max(.08,ray[2]);q=Math.max(.015,f.depthConfidence||f.metricConfidence||.02);}else{value=sampleConsensusDepth(f,consensusT,x+.5,y+.5);if(!Number.isFinite(value))continue;q=Math.max(.008,consensusQ)*(f.relativeQuality?.suspicious?.28:1)*(f.relativeQuality?.stripe?.suspicious?.35:1);}const centre=1-Math.min(.94,Math.hypot((x-f.K.cx)/Math.max(1,f.width),(y-f.K.cy)/Math.max(1,f.height))),sourceQ=q*Math.max(.15,regQ)*Math.max(.05,centre*centre);splatDepthBest(depth,score,width,height,a.x,a.y,value,sourceQ);}}
    const vals=[];for(let i=0;i<depth.length;i++)if(score[i]>0&&Number.isFinite(depth[i]))vals.push(depth[i]);vals.sort((a,b)=>a-b);const lo=vals.length?vals[Math.floor(vals.length*.03)]:0,hi=vals.length?vals[Math.floor(vals.length*.97)]:1,span=Math.max(1e-6,hi-lo),rgba=new Uint8ClampedArray(width*height*4);let covered=0;
    for(let i=0;i<depth.length;i++){if(!(score[i]>0))continue;const t=clamp((depth[i]-lo)/span,0,1),c=heatColor(1-t),j=i*4;rgba[j]=c[0];rgba[j+1]=c[1];rgba[j+2]=c[2];rgba[j+3]=clamp(Math.round(100+155*Math.min(1,score[i]*4)),0,255);covered++;}
    fillTinyHoles(rgba,width,height);return {width,height,rgba,coverage:covered/(width*height),depthMin:lo,depthMax:hi,frameCenters:this.frameCenters(),depthMode:useMetric?'metric-best-confidence':'relative-overlap-consensus'};
  }

  sampleWorld(f,u,v,{allowFallback=true}={}){
    const ray=pixelRay(f.K,u,v),z=this.sampleMetricDepth(f,u,v);let optical=z,metric=true;if(!(optical>.08)){if(!allowFallback)return null;optical=clamp(f.fallbackDepth||this.fallbackDepth,.2,12);metric=false;}const range=optical/Math.max(.08,ray[2]),d=qRotate(f.pose.q,ray),p=[f.pose.p[0]+d[0]*range,f.pose.p[1]+d[1]*range,f.pose.p[2]+d[2]*range];return {p,r:distance(p,this.origin||[0,0,0]),metric};
  }

  sampleMetricDepth(f,u,v){
    if(f.metricDepth?.length){const z=bilinearImage(f.metricDepth,f.metricDepthWidth,f.metricDepthHeight,u/f.width*(f.metricDepthWidth-1),v/f.height*(f.metricDepthHeight-1));if(Number.isFinite(z)&&z>.08)return z;}
    const raw=this.sampleRelativeDepth(f,u,v),t=f.depthTransform;if(!t||!Number.isFinite(raw))return NaN;const z=predictDepth(t,raw);return Number.isFinite(z)&&z>.08&&z<30?z:NaN;
  }
  sampleRelativeDepth(f,u,v){if(!f.relativeDepth?.length)return NaN;return bilinearImage(f.relativeDepth,f.relativeDepthWidth,f.relativeDepthHeight,u/f.width*(f.relativeDepthWidth-1),v/f.height*(f.relativeDepthHeight-1));}
  frameHasMetricDepth(f){return !!(f?.metricDepth?.length||(f?.relativeDepth?.length&&f?.depthTransform?.mode&&(f.depthConfidence||0)>.004));}

  renderIndices(largest){const n=this.frames.length;if(n<=this.maxRenderFrames)return [...Array(n).keys()];const strong=[...largest].slice(-this.maxRenderFrames),set=new Set(strong);for(let i=n-1;i>=0&&set.size<this.maxRenderFrames;i--)set.add(i);return [...set].sort((a,b)=>a-b);}
  frameCenters(){this.recomputeVisualSolution();return this.frames.map((f,i)=>{const a=photoPixelToAtlas(f,f.visualQ||f.pose.q,f.K.cx,f.K.cy,this.width,this.height,this.visualSolution?.localWarp,i);return {i,x:a.x,y:a.y,connected:!!f.connected,visual:(this.visualSolution?.confidence?.[i]||0)>0,depth:this.frameHasMetricDepth(f),rawDepth:!!f.relativeDepth?.length,pending:!!f.depthPending};});}
  drawGraph(canvas,result){
    const ctx=canvas.getContext('2d'),sx=canvas.width/result.width,sy=canvas.height/result.height,centres=result.frameCenters||[],by=new Map(centres.map(c=>[c.i,c]));ctx.save();ctx.lineWidth=Math.max(1,canvas.width/480);ctx.globalAlpha=.58;for(const e of this.edges){const a=by.get(e.a),b=by.get(e.b);if(!a||!b)continue;ctx.strokeStyle=e.loop?'#7be495':'#d7f2ff';drawWrappedLine(ctx,a.x*sx,a.y*sy,b.x*sx,b.y*sy,canvas.width);}
    ctx.globalAlpha=.95;for(const c of centres){ctx.fillStyle=c.connected?(c.depth?'#7be495':c.rawDepth?'#f7d774':'#61d6ff'):'#ff8a8a';ctx.beginPath();ctx.arc(c.x*sx,c.y*sy,c.depth?2.9:c.pending?1.8:2.2,0,Math.PI*2);ctx.fill();}ctx.restore();
  }

  connectNewest(){
    const j=this.frames.length-1;if(j<=0)return;const candidates=new Set();for(let i=Math.max(0,j-this.temporalRadius);i<j;i++)candidates.add(i);
    // Long-range candidates are selected by image appearance. Alva pose is not
    // an admission test; it is saved for later metric/pose consistency checks.
    const targetHash=imageHash(this.frames[j]),loop=[];for(let i=0;i<j-this.temporalRadius-2;i++)loop.push({i,score:hashDistance(imageHash(this.frames[i]),targetHash)});loop.sort((a,b)=>a.score-b.score);for(const x of loop.slice(0,this.maxLoopCandidates))candidates.add(x.i);
    for(const i of candidates){const e=this.matchPair(i,j);if(!e)continue;this.edges.push(e);this.adj.get(i)?.push(e);this.adj.get(j)?.push(e);}this.depthScaleDirty=true;this.depthConsensusDirty=true;this.visualDirty=true;
  }
  matchPair(i,j){
    const a=this.frames[i],b=this.frames[j],far=Math.abs(i-j)>this.temporalRadius+1,raw=matchPhotoFeatures(a,b,{maxFeatures:320,maxMatches:170,maxHamming:70,minProbability:.025,patchRadius:2}),candidate=raw.filter(x=>x.probability>=Math.min(this.minEdgeProbability,.11));if(candidate.length<this.minEdgeMatches)return null;
    const reg=buildPhotoRegistrationEdge(a,b,candidate,{minMatches:this.minEdgeMatches,reprojectionPx:far?5.4:4.2,rotationInlierDeg:3.4});if(!reg)return null;const gain=estimateExposureGain(a,b,reg.matches);return {a:i,b:j,aId:a.frameId,bId:b.frameId,...reg,weight:reg.visualConfidence,loop:far,gainAB:gain,registration:'photo-ransac'};
  }
  components(){const seen=new Set(),out=[];for(let s=0;s<this.frames.length;s++){if(seen.has(s))continue;const q=[s],c=[];seen.add(s);while(q.length){const i=q.pop();c.push(i);for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(!seen.has(j)){seen.add(j);q.push(j);}}}out.push(c);}return out.sort((a,b)=>b.length-a.length);}
  recomputeConnectivity(){const largest=new Set(this.components()[0]||[]);this.frames.forEach((f,i)=>f.connected=largest.has(i));}
  recomputeVisualSolution(persisted=null){
    if(!persisted&&!this.visualDirty&&this.visualSolution)return;
    if(!this.frames.length){this.visualSolution=null;this.visualDirty=false;return;}
    const saved=persisted?.visualOrientations;if(Array.isArray(saved)&&saved.length===this.frames.length){const confidence=Float32Array.from(persisted.visualConfidence||saved.map((q,i)=>q?i===0?1:.25:0));this.visualSolution={orientations:saved.map((q,i)=>q?qNormalize(q):qNormalize(this.frames[i].pose.q)),confidence,rootIndex:0,parent:new Int32Array(this.frames.length)};}
    else this.visualSolution=solvePhotoOrientations(this.frames,this.edges,{iterations:8});
    this.visualSolution.localWarp=buildLocalPanoramaWarp(this.frames,this.edges,this.visualSolution,{width:this.width,height:this.height});this.frames.forEach((f,i)=>{f.visualQ=this.visualSolution.orientations[i];f.visualConfidence=this.visualSolution.confidence[i];});this.visualDirty=false;
  }
  rebuildDepthConsensusIfNeeded(){if(!this.depthConsensusDirty)return;this.depthConsensusDirty=false;this.depthConsensus=solvePhotoDepthConsensus(this.frames,this.edges,{minPairs:this.depthMinPairs,maxPairs:100});}
  exportState(){this.recomputeVisualSolution();this.rebuildDepthConsensusIfNeeded();return {format:'ROOMSCAN-LIVE-PHOTO-PANORAMA-2',photoFirst:true,stats:this.stats(),frames:this.frames.map((f,i)=>({frameId:String(f.frameId),alvaPose:clonePose(f.pose),poseCov:f.poseCov||null,K:{...f.K},width:f.width,height:f.height,at:f.at||0,visualQ:Array.from(f.visualQ||f.pose.q),visualConfidence:Number(this.visualSolution?.confidence?.[i]||0),hasRawDepth:!!f.relativeDepth?.length,hasMetricDepth:this.frameHasMetricDepth(f)})),edges:this.edges.map(e=>({a:e.a,b:e.b,aId:e.aId,bId:e.bId,loop:!!e.loop,visualRotation:Array.from(e.visualRotation||[]),visualConfidence:e.visualConfidence||0,homographyMedianErrorPx:e.homographyMedianErrorPx??null,visualMedianResidualRad:e.visualMedianResidualRad??null,matches:(e.matches||[]).slice(0,120).map(m=>({aU:m.aU,aV:m.aV,bU:m.bU,bV:m.bV,probability:m.probability,photometricProbability:m.photometricProbability,uniquenessProbability:m.uniquenessProbability}))})),localWarp:this.visualSolution?.localWarp?{anchorCount:this.visualSolution.localWarp.anchorCount,medianBaseResidualPx:this.visualSolution.localWarp.medianBaseResidualPx,p90BaseResidualPx:this.visualSolution.localWarp.p90BaseResidualPx}:null,depthConsensus:this.depthConsensus?{root:this.depthConsensus.root,stats:this.depthConsensus.stats,transforms:this.depthConsensus.transforms.map(t=>t?{a:t.a,b:t.b}:null),frameConfidence:Array.from(this.depthConsensus.frameConfidence),edges:this.depthConsensus.edges}:null};}
  recomputeOrigin(){
    // Intentionally fixed. A moving mean-camera origin makes already pasted RGB
    // slide on every new frame and looks like registration blur. Depth-aware
    // reprojection already accounts for parallax from translated cameras.
    if(!this.origin&&this.frames.length)this.origin=this.frames[0].pose.p.slice(0,3).map(Number);
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
    const deepFrames=this.frames.filter(f=>f.relativeDepth?.length);if(!deepFrames.length||!this.edges.length)return;
    try{
      const graph={format:'ROOMSCAN-PROB-GRAPH-1',frames:this.frames.map(f=>({frameId:String(f.frameId),posePrior:clonePose(f.pose),poseEstimate:clonePose(f.pose),poseCov:f.poseCov||null,K:{...f.K},width:f.width,height:f.height})),landmarkFactors:[],deepFactors:deepFrames.map(f=>({frameId:String(f.frameId),cols:f.relativeDepthWidth,rows:f.relativeDepthHeight,raw:f.relativeDepth,rawWidth:f.relativeDepthWidth,rawHeight:f.relativeDepthHeight,calibration:f.metricCalibration||null,quality:f.relativeQuality||null})),mvsFactors:[]};
      const components=this.components(),largest=components[0]||[],puzzle={frames:this.frames,edges:this.edges,components,stats:{largestComponent:largest.length,connectedFraction:this.frames.length?largest.length/this.frames.length:0}};
      const dsg=new DepthScaleGraph(graph,puzzle,{minPairs:this.depthMinPairs,regularizeIterations:this.depthRegularizeIterations}).build();this.depthScaleStats=dsg.stats;this.depthScaleModel=dsg.metricModel;this.depthScaleTransforms=dsg.transforms;
      for(const f of this.frames){const t=dsg.transforms.get(String(f.frameId));if(!t)continue;f.depthTransform=t;f.depthConfidence=Math.max(f.metricConfidence||0,dsg.frameConfidence(String(f.frameId)));const z=this.sampleMetricDepth(f,f.K.cx,f.K.cy);if(Number.isFinite(z)&&z>.08&&z<20){f.fallbackDepth=z;this.fallbackDepth=this.fallbackDepth*.94+z*.06;}}
    }catch(err){this.depthScaleStats={error:err?.message||String(err),metricRelativeError:Infinity,alignedFrames:0,metricPairs:0};}
  }
}

export function backProjectOpticalZ(pose,K,u,v,z){const ray=pixelRay(K,u,v),range=z/Math.max(.08,ray[2]),d=qRotate(pose.q,ray);return [pose.p[0]+d[0]*range,pose.p[1]+d[1]*range,pose.p[2]+d[2]*range];}
export function worldToAtlas(p,origin,width,height){const d=[p[0]-origin[0],p[1]-origin[1],p[2]-origin[2]],n=Math.hypot(...d)||1,yaw=Math.atan2(d[0],d[2]),pitch=Math.asin(clamp(d[1]/n,-1,1));return {x:wrap((yaw/(2*Math.PI)+.5)*width,width),y:clamp((pitch/Math.PI+.5)*height,0,height-1),r:n};}
export function predictDepth(transform,raw){if(!transform||!Number.isFinite(raw))return NaN;if(transform.mode==='direct')return transform.a*raw+transform.b;if(transform.mode==='inverse-raw')return transform.a/Math.max(EPS,Math.abs(raw))+transform.b;if(transform.mode==='inverse-depth'){const q=transform.a*raw+transform.b;return q>EPS?1/q:NaN;}return NaN;}

function compactCameraFrame(frame,maxSide){
  if(!frame?.frameId||!frame?.pose||!frame?.K||!frame?.gray?.length||!(frame.width>0&&frame.height>0))return null;const sw=frame.width,sh=frame.height,scale=Math.min(1,Math.max(96,+maxSide||256)/Math.max(sw,sh)),w=Math.max(32,Math.round(sw*scale)),h=Math.max(32,Math.round(sh*scale)),gray=new Uint8Array(w*h),rgb=new Uint8Array(w*h*3),sx=sw/w,sy=sh/h,rgba=frame.rgba;
  for(let y=0;y<h;y++){const yy=Math.min(sh-1,Math.floor((y+.5)*sy));for(let x=0;x<w;x++){const xx=Math.min(sw-1,Math.floor((x+.5)*sx)),si=yy*sw+xx,di=y*w+x;gray[di]=frame.gray[si];if(rgba?.length>=sw*sh*4){rgb[di*3]=rgba[si*4];rgb[di*3+1]=rgba[si*4+1];rgb[di*3+2]=rgba[si*4+2];}else{rgb[di*3]=rgb[di*3+1]=rgb[di*3+2]=gray[di];}}}
  const K={fx:frame.K.fx*w/sw,fy:frame.K.fy*h/sh,cx:frame.K.cx*w/sw,cy:frame.K.cy*h/sh,width:w,height:h},features=(frame.features||[]).filter(f=>Number.isFinite(f?.x)&&Number.isFinite(f?.y)).slice(0,420).map((f,index)=>({index,x:f.x*w/sw,y:f.y*h/sh,score:+(f.score||0),source:f.source||'mvs',desc:Array.from(f.desc||[]).slice(0,24)}));
  return {frameId:String(frame.frameId),pose:clonePose(frame.pose),poseCov:frame.poseCov||null,K,width:w,height:h,gray,rgb,features,at:Number(frame.at||frame.captureAt||0),metricLocked:!!frame.metricLocked};
}
function compactDepth(depth,w,h,maxSide,metric){const scale=Math.min(1,Math.max(48,+maxSide||168)/Math.max(w,h)),dw=Math.max(16,Math.round(w*scale)),dh=Math.max(16,Math.round(h*scale)),out=new Float32Array(dw*dh),vals=[];let good=0;for(let y=0;y<dh;y++){const sy=(y+.5)*h/dh-.5;for(let x=0;x<dw;x++){const sx=(x+.5)*w/dw-.5,v=bilinearImage(depth,w,h,sx,sy),i=y*dw+x;if(Number.isFinite(v)&&(metric?v>.08:Math.abs(v)>1e-9)&&(metric?v<30:true)){out[i]=v;good++;if((i&15)===0&&metric)vals.push(v);}else out[i]=NaN;}}vals.sort((a,b)=>a-b);return {depth:out,width:dw,height:dh,validRatio:good/Math.max(1,out.length),median:vals.length?vals[vals.length>>1]:NaN};}
function normaliseCalibration(c){if(!c||!c.ok||!['direct','inverse-raw','inverse-depth'].includes(c.mode)||!Number.isFinite(+c.a)||!Number.isFinite(+c.b))return null;return {ok:true,mode:c.mode,a:+c.a,b:+c.b,confidence:clamp(Number(c.posteriorConfidence??c.confidence??.05),.005,1),posteriorConfidence:clamp(Number(c.posteriorConfidence??c.confidence??.05),.005,1)};}
function compactQuality(q){return {suspicious:!!q?.suspicious,coherenceRatio:+(q?.coherenceRatio||0),stripe:{suspicious:!!q?.stripe?.suspicious,dominantExplained:+(q?.stripe?.dominantExplained||0),dominantCycles:+(q?.stripe?.dominantCycles||0)}};}
function estimateExposureGain(a,b,matches){const ratios=[];for(const m of matches){const va=sampleGray(a,m.aU,m.aV),vb=sampleGray(b,m.bU,m.bV);if(va>18&&vb>18&&va<245&&vb<245)ratios.push(va/vb);}if(ratios.length<3)return 1;ratios.sort((x,y)=>x-y);return clamp(ratios[ratios.length>>1],.65,1.5);}
function sampleGray(f,x,y){const xx=clamp(Math.round(x),0,f.width-1),yy=clamp(Math.round(y),0,f.height-1);return f.gray[yy*f.width+xx]||0;}

function splatPanoramaSharp(rgba,score,w,h,x,y,color,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.015)continue;const xx=wrap(xi+dx,w),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,j=i*4,qq=q*bw;if(!rgba[j+3]||qq>score[i]*1.025){score[i]=qq;rgba[j]=clamp(color[0],0,255);rgba[j+1]=clamp(color[1],0,255);rgba[j+2]=clamp(color[2],0,255);rgba[j+3]=clamp(75+qq*180,55,255);}else if(qq>score[i]*.90){const dr=Math.abs(rgba[j]-color[0])+Math.abs(rgba[j+1]-color[1])+Math.abs(rgba[j+2]-color[2]);if(dr<28){const a=.035;rgba[j]=rgba[j]*(1-a)+color[0]*a;rgba[j+1]=rgba[j+1]*(1-a)+color[1]*a;rgba[j+2]=rgba[j+2]*(1-a)+color[2]*a;}}}}
function splatDepthBest(depth,score,w,h,x,y,value,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.02)continue;const xx=wrap(xi+dx,w),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,qq=q*bw;if(!(score[i]>0)||qq>score[i]*1.04){depth[i]=value;score[i]=qq;}else if(qq>score[i]*.82&&Math.abs(value-depth[i])<Math.max(1e-4,.06*Math.max(Math.abs(value),Math.abs(depth[i])))){const a=qq/(score[i]+qq+EPS);depth[i]=depth[i]*(1-a)+value*a;score[i]=Math.max(score[i],qq);}}}
function imageHash(f){if(!f?.gray?.length)return 0n;let bits=0n,k=0n;for(let y=0;y<8;y++){const yy=Math.min(f.height-1,Math.floor((y+.5)*f.height/8));for(let x=0;x<8;x++){const a=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+.35)*f.width/9))],b=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+1.35)*f.width/9))];if(a>b)bits|=1n<<k;k++;}}return bits;}
function hashDistance(a,b){let x=a^b,n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;}
function splatPhotoSharp(rgba,radial,score,metricMask,w,h,x,y,r,color,q,metric){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.015)continue;const xx=wrap(xi+dx,w),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,j=i*4,qq=q*bw,oldMetric=metricMask[i]===1,oldR=radial[i],sameSurface=Number.isFinite(oldR)&&Math.abs(r-oldR)<Math.max(.035,.035*Math.min(r,oldR)),nearer=!Number.isFinite(oldR)||r<oldR-Math.max(.06,.035*r);let replace=false;
    if(!rgba[j+3])replace=true;else if(metric&&!oldMetric)replace=true;else if(!metric&&oldMetric)replace=false;else if(metric&&oldMetric&&!sameSurface)replace=nearer&&qq>score[i]*.42;else replace=qq>score[i]*1.025;
    if(replace){radial[i]=r;score[i]=qq;metricMask[i]=metric?1:0;rgba[j]=clamp(color[0],0,255);rgba[j+1]=clamp(color[1],0,255);rgba[j+2]=clamp(color[2],0,255);rgba[j+3]=metric?clamp(125+qq*130,0,255):clamp(42+qq*120,0,120);}
    else if(metric===oldMetric&&sameSurface&&qq>score[i]*.72){const dr=Math.abs(rgba[j]-color[0])+Math.abs(rgba[j+1]-color[1])+Math.abs(rgba[j+2]-color[2]);if(dr<38){const a=.08*qq/(score[i]+qq+EPS);rgba[j]=rgba[j]*(1-a)+color[0]*a;rgba[j+1]=rgba[j+1]*(1-a)+color[1]*a;rgba[j+2]=rgba[j+2]*(1-a)+color[2]*a;}}
  }}
function splatDepth(depth,weight,radial,w,h,x,y,r,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<=.02)continue;const xx=wrap(xi+dx,w),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,ww=q*bw;if(!Number.isFinite(radial[i])||r<radial[i]-.08){radial[i]=r;depth[i]=r;weight[i]=ww;}else if(Math.abs(r-radial[i])<Math.max(.04,.025*r)){const s=weight[i]+ww;depth[i]=(depth[i]*weight[i]+r*ww)/Math.max(EPS,s);weight[i]=s;}}}
function fillTinyHoles(rgba,w,h){const src=new Uint8ClampedArray(rgba);for(let y=1;y<h-1;y++)for(let x=0;x<w;x++){const i=y*w+x;if(src[i*4+3])continue;let r=0,g=0,b=0,a=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=wrap(x+dx,w),j=((y+dy)*w+xx)*4;if(src[j+3]>60){r+=src[j];g+=src[j+1];b+=src[j+2];a+=src[j+3];n++;}}if(n>=7){rgba[i*4]=r/n;rgba[i*4+1]=g/n;rgba[i*4+2]=b/n;rgba[i*4+3]=Math.min(150,a/n);}}}
function drawAtlas(canvas,a){const dpr=Math.min(2,globalThis.devicePixelRatio||1),rect=canvas.getBoundingClientRect(),cw=Math.max(1,Math.round((rect.width||a.width)*dpr)),ch=Math.max(1,Math.round((rect.height||a.height)*dpr));if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}const tmp=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(a.width,a.height):document.createElement('canvas');tmp.width=a.width;tmp.height=a.height;const g=tmp.getContext('2d'),img=new ImageData(a.rgba instanceof Uint8ClampedArray?a.rgba:new Uint8ClampedArray(a.rgba),a.width,a.height);g.putImageData(img,0,0);const out=canvas.getContext('2d');out.clearRect(0,0,cw,ch);out.imageSmoothingEnabled=true;out.drawImage(tmp,0,0,cw,ch);}
function drawWrappedLine(ctx,x1,y1,x2,y2,w){let dx=x2-x1;if(Math.abs(dx)>w/2){if(dx>0)x1+=w;else x2+=w;}ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();if(x1>w||x2>w){ctx.beginPath();ctx.moveTo(x1-w,y1);ctx.lineTo(x2-w,y2);ctx.stroke();}if(x1<0||x2<0){ctx.beginPath();ctx.moveTo(x1+w,y1);ctx.lineTo(x2+w,y2);ctx.stroke();}}
function heatColor(t){const x=clamp(t,0,1),r=Math.round(255*clamp(1.8-Math.abs(4*x-3),0,1)),g=Math.round(255*clamp(1.8-Math.abs(4*x-2),0,1)),b=Math.round(255*clamp(1.8-Math.abs(4*x-1),0,1));return [r,g,b];}
function quatAngle(a,b){a=qNormalize(a);b=qNormalize(b);return 2*Math.acos(Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3])));}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)};}
function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function wrap(x,n){x%=n;return x<0?x+n:x;}
function bilinearImage(a,w,h,x,y){if(!a?.length||!(w>0&&h>0))return NaN;x=clamp(x,0,w-1);y=clamp(y,0,h-1);const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0,v00=a[y0*w+x0],v10=a[y0*w+x1],v01=a[y1*w+x0],v11=a[y1*w+x1];const vals=[[v00,(1-tx)*(1-ty)],[v10,tx*(1-ty)],[v01,(1-tx)*ty],[v11,tx*ty]].filter(([v])=>Number.isFinite(v));if(!vals.length)return NaN;let sw=0,s=0;for(const [v,ww] of vals){sw+=ww;s+=v*ww;}return sw>EPS?s/sw:vals[0][0];}
