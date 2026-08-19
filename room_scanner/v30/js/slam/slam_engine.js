import {poseIdentity,projectPoint,qNormalize,qConj,qMul,qRotate} from './math.js';

/**
 * Camera-only metric tracker.
 *
 * V30.13 uses the real AlvaAR WASM pose whenever available. Alva's monocular
 * translation has an arbitrary global scale, so calibration supplies the world
 * origin/orientation while a short sequence of calibrated optical-flow motion
 * estimates the single Alva->metre scale factor. Once stable, all keyframes are
 * driven by the Alva pose; the old flow tracker remains only as a graceful
 * fallback when Alva is loading or temporarily loses tracking.
 */
export class SlamEngine extends EventTarget{
  constructor({frontend,K=null,log=null,keyframeIntervalMs=950}={}){
    super();this.frontend=frontend;this.K=K;this.log=log;this.pose=poseIdentity();this.metricLocked=false;this.metricScale=1;this.referenceDepthM=1.5;this.lastAt=0;this.frameIndex=0;this.keyframes=[];this.keyframeIntervalMs=keyframeIntervalMs;
    this.rawAnchor=null;this.metricAnchor=null;this.qAlign=null;this.lastRaw=null;this.alvaScale=null;this.scaleSamples=[];this.alvaTrackedFrames=0;this.alvaLostFrames=0;
  }
  setIntrinsics(K){this.K=K;}
  setMetricScale(scale=1){if(!Number.isFinite(scale)||scale<=0)throw new Error('metric scale must be positive');this.metricScale=scale;this.metricLocked=true;this.dispatchEvent(new CustomEvent('metric',{detail:{scale,referenceDepthM:this.referenceDepthM}}));}
  setMetricReference({pose=null,points=[]}={}){
    if(pose?.p?.length>=3&&pose?.q?.length>=4)this.pose={p:pose.p.slice(0,3).map(Number),q:qNormalize(pose.q.slice(0,4).map(Number))};
    const depths=[];if(this.K&&Array.isArray(points))for(const p of points){if(!Array.isArray(p)||p.length<3)continue;const pr=projectPoint(this.pose,this.K,p);if(pr&&Number.isFinite(pr.z)&&pr.z>.20&&pr.z<20)depths.push(pr.z);}
    if(depths.length){depths.sort((a,b)=>a-b);this.referenceDepthM=median(depths);}
    this.metricLocked=true;this.metricScale=1;this.rawAnchor=null;this.metricAnchor=null;this.qAlign=null;this.lastRaw=null;this.alvaScale=null;this.scaleSamples=[];
    this.log?.info('slam-metric-reference',{pose:this.pose,referenceDepthM:this.referenceDepthM,pins:depths.length});this.dispatchEvent(new CustomEvent('metric',{detail:{scale:1,referenceDepthM:this.referenceDepthM,pose:this.pose}}));return {pose:this.pose,referenceDepthM:this.referenceDepthM,pins:depths.length};
  }
  process(frame){
    const r=this.frontend.processFrame?this.frontend.processFrame(frame,{maxFeatures:850,threshold:9}):this.frontend.process(frame.gray,frame.width,frame.height,{maxFeatures:850,threshold:9});
    const flowDelta=this._flowMetricDelta(r.matches?.items||[],frame);
    const raw=r.cameraPose?alvaMatrixToPose(r.cameraPose):null;
    let trackingMode='feature-flow-fallback';
    if(raw){trackingMode='alvaar-wasm';this.alvaTrackedFrames++;this.alvaLostFrames=0;this._applyAlva(raw,flowDelta);}
    else{this.alvaLostFrames++;if(flowDelta)this.pose.p=this.pose.p.map((v,i)=>v+flowDelta[i]);}

    const now=frame.at||performance.now();let newKeyframe=null;
    if(!this.lastAt||now-this.lastAt>=this.keyframeIntervalMs){newKeyframe={id:`kf-${this.frameIndex}`,at:now,pose:{p:[...this.pose.p],q:[...this.pose.q]},features:(r.features||[]).map(f=>({x:+f.x,y:+f.y,score:+(f.score||0),desc:Array.from(f.desc||[])})),width:frame.width,height:frame.height,trackingMode,alvaScale:this.alvaScale,geometry:frame.geometry||null};this.keyframes.push(newKeyframe);this.lastAt=now;if(this.keyframes.length>520)this.keyframes.shift();}
    const detail={frame:this.frameIndex++,pose:{p:[...this.pose.p],q:[...this.pose.q]},features:r.count,matches:r.matches?.count||0,keyframes:this.keyframes.length,newKeyframe,metricLocked:this.metricLocked,referenceDepthM:this.referenceDepthM,trackingMode,alvaScale:this.alvaScale,scaleSamples:this.scaleSamples.length,alvaPoints:r.framePoints?.length||0};
    this.dispatchEvent(new CustomEvent('tracking',{detail}));if(newKeyframe)this.dispatchEvent(new CustomEvent('keyframe',{detail:newKeyframe}));return detail;
  }
  _flowMetricDelta(matches,frame){
    if(!matches.length)return null;const dx=median(matches.map(m=>m.dx)),dy=median(matches.map(m=>m.dy)),fx=this.K?.fx||frame.width,fy=this.K?.fy||frame.height,z=this.metricLocked?this.referenceDepthM:.35,dxM=(-dx/Math.max(1,fx))*z*this.metricScale,dyM=(dy/Math.max(1,fy))*z*this.metricScale;return qRotate(this.pose.q,[dxM,dyM,0]);
  }
  _applyAlva(raw,flowDelta){
    if(!this.qAlign){this.qAlign=qNormalize(qMul(this.pose.q,qConj(raw.q)));this.rawAnchor=[...raw.p];this.metricAnchor=[...this.pose.p];this.lastRaw=raw;this.pose.q=qNormalize(qMul(this.qAlign,raw.q));return;}
    const alignedQ=qNormalize(qMul(this.qAlign,raw.q));
    if(this.lastRaw&&flowDelta){
      const rd=sub(raw.p,this.lastRaw.p),rawDist=Math.hypot(...rd),flowDist=Math.hypot(...flowDelta);
      if(rawDist>1e-5&&flowDist>.00025&&flowDist<.20){const ratio=flowDist/rawDist;if(Number.isFinite(ratio)&&ratio>.002&&ratio<200){this.scaleSamples.push(ratio);if(this.scaleSamples.length>31)this.scaleSamples.shift();}}
    }
    // Bootstrap translation with calibrated flow until enough samples establish
    // the single monocular scale. Rotation already comes from Alva immediately.
    if(this.alvaScale==null&&this.scaleSamples.length>=5){const s=trimmedMedian(this.scaleSamples);if(Number.isFinite(s)&&s>0){this.alvaScale=s;this.rawAnchor=[...raw.p];this.metricAnchor=[...this.pose.p];this.log?.info('alvaar-metric-scale',{scale:s,samples:this.scaleSamples.length,referenceDepthM:this.referenceDepthM});}}
    if(this.alvaScale!=null){const delta=qRotate(this.qAlign,sub(raw.p,this.rawAnchor).map(v=>v*this.alvaScale));this.pose.p=this.metricAnchor.map((v,i)=>v+delta[i]);}
    else if(flowDelta)this.pose.p=this.pose.p.map((v,i)=>v+flowDelta[i]);
    this.pose.q=alignedQ;this.lastRaw=raw;
  }
}

