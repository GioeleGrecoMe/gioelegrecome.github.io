/**
 * Camera-only capture helper. The scanner deliberately requests no IMU access.
 * Frames are exposed both as RGBA ImageData and compact grayscale buffers for
 * the SLAM/WASM frontend.
 */
export class CameraController extends EventTarget{
  constructor({video,width=320,height=480,fps=12,log=null}={}){super();this.video=video;this.width=width;this.height=height;this.fps=fps;this.log=log;this.stream=null;this.canvas=document.createElement('canvas');this.canvas.width=width;this.canvas.height=height;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.running=false;this._timer=0;}
  async start(){if(this.stream)return this;const constraints={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:60}}};this.stream=await navigator.mediaDevices.getUserMedia(constraints);if(this.video){this.video.srcObject=this.stream;await this.video.play().catch(()=>{});}this.running=true;this.log?.info('camera-started',{tracks:this.stream.getVideoTracks().map(t=>({label:t.label,settings:t.getSettings?.()}))});this.dispatchEvent(new Event('started'));return this;}
  stop(){this.running=false;clearTimeout(this._timer);for(const t of this.stream?.getTracks?.()||[])try{t.stop()}catch{}if(this.video)this.video.srcObject=null;this.stream=null;this.dispatchEvent(new Event('stopped'));}
  capture(){if(!this.video||this.video.readyState<2||!this.ctx)return null;this.ctx.drawImage(this.video,0,0,this.width,this.height);const image=this.ctx.getImageData(0,0,this.width,this.height),gray=new Uint8Array(this.width*this.height),d=image.data;for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;return {at:performance.now(),width:this.width,height:this.height,gray,rgba:image.data,imageData:image};}
  loop(callback){const period=1000/Math.max(1,this.fps);let last=0;const tick=()=>{if(!this.running)return;const now=performance.now();if(now-last>=period){last=now;const f=this.capture();if(f)callback(f);}this._timer=setTimeout(tick,4);};tick();return ()=>{this.running=false;clearTimeout(this._timer);};}
}
