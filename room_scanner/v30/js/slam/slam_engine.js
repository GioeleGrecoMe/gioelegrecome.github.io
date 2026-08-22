import {poseIdentity,qNormalize,qConj,qMul,qRotate} from './math.js?v=30.52.0';
import {applySimilarityPose} from './alva_metric_bootstrap.js?v=30.52.0';
import {estimatePoseCovariance} from '../probabilistic/pose_uncertainty.js?v=30.52.0';

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
  constructor({frontend,K=null,log=null,keyframeIntervalMs=950,observationIntervalMs=900,maxObservations=12}={}){
    super();this.frontend=frontend;this.K=K;this.log=log;this.pose=poseIdentity();this.metricLocked=false;this.metricScale=null;this.worldTransform=null;this.lastAt=0;this.lastObservationAt=0;this.frameIndex=0;this.keyframes=[];this.observations=[];this.keyframeIntervalMs=keyframeIntervalMs;this.observationIntervalMs=Math.max(250,observationIntervalMs|0);this.maxObservations=Math.max(2,maxObservations|0);this.alvaTrackedFrames=0;this.alvaLostFrames=0;this.wasLost=false;this.referenceDepthM=null;
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
    let trackingMode=r.trackingMode==='alvaar-initializing'?'alvaar-initializing':'alvaar-lost',trackingValid=false,relocalized=false;
    if(raw){
      trackingValid=true;relocalized=this.wasLost&&this.alvaTrackedFrames>0;this.wasLost=false;this.alvaLostFrames=0;this.alvaTrackedFrames++;
      this.pose=this.worldTransform?applySimilarityPose(this.worldTransform,raw):raw;
      trackingMode=relocalized?'alvaar-relocalized':'alvaar-wasm';
    }else{this.alvaLostFrames++;this.wasLost=true;}

    const poseCov=estimatePoseCovariance({metricLocked:this.metricLocked,alvaPoints:r.framePoints?.length||0,matches:r.matches?.count||0,trackingMode,relocalized,lostFrames:this.alvaLostFrames});
    const now=frame.at||performance.now(),sourceFrameId=String(frame.frameId||`legacy-${this.frameIndex}`);let newKeyframe=null,newObservation=null;
    // A 1 Hz observation clock is intentionally independent of pose validity.
    // Alva itself still receives every analysis frame; this bounded history gives
    // diagnostics/recovery/alignment a camera sample even while initialization is pending.
    if(!this.lastObservationAt||now-this.lastObservationAt>=this.observationIntervalMs){
      newObservation={id:`obs-${this.frameIndex}`,frameId:sourceFrameId,at:now,trackingValid,trackingMode,rawPose:raw?clonePose(raw):null,width:frame.width,height:frame.height,features:r.count||0,matches:r.matches?.count||0,alvaPoints:r.framePoints?.length||0,geometry:frame.geometry||null,poseCov};
      this.observations.push(newObservation);this.lastObservationAt=now;if(this.observations.length>this.maxObservations)this.observations.shift();
    }
    if(trackingValid&&(!this.lastAt||now-this.lastAt>=this.keyframeIntervalMs)){
      newKeyframe={id:`kf-${this.frameIndex}`,frameId:sourceFrameId,at:now,pose:clonePose(this.pose),rawPose:clonePose(raw),features:(r.features||[]).map(f=>({x:+f.x,y:+f.y,score:+(f.score||0),source:f.source||'mvs',desc:Array.from(f.desc||[]),referenceDesc:Array.from(f.referenceDesc||f.desc||[])})),width:frame.width,height:frame.height,trackingMode,metricLocked:this.metricLocked,geometry:frame.geometry||null,poseCov};
      this.keyframes.push(newKeyframe);this.lastAt=now;if(this.keyframes.length>520)this.keyframes.shift();
    }
    // Keep the exact 2-D feature packet on the transient tracking result. It is
    // not appended to the long-lived SLAM history; the 1 Hz Deep/photo survey
    // clock may synchronously compact it together with the exact camera frame.
    const detail={frame:this.frameIndex++,frameId:sourceFrameId,pose:clonePose(this.pose),rawPose:raw?clonePose(raw):null,features:r.count||0,matches:r.matches?.count||0,keyframes:this.keyframes.length,newKeyframe,observations:this.observations.length,newObservation,metricLocked:this.metricLocked,metricScale:this.metricScale,trackingMode,trackingValid,relocalized,alvaPoints:r.framePoints?.length||0,framePoints:Array.from(r.framePoints||[]),featureObservations:r.features||[],lostFrames:this.alvaLostFrames,poseCov};
    this.dispatchEvent(new CustomEvent('tracking',{detail}));if(newObservation)this.dispatchEvent(new CustomEvent('observation',{detail:newObservation}));if(newKeyframe)this.dispatchEvent(new CustomEvent('keyframe',{detail:newKeyframe}));return detail;
  }
}

/**
 * AlvaAR camera matrix -> Room Scanner right-handed CV pose.
 *
 * Alva's examples feed the estimated pose to ThreeJS. Three/WebGL cameras use
 * +X right,+Y up,-Z forward. We rotate BOTH world and camera bases by 180°
 * around X: C=diag(1,-1,-1). This gives +X right,+Y down,+Z forward while
 * preserving handedness. The old code transformed position with C but
 * transformed the quaternion as a reflection, so translation and orientation
 * did not describe the same camera. That is the classic cause of a dense
 * reconstruction collapsing into a sheet in front of the view.
 */
export function alvaMatrixToPose(a){
  if(!a||a.length<16)throw new TypeError('Alva 4x4 pose required');
  const r=matrixQuaternion(a);
  return {p:[+a[12],-a[13],-a[14]],q:qNormalize([r[0],-r[1],-r[2],r[3]])};
}
function matrixQuaternion(te){const m11=+te[0],m12=+te[4],m13=+te[8],m21=+te[1],m22=+te[5],m23=+te[9],m31=+te[2],m32=+te[6],m33=+te[10],trace=m11+m22+m33;let x,y,z,w,s;if(trace>0){s=.5/Math.sqrt(trace+1);w=.25/s;x=(m32-m23)*s;y=(m13-m31)*s;z=(m21-m12)*s;}else if(m11>m22&&m11>m33){s=2*Math.sqrt(1+m11-m22-m33);w=(m32-m23)/s;x=.25*s;y=(m12+m21)/s;z=(m13+m31)/s;}else if(m22>m33){s=2*Math.sqrt(1+m22-m11-m33);w=(m13-m31)/s;x=(m12+m21)/s;y=.25*s;z=(m23+m32)/s;}else{s=2*Math.sqrt(1+m33-m11-m22);w=(m21-m12)/s;x=(m13-m31)/s;y=(m23+m32)/s;z=.25*s;}return qNormalize([x,y,z,w]);}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:qNormalize(p.q.slice(0,4).map(Number))};}
