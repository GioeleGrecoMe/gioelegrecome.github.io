/**
 * Select geometrically useful keyframes for the expensive dense pipeline.
 *
 * A frame is not useful merely because time passed: it must keep overlap with
 * the existing sparse scaffold while contributing parallax/coverage.  The
 * selector exposes observability diagnostics so a downstream depth calibrator
 * can reduce its DOF on planar or weak-baseline views.
 */
export class DeepKeyframeSelector{
  constructor({minIntervalMs=2600,maxIntervalMs=8000,minTranslationM=.20,minTranslationAlva=.10,minRotationRad=.16,minAnchors=7,minAnchorCells=3,depthNovelty=.22,minMedianAngleRad=.008,strongMedianAngleRad=.018}={}){Object.assign(this,{minIntervalMs,maxIntervalMs,minTranslationM,minTranslationAlva,minRotationRad,minAnchors,minAnchorCells,depthNovelty,minMedianAngleRad,strongMedianAngleRad});this.last=null;this.attempt=null;}
  evaluate({ref,sparseSeeds=[],metricLocked=false}={}){
    if(!ref?.pose)return {infer:false,reason:'no-pose'};
    const rgbQuality=Number(ref.photoQuality?.score??.65);if(ref.photoQuality?.severe)return {infer:false,reason:'rgb-quality-severe',rgbQuality,photoQuality:ref.photoQuality};
    const cells=coverageCells(sparseSeeds,ref.width,ref.height),anchors=sparseSeeds.length,angles=sparseSeeds.map(s=>+s.angle).filter(x=>Number.isFinite(x)&&x>0),medianAngle=angles.length?median(angles):.012,depths=sparseSeeds.map(s=>+s.depth).filter(x=>x>0),depthSpan=robustRelativeSpan(depths),parallaxScore=Math.min(1,medianAngle/Math.max(1e-4,this.strongMedianAngleRad));
    if(anchors<this.minAnchors)return {infer:false,reason:'too-few-anchors',anchors,cells,medianAngle,depthSpan,parallaxScore};
    if(cells<this.minAnchorCells)return {infer:false,reason:'anchors-clustered',anchors,cells,medianAngle,depthSpan,parallaxScore};
    const at=Number(ref.at||0),medianDepth=median(depths),base=this.last||this.attempt;if(!base)return {infer:true,reason:medianAngle>=this.minMedianAngleRad?'first-observable-view':'first-overlap-view',anchors,cells,medianDepth,medianAngle,depthSpan,parallaxScore};
    const elapsed=Math.max(0,at-base.at),translation=distance(ref.pose.p,base.pose.p),rotation=quatAngle(ref.pose.q,base.pose.q),threshold=metricLocked?this.minTranslationM:this.minTranslationAlva,depthChange=Number.isFinite(medianDepth)&&Number.isFinite(base.medianDepth)?Math.abs(medianDepth-base.medianDepth)/Math.max(.05,base.medianDepth):0;
    const common={anchors,cells,elapsed,translation,rotation,depthChange,medianDepth,medianAngle,depthSpan,parallaxScore,rgbQuality};
    if(elapsed<this.minIntervalMs)return {infer:false,reason:'cooldown',...common};
    if(elapsed>=this.maxIntervalMs)return {infer:true,reason:medianAngle>=this.minMedianAngleRad?'max-interval-observable':'max-interval-depth-only',...common};
    // Translation + actual triangulation angle is the strongest signal. Pure
    // rotation is useful for coverage/panorama but weak for geometric depth.
    if(translation>=threshold&&medianAngle>=this.minMedianAngleRad)return {infer:true,reason:'new-parallax',...common};
    if(depthChange>=this.depthNovelty&&medianAngle>=this.minMedianAngleRad)return {infer:true,reason:'new-depth-context',...common};
    if(rotation>=this.minRotationRad&&cells>=this.minAnchorCells+1)return {infer:true,reason:'new-view-direction',...common};
    return {infer:false,reason:medianAngle<this.minMedianAngleRad?'weak-parallax':'near-duplicate',...common};
  }
  noteAttempt(ref,sparseSeeds=[]){if(!ref?.pose)return;this.attempt=snapshot(ref,sparseSeeds);}
  commit(ref,sparseSeeds=[]){if(!ref?.pose)return;this.last=snapshot(ref,sparseSeeds);this.attempt=null;}
  fail(){this.attempt=null;}
  reset(){this.last=null;this.attempt=null;}
}
function snapshot(ref,seeds){return {at:Number(ref.at||0),pose:clonePose(ref.pose),medianDepth:median(seeds.map(s=>s.depth).filter(Number.isFinite)),medianAngle:median(seeds.map(s=>s.angle).filter(Number.isFinite))};}
function coverageCells(seeds,w=1,h=1,cols=4,rows=6){const s=new Set();for(const p of seeds||[]){if(!Number.isFinite(p?.u+p?.v))continue;const x=Math.max(0,Math.min(cols-1,Math.floor(p.u/Math.max(1,w)*cols))),y=Math.max(0,Math.min(rows-1,Math.floor(p.v/Math.max(1,h)*rows)));s.add(`${x},${y}`);}return s.size;}
function robustRelativeSpan(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(b.length<3)return 0;const lo=q(b,.1),hi=q(b,.9),m=q(b,.5);return (hi-lo)/Math.max(.05,m);}
function q(a,t){const z=(a.length-1)*t,i=Math.floor(z),f=z-i;return a[i]*(1-f)+a[Math.min(a.length-1,i+1)]*f;}
function distance(a=[0,0,0],b=[0,0,0]){return Math.hypot((a[0]||0)-(b[0]||0),(a[1]||0)-(b[1]||0),(a[2]||0)-(b[2]||0));}
function quatAngle(a=[0,0,0,1],b=[0,0,0,1]){const na=Math.hypot(...a)||1,nb=Math.hypot(...b)||1,d=Math.min(1,Math.abs((a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3])/(na*nb)));return 2*Math.acos(d);}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)};}
function median(a){if(!a.length)return NaN;const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