/** AlvaAR -> Room Scanner camera pose, matching the official THREE connector. */
export function alvaMatrixToPose(a){
  if(!a||a.length<16)throw new TypeError('Alva 4x4 pose required');const r=matrixQuaternion(a);return {p:[+a[12],-a[13],-a[14]],q:qNormalize([-r[0],r[1],r[2],r[3]])};
}
function matrixQuaternion(te){
  const m11=+te[0],m12=+te[4],m13=+te[8],m21=+te[1],m22=+te[5],m23=+te[9],m31=+te[2],m32=+te[6],m33=+te[10],trace=m11+m22+m33;let x,y,z,w,s;
  if(trace>0){s=.5/Math.sqrt(trace+1);w=.25/s;x=(m32-m23)*s;y=(m13-m31)*s;z=(m21-m12)*s;}
  else if(m11>m22&&m11>m33){s=2*Math.sqrt(1+m11-m22-m33);w=(m32-m23)/s;x=.25*s;y=(m12+m21)/s;z=(m13+m31)/s;}
  else if(m22>m33){s=2*Math.sqrt(1+m22-m11-m33);w=(m13-m31)/s;x=(m12+m21)/s;y=.25*s;z=(m23+m32)/s;}
  else{s=2*Math.sqrt(1+m33-m11-m22);w=(m21-m12)/s;x=(m13+m31)/s;y=(m23+m32)/s;z=.25*s;}
  return qNormalize([x,y,z,w]);
}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function median(a){if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2;}
function trimmedMedian(a){const b=[...a].filter(Number.isFinite).sort((x,y)=>x-y);if(b.length>8){const n=Math.floor(b.length*.15);return median(b.slice(n,b.length-n));}return median(b);}
