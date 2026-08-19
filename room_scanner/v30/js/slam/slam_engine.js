import {poseIdentity,projectPoint,qNormalize} from './math.js';

/**
 * Lightweight camera-only tracker.
 *
 * V30.12 metric contract
 * ----------------------
 * Metric lock supplies the WebXR common-view camera pose and the 3-D calibration
 * pins. We use those pins to estimate a reference scene depth. Small optical-flow
 * translations are then converted from pixels to metres with the calibrated
 * pin depth instead of the old arbitrary fixed coefficient. This keeps keyframe
 * poses in the same world frame as the calibration and makes two-view geometric
 * triangulation possible downstream.
 *
 * This is still a deliberately conservative camera-only tracker: it does not
 * invent depth and it does not claim robust large-rotation SLAM. For best MVS,
 * the UI asks the user for slow lateral motion with overlap.
 */
export class SlamEngine extends EventTarget {
  constructor({frontend,K=null,log=null,keyframeIntervalMs=950}={}) {
    super();
    this.frontend=frontend;
    this.K=K;
    this.log=log;
    this.pose=poseIdentity();
    this.metricLocked=false;
    this.metricScale=1;
    this.referenceDepthM=1.5;
    this.lastAt=0;
    this.frameIndex=0;
    this.keyframes=[];
    this.keyframeIntervalMs=keyframeIntervalMs;
  }

  setIntrinsics(K){this.K=K;}

  setMetricScale(scale=1){
    if(!Number.isFinite(scale)||scale<=0)throw new Error('metric scale must be positive');
    this.metricScale=scale;
    this.metricLocked=true;
    this.dispatchEvent(new CustomEvent('metric',{detail:{scale,referenceDepthM:this.referenceDepthM}}));
  }

  /**
   * Initialise tracking in the calibrated world frame. `points` are the saved
   * real-XRAnchor pin positions in metres. Their median positive camera depth is
   * the local scale used to convert image flow to a lateral metric displacement.
   */
  setMetricReference({pose=null,points=[]}={}){
    if(pose?.p?.length>=3&&pose?.q?.length>=4){
      this.pose={p:pose.p.slice(0,3).map(Number),q:qNormalize(pose.q.slice(0,4).map(Number))};
    }
    const depths=[];
    if(this.K&&Array.isArray(points))for(const p of points){
      if(!Array.isArray(p)||p.length<3)continue;
      const pr=projectPoint(this.pose,this.K,p);
      if(pr&&Number.isFinite(pr.z)&&pr.z>.20&&pr.z<20)depths.push(pr.z);
    }
    if(depths.length){
      depths.sort((a,b)=>a-b);
      const m=depths.length>>1;
      this.referenceDepthM=depths.length%2?depths[m]:(depths[m-1]+depths[m])/2;
    }
    this.metricLocked=true;
    this.metricScale=1;
    this.log?.info('slam-metric-reference',{pose:this.pose,referenceDepthM:this.referenceDepthM,pins:depths.length});
    this.dispatchEvent(new CustomEvent('metric',{detail:{scale:1,referenceDepthM:this.referenceDepthM,pose:this.pose}}));
    return {pose:this.pose,referenceDepthM:this.referenceDepthM,pins:depths.length};
  }

  process(frame){
    const r=this.frontend.process(frame.gray,frame.width,frame.height,{maxFeatures:700,threshold:10});
    const ms=r.matches.items||[];
    if(ms.length){
      const dx=median(ms.map(m=>m.dx));
      const dy=median(ms.map(m=>m.dy));
      const fx=this.K?.fx||frame.width;
      const fy=this.K?.fy||frame.height;
      // For small lateral camera motion, image flow is approximately
      // du ~= -fx * dX / Z and dv ~= +fy * dY / Z in our +Y-up world frame.
      // Z comes from the calibrated WebXR pins, so dX/dY are in metres.
      const z=this.metricLocked?this.referenceDepthM:0.35;
      const dxM=(-dx/Math.max(1,fx))*z*this.metricScale;
      const dyM=( dy/Math.max(1,fy))*z*this.metricScale;
      // Flow is measured in the camera image. Rotate the lateral increment into
      // the current world frame using the camera quaternion, but deliberately do
      // not infer forward translation from monocular flow alone.
      const worldDelta=rotateLateral(this.pose.q,[dxM,dyM,0]);
      this.pose.p[0]+=worldDelta[0];
      this.pose.p[1]+=worldDelta[1];
      this.pose.p[2]+=worldDelta[2];
    }

    const now=frame.at||performance.now();
    let newKeyframe=null;
    if(!this.lastAt||now-this.lastAt>=this.keyframeIntervalMs){
      newKeyframe={
        id:`kf-${this.frameIndex}`,
        at:now,
        pose:{p:[...this.pose.p],q:[...this.pose.q]},
        features:(r.features||[]).map(f=>({x:+f.x,y:+f.y,score:+(f.score||0),desc:Array.from(f.desc||[])})),
        width:frame.width,
        height:frame.height
      };
      this.keyframes.push(newKeyframe);
      this.lastAt=now;
      if(this.keyframes.length>520)this.keyframes.shift();
    }

    const detail={
      frame:this.frameIndex++,
      pose:{p:[...this.pose.p],q:[...this.pose.q]},
      features:r.count,
      matches:r.matches.count,
      keyframes:this.keyframes.length,
      newKeyframe,
      metricLocked:this.metricLocked,
      referenceDepthM:this.referenceDepthM
    };
    this.dispatchEvent(new CustomEvent('tracking',{detail}));
    if(newKeyframe)this.dispatchEvent(new CustomEvent('keyframe',{detail:newKeyframe}));
    return detail;
  }
}

function rotateLateral(q,v){
  const [x,y,z,w]=qNormalize(q),[vx,vy,vz]=v;
  const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
  return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];
}
function median(a){if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2;}
