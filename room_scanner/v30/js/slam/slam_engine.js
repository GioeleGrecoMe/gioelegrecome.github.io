import {poseIdentity,qNormalize,qConj,qMul,qRotate} from './math.js';
import {applySimilarityPose} from './alva_metric_bootstrap.js';

/**
 * AlvaAR world tracker wrapper.
 *
 * V30.14 rule: calibration never drives the trajectory. A one-shot Sim(3)
 * transform may map Alva's arbitrary world units into metres, but every camera
 * motion after that comes exclusively from AlvaAR.findCameraPose(). If Alva
 * loses tracking we freeze the pose and suspend keyframe/MVS generation until
 * Alva returns a pose (relocalisation), rather than integrating a second flow
 * tracker that would bend the map.
 */
export class SlamEngine extends EventTarget{
  constructor({frontend,K=null,log=null,keyframeIntervalMs=950}={}){
    super();this.frontend=frontend;this.K=K;this.log=log;this.pose=poseIdentity();this.metricLocked=false;this.metricScale=null;this.worldTransform=null;this.lastAt=0;this.frameIndex=0;this.keyframes=[];this.keyframeIntervalMs=keyframeIntervalMs;this.alvaTrackedFrames=0;this.alvaLostFrames=0;this.wasLost=false;this.referenceDepthM=null;
  }
  setIntrinsics(K){this.K=K;}
  setWorldTransform(sim){
    if(!sim||!Number.isFinite(sim.scale)||sim.scale<=0||!Array.isArray(sim.qAlign)||!Array.isArray(sim.translation))throw new Error('valid Alva->metric Sim(3) required');
    this.worldTransform={scale:+sim.scale,qAlign:qNormalize(sim.qAlign.slice(0,4).map(Number)),translation:sim.translation.slice(0,3).map(Number),source:sim.source||'metric-bootstrap',positionRmseM:sim.positionRmseM??null,orientationRmseRad:sim.orientationRmseRad??null};
    this.metricScale=this.worldTransform.scale;this.metricLocked=true;this.log?.info('alva-world-transform-locked',this.worldTransform);this.dispatchEvent(new CustomEvent('metric',{detail:{...this.worldTransform}}));return this.worldTransform;
  }
  /** Backward-compatible explicit scale helper; does not invent orientation. */
  setMetricScale(scale=1){if(!Number.isFinite(scale)||scale<=0)throw new Error('metric scale must be positive');this.metricScale=scale;return scale;}
  /**
   * Kept for profile compatibility only. It sets the displayed origin before a
   * Sim(3) bootstrap, but intentionally does NOT mark the tracker metric.
   */
  setMetricReference({pose=null}={}){if(pose?.p?.length>=3&&pose?.q?.length>=4)this.pose={p:pose.p.slice(0,3).map(Number),q:qNormalize(pose.q.slice(0,4).map(Number))};this.metricLocked=!!this.worldTransform;return {pose:this.pose,metricLocked:this.metricLocked};}
  process(frame){
    const r=this.frontend.processFrame(frame,{maxFeatures:850,threshold:9});
    const raw=r.cameraPose?alvaMatrixToPose(r.cameraPose):null;
    let trackingMode='alvaar-lost',trackingValid=false,relocalized=false;
    if(raw){
      trackingValid=true;relocalized=this.wasLost&&this.alvaTrackedFrames>0;this.wasLost=false;this.alvaLostFrames=0;this.alvaTrackedFrames++;
      this.pose=this.worldTransform?applySimilarityPose(this.worldTransform,raw):raw;
      trackingMode=relocalized?'alvaar-relocalized':'alvaar-wasm';
    }else{this.alvaLostFrames++;this.wasLost=true;}

    const now=frame.at||performance.now();let newKeyframe=null;
    if(trackingValid&&(!this.lastAt||now-this.lastAt>=this.keyframeIntervalMs)){
      newKeyframe={id:`kf-${this.frameIndex}`,at:now,pose:clonePose(this.pose),rawPose:clonePose(raw),features:(r.features||[]).map(f=>({x:+f.x,y:+f.y,score:+(f.score||0),desc:Array.from(f.desc||[])})),width:frame.width,height:frame.height,trackingMode,metricLocked:this.metricLocked,geometry:frame.geometry||null};
      this.keyframes.push(newKeyframe);this.lastAt=now;if(this.keyframes.length>520)this.keyframes.shift();
    }
    const detail={frame:this.frameIndex++,pose:clonePose(this.pose),rawPose:raw?clonePose(raw):null,features:r.count||0,matches:r.matches?.count||0,keyframes:this.keyframes.length,newKeyframe,metricLocked:this.metricLocked,metricScale:this.metricScale,trackingMode,trackingValid,relocalized,alvaPoints:r.framePoints?.length||0,framePoints:Array.from(r.framePoints||[]),lostFrames:this.alvaLostFrames};
    this.dispatchEvent(new CustomEvent('tracking',{detail}));if(newKeyframe)this.dispatchEvent(new CustomEvent('keyframe',{detail:newKeyframe}));return detail;
  }
}

/** AlvaAR 4x4 camera pose -> Room Scanner (+X right,+Y up,+Z forward) pose. */
export function alvaMatrixToPose(a){
  if(!a||a.length<16)throw new TypeError('Alva 4x4 pose required');const r=matrixQuaternion(a);return {p:[+a[12],-a[13],-a[14]],q:qNormalize([-r[0],r[1],r[2],r[3]])};
}
function matrixQuaternion(te){const m11=+te[0],m12=+te[4],m13=+te[8],m21=+te[1],m22=+te[5],m23=+te[9],m31=+te[2],m32=+te[6],m33=+te[10],trace=m11+m22+m33;let x,y,z,w,s;if(trace>0){s=.5/Math.sqrt(trace+1);w=.25/s;x=(m32-m23)*s;y=(m13-m31)*s;z=(m21-m12)*s;}else if(m11>m22&&m11>m33){s=2*Math.sqrt(1+m11-m22-m33);w=(m32-m23)/s;x=.25*s;y=(m12+m21)/s;z=(m13+m31)/s;}else if(m22>m33){s=2*Math.sqrt(1+m22-m11-m33);w=(m13-m31)/s;x=(m12+m21)/s;y=.25*s;z=(m23+m32)/s;}else{s=2*Math.sqrt(1+m33-m11-m22);w=(m21-m12)/s;x=(m13-m31)/s;y=(m23+m32)/s;z=.25*s;}return qNormalize([x,y,z,w]);}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:qNormalize(p.q.slice(0,4).map(Number))};}
