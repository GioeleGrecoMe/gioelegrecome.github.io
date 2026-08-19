/* Lightweight IMU recorder. The visual tracker does not trust inertial
 * integration for metric scale; IMU is a short-term motion/orientation prior
 * and is always persisted for later offline VIO refinement. */
export class ImuTracker{
 constructor(){this.samples=[];this.motionWindow=[];this.gravity=null;this.latest=null;this.permission='unknown';this._motion=e=>this.onMotion(e);this._orientation=e=>this.onOrientation(e);this.orientation=null;this.lastPriorOrientation=null;}
 async start(){
  try{if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission==='function'){this.permission=await DeviceMotionEvent.requestPermission();}else this.permission='granted';}catch{this.permission='denied';}
  if(this.permission!=='granted')return false;window.addEventListener('devicemotion',this._motion,{passive:true});window.addEventListener('deviceorientation',this._orientation,{passive:true});return true;
 }
 onMotion(e){const a=e.acceleration||{},g=e.accelerationIncludingGravity||{},r=e.rotationRate||{},gv=[g.x||0,g.y||0,g.z||0],direct=[a.x||0,a.y||0,a.z||0];if(!this.gravity)this.gravity=[...gv];this.gravity=this.gravity.map((v,i)=>v*.92+gv[i]*.08);const fallback=gv.map((v,i)=>v-this.gravity[i]),hasDirect=Math.hypot(...direct)>.025,linear=hasDirect?direct:fallback;this.latest={t:performance.now(),a:linear,g:gv,r:[r.alpha||0,r.beta||0,r.gamma||0],interval:e.interval||0};this.samples.push(this.latest);this.motionWindow.push(this.latest);if(this.samples.length>12000)this.samples.splice(0,2000);if(this.motionWindow.length>180)this.motionWindow.splice(0,this.motionWindow.length-180);}
 onOrientation(e){this.orientation={t:performance.now(),alpha:e.alpha??null,beta:e.beta??null,gamma:e.gamma??null,absolute:!!e.absolute};}
 motionScore(){if(!this.latest)return 0;const a=Math.hypot(...this.latest.a),r=Math.hypot(...this.latest.r)*Math.PI/180;return Math.min(5,a*0.15+r*0.4);}
 /* A deliberately conservative relative-motion prior. It is not dead-reckoned
  * navigation: phone accelerometers drift too much for that. It only decides
  * whether a new visual baseline is credible and provides a weak direction. */
 motionPrior(){const recent=this.motionWindow.slice(-48);let a=[0,0,0],energy=0;for(const s of recent){for(let k=0;k<3;k++)a[k]+=s.a[k]||0;energy+=Math.hypot(...(s.a||[0,0,0]));}if(recent.length)a=a.map(v=>v/recent.length);const magnitude=Math.max(Math.hypot(...a),recent.length?energy/recent.length:0),direction=Math.hypot(...a)>.08?a.map(v=>v/(Math.hypot(...a)||1)):[0,0,0],translationL=Math.max(0,Math.min(.14,(magnitude-.06)*.042)),o=this.orientation;let rotationRad=0;if(o&&this.lastPriorOrientation){const diff=(x,y)=>{let d=(x??0)-(y??0);while(d>180)d-=360;while(d<-180)d+=360;return d;};rotationRad=Math.hypot(diff(o.alpha,this.lastPriorOrientation.alpha),diff(o.beta,this.lastPriorOrientation.beta),diff(o.gamma,this.lastPriorOrientation.gamma))*Math.PI/180;}if(o)this.lastPriorOrientation={...o};return {translationL,confidence:Math.max(0,Math.min(1,(magnitude-.06)/1.6)),direction,rotationRad};}
 drain(){const out=this.samples;this.samples=[];return out;}
 stop(){window.removeEventListener('devicemotion',this._motion);window.removeEventListener('deviceorientation',this._orientation);}
}
