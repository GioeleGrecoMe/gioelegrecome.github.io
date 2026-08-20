/**
 * Spatial/temporal gate for expensive monocular depth inference.
 *
 * The selector intentionally answers "no" for near-duplicate views. Dense AI
 * is requested only when a keyframe contributes genuinely new room context and
 * already has enough Alva-triangulated anchors to calibrate the relative map.
 */
export class DeepKeyframeSelector{
  constructor({minIntervalMs=2600,maxIntervalMs=8000,minTranslationM=.20,minTranslationAlva=.10,minRotationRad=.16,minAnchors=7,minAnchorCells=3,depthNovelty=.22}={}){Object.assign(this,{minIntervalMs,maxIntervalMs,minTranslationM,minTranslationAlva,minRotationRad,minAnchors,minAnchorCells,depthNovelty});this.last=null;this.attempt=null;}
  evaluate({ref,sparseSeeds=[],metricLocked=false}={}){
    if(!ref?.pose)return {infer:false,reason:'no-pose'};
    const cells=coverageCells(sparseSeeds,ref.width,ref.height),anchors=sparseSeeds.length;
    if(anchors<this.minAnchors)return {infer:false,reason:'too-few-anchors',anchors,cells};
    if(cells<this.minAnchorCells)return {infer:false,reason:'anchors-clustered',anchors,cells};
    const at=Number(ref.at||0),medianDepth=median(sparseSeeds.map(s=>s.depth).filter(Number.isFinite));
    const base=this.last||this.attempt;if(!base)return {infer:true,reason:'first-calibratable-view',anchors,cells,medianDepth};
    const elapsed=Math.max(0,at-base.at),translation=distance(ref.pose.p,base.pose.p),rotation=quatAngle(ref.pose.q,base.pose.q),threshold=metricLocked?this.minTranslationM:this.minTranslationAlva;
    const depthChange=Number.isFinite(medianDepth)&&Number.isFinite(base.medianDepth)?Math.abs(medianDepth-base.medianDepth)/Math.max(.05,base.medianDepth):0;
    if(elapsed<this.minIntervalMs)return {infer:false,reason:'cooldown',anchors,cells,elapsed,translation,rotation,depthChange};
    if(elapsed>=this.maxIntervalMs)return {infer:true,reason:'max-interval',anchors,cells,elapsed,translation,rotation,depthChange,medianDepth};
    if(translation>=threshold)return {infer:true,reason:'new-position',anchors,cells,elapsed,translation,rotation,depthChange,medianDepth};
    if(rotation>=this.minRotationRad)return {infer:true,reason:'new-view-direction',anchors,cells,elapsed,translation,rotation,depthChange,medianDepth};
    if(depthChange>=this.depthNovelty)return {infer:true,reason:'new-depth-context',anchors,cells,elapsed,translation,rotation,depthChange,medianDepth};
    return {infer:false,reason:'near-duplicate',anchors,cells,elapsed,translation,rotation,depthChange};
  }
  noteAttempt(ref,sparseSeeds=[]){if(!ref?.pose)return;this.attempt={at:Number(ref.at||0),pose:clonePose(ref.pose),medianDepth:median(sparseSeeds.map(s=>s.depth).filter(Number.isFinite))};}
  commit(ref,sparseSeeds=[]){if(!ref?.pose)return;this.last={at:Number(ref.at||0),pose:clonePose(ref.pose),medianDepth:median(sparseSeeds.map(s=>s.depth).filter(Number.isFinite))};this.attempt=null;}
  fail(){this.attempt=null;}
  reset(){this.last=null;this.attempt=null;}
}
function coverageCells(seeds,w=1,h=1,cols=4,rows=6){const s=new Set();for(const p of seeds||[]){if(!Number.isFinite(p?.u+p?.v))continue;const x=Math.max(0,Math.min(cols-1,Math.floor(p.u/Math.max(1,w)*cols))),y=Math.max(0,Math.min(rows-1,Math.floor(p.v/Math.max(1,h)*rows)));s.add(`${x},${y}`);}return s.size;}
function distance(a=[0,0,0],b=[0,0,0]){return Math.hypot((a[0]||0)-(b[0]||0),(a[1]||0)-(b[1]||0),(a[2]||0)-(b[2]||0));}
function quatAngle(a=[0,0,0,1],b=[0,0,0,1]){const na=Math.hypot(...a)||1,nb=Math.hypot(...b)||1,d=Math.min(1,Math.abs((a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3])/(na*nb)));return 2*Math.acos(d);}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)};}
function median(a){if(!a.length)return NaN;const b=a.slice().sort((x,y)=>x-y);return b[b.length>>1];}
