/* Lightweight IMU recorder. The visual tracker does not trust inertial
 * integration for metric scale; IMU is a short-term motion/orientation prior
 * and is always persisted for later offline VIO refinement. */
export class ImuTracker{
 constructor(){this.samples=[];this.latest=null;this.permission='unknown';this._motion=e=>this.onMotion(e);this._orientation=e=>this.onOrientation(e);this.orientation=null;}
 async start(){
  try{if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission==='function'){this.permission=await DeviceMotionEvent.requestPermission();}else this.permission='granted';}catch{this.permission='denied';}
  if(this.permission!=='granted')return false;window.addEventListener('devicemotion',this._motion,{passive:true});window.addEventListener('deviceorientation',this._orientation,{passive:true});return true;
 }
 onMotion(e){const a=e.acceleration||{},g=e.accelerationIncludingGravity||{},r=e.rotationRate||{};this.latest={t:performance.now(),a:[a.x||0,a.y||0,a.z||0],g:[g.x||0,g.y||0,g.z||0],r:[r.alpha||0,r.beta||0,r.gamma||0],interval:e.interval||0};this.samples.push(this.latest);if(this.samples.length>12000)this.samples.splice(0,2000);}
 onOrientation(e){this.orientation={t:performance.now(),alpha:e.alpha??null,beta:e.beta??null,gamma:e.gamma??null,absolute:!!e.absolute};}
 motionScore(){if(!this.latest)return 0;const a=Math.hypot(...this.latest.a),r=Math.hypot(...this.latest.r)*Math.PI/180;return Math.min(5,a*0.15+r*0.4);}
 drain(){const out=this.samples;this.samples=[];return out;}
 stop(){window.removeEventListener('devicemotion',this._motion);window.removeEventListener('deviceorientation',this._orientation);}
}
