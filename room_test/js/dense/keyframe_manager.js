import {poseDistance,qNormalize} from '../slam/math.js';

/**
 * Selects a tiny local view graph for dense reconstruction while AlvaAR keeps
 * tracking at full rate. Images are downsampled once when a SLAM keyframe is
 * accepted, then old images are discarded aggressively to bound phone memory.
 */
export class DenseKeyframeManager{
  constructor({width=160,height=240,deepWidth=224,deepHeight=336,maxFrames=8,minSources=2,maxSources=4,minBaseline=.035,maxBaseline=.75,maxAngleRad=.38,minIntervalMs=650}={}){
    Object.assign(this,{width,height,deepWidth,deepHeight,maxFrames,minSources,maxSources,minBaseline,maxBaseline,maxAngleRad,minIntervalMs});this.frames=[];this.processed=new Set();this.lastAcceptedAt=0;
  }
  add(kf,frame,K,{metricLocked=false}={}){
    if(!kf?.pose||!frame?.gray||!K)return null;const kfFrameId=String(kf.frameId||''),cameraFrameId=String(frame.frameId||'');if(kfFrameId&&cameraFrameId&&kfFrameId!==cameraFrameId)throw new Error(`Dense frame sync mismatch: keyframe ${kfFrameId} != camera ${cameraFrameId}`);if(Number.isFinite(kf.at)&&Number.isFinite(frame.at)&&Math.abs(kf.at-frame.at)>.05)throw new Error(`Dense frame time mismatch: ${Math.abs(kf.at-frame.at).toFixed(3)} ms`);if(this.lastAcceptedAt&&kf.at-this.lastAcceptedAt<this.minIntervalMs)return null;
    const dense=downsampleFrame(frame,K,this.width,this.height),deep=downsampleRgba(frame,this.deepWidth,this.deepHeight);const item={id:kf.id,frameId:kfFrameId||cameraFrameId||String(kf.id),captureAt:Number(frame.at),at:kf.at,pose:clonePose(kf.pose),rawPose:kf.rawPose?clonePose(kf.rawPose):null,poseCov:kf.poseCov?{...kf.poseCov,diag:Array.isArray(kf.poseCov.diag)?kf.poseCov.diag.slice(0,6):null}:null,K:dense.K,width:this.width,height:this.height,gray:dense.gray,rgba:dense.rgba,deepWidth:this.deepWidth,deepHeight:this.deepHeight,deepRgba:deep,features:scaleFeatures(kf.features||[],frame.width,frame.height,this.width,this.height),metricLocked};
    this.frames.push(item);this.lastAcceptedAt=kf.at;while(this.frames.length>this.maxFrames){const old=this.frames.shift();this.processed.delete(old.id);}return item;
  }
  /** Return a reference + 2..4 geometrically useful neighbours, or null. */
  nextJob(){
    if(this.frames.length<this.minSources+1)return null;
    // Prefer a slightly older reference so we can use views on both temporal
    // sides. This improves occlusion robustness without taking more photos.
    for(let ri=Math.max(0,this.frames.length-4);ri<this.frames.length-1;ri++){
      const ref=this.frames[ri];if(this.processed.has(ref.id))continue;const candidates=[];
      for(let i=0;i<this.frames.length;i++){if(i===ri)continue;const s=this.frames[i],baseline=poseDistance(ref.pose,s.pose),angle=quatAngle(ref.pose.q,s.pose.q);if(baseline<this.minBaseline||baseline>this.maxBaseline||angle>this.maxAngleRad)continue;const temporal=Math.abs(i-ri),score=baseline*(1-.45*angle/Math.max(.01,this.maxAngleRad))+.01*temporal;candidates.push({s,baseline,angle,score});}
      candidates.sort((a,b)=>b.score-a.score);const picked=[];
      for(const c of candidates){if(picked.some(p=>Math.abs(p.baseline-c.baseline)<this.minBaseline*.35&&quatAngle(p.s.pose.q,c.s.pose.q)<.06))continue;picked.push(c);if(picked.length>=this.maxSources)break;}
      if(picked.length>=this.minSources){this.processed.add(ref.id);return {ref,sources:picked.map(x=>x.s),baselines:picked.map(x=>x.baseline),angles:picked.map(x=>x.angle)};}
    }
    return null;
  }
  release(id){if(id)this.processed.delete(id);}
  reset(){this.frames.length=0;this.processed.clear();this.lastAcceptedAt=0;}
}

export function downsampleFrame(frame,K,width,height){
  const sw=frame.width,sh=frame.height,gray=new Uint8Array(width*height),rgba=new Uint8ClampedArray(width*height*4),sx=sw/width,sy=sh/height;
  for(let y=0;y<height;y++){const yy=Math.min(sh-1,Math.floor((y+.5)*sy));for(let x=0;x<width;x++){const xx=Math.min(sw-1,Math.floor((x+.5)*sx)),si=yy*sw+xx,di=y*width+x;gray[di]=frame.gray[si];const sr=si*4,dr=di*4;rgba[dr]=frame.rgba[sr];rgba[dr+1]=frame.rgba[sr+1];rgba[dr+2]=frame.rgba[sr+2];rgba[dr+3]=255;}}
  return {gray,rgba,K:{fx:K.fx*width/sw,fy:K.fy*height/sh,cx:K.cx*width/sw,cy:K.cy*height/sh,width,height}};
}
/**
 * Keep a second, still-small raster for pose-associated Deep inference.  The
 * multi-view CPU path stays 160x240, while Deep sees roughly the same spatial
 * support as its 224px model input instead of an already-decimated image that
 * would be upscaled again by the ONNX preprocessor.
 */
export function downsampleRgba(frame,width,height){
  const sw=frame.width,sh=frame.height,rgba=new Uint8ClampedArray(width*height*4),sx=sw/width,sy=sh/height;
  for(let y=0;y<height;y++){const yy=Math.min(sh-1,Math.floor((y+.5)*sy));for(let x=0;x<width;x++){const xx=Math.min(sw-1,Math.floor((x+.5)*sx)),si=(yy*sw+xx)*4,di=(y*width+x)*4;rgba[di]=frame.rgba[si];rgba[di+1]=frame.rgba[si+1];rgba[di+2]=frame.rgba[si+2];rgba[di+3]=255;}}
  return rgba;
}
function quatAngle(a,b){a=qNormalize(a);b=qNormalize(b);const d=Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]));return 2*Math.acos(d);}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)};}

function scaleFeatures(fs,sw,sh,dw,dh){const sx=dw/sw,sy=dh/sh;return (fs||[]).filter(f=>Number.isFinite(f?.x)&&Number.isFinite(f?.y)&&Array.isArray(f?.desc)).map(f=>({x:f.x*sx,y:f.y*sy,score:+(f.score||0),source:f.source||'mvs',desc:Array.from(f.desc)}));}
