import {poseIdentity} from './math.js';
/**
 * Lightweight camera-only tracker used as a safe fallback around the original
 * V30 frontend. It never fabricates metric scale: scale remains unlocked until
 * the metric bridge supplies a verified similarity transform.
 */
export class SlamEngine extends EventTarget{
  constructor({frontend,K=null,log=null,keyframeIntervalMs=950}={}){super();this.frontend=frontend;this.K=K;this.log=log;this.pose=poseIdentity();this.metricLocked=false;this.metricScale=1;this.lastAt=0;this.frameIndex=0;this.keyframes=[];this.keyframeIntervalMs=keyframeIntervalMs;}
  setIntrinsics(K){this.K=K;}
  setMetricScale(scale=1){if(!Number.isFinite(scale)||scale<=0)throw new Error('metric scale must be positive');this.metricScale=scale;this.metricLocked=true;this.dispatchEvent(new CustomEvent('metric',{detail:{scale}}));}
  process(frame){const r=this.frontend.process(frame.gray,frame.width,frame.height,{maxFeatures:700,threshold:10}),ms=r.matches.items||[];if(ms.length){const dx=median(ms.map(m=>m.dx)),dy=median(ms.map(m=>m.dy));const fx=this.K?.fx||frame.width;/* image motion is opposite camera motion; translation is deliberately unscaled until metric lock */const step=this.metricLocked?.003*this.metricScale:.001;this.pose.p[0]+=(-dx/fx)*step*100;this.pose.p[1]+=(-dy/fx)*step*100;}
    const now=frame.at||performance.now();if(!this.lastAt||now-this.lastAt>=this.keyframeIntervalMs){this.keyframes.push({id:`kf-${this.frameIndex}`,at:now,pose:{p:[...this.pose.p],q:[...this.pose.q]},features:r.features});this.lastAt=now;if(this.keyframes.length>520)this.keyframes.shift();}
    const detail={frame:this.frameIndex++,pose:{p:[...this.pose.p],q:[...this.pose.q]},features:r.count,matches:r.matches.count,keyframes:this.keyframes.length,metricLocked:this.metricLocked};this.dispatchEvent(new CustomEvent('tracking',{detail}));return detail;}
}
function median(a){if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2}
