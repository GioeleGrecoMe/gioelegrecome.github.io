function fitCameraViewport(video){
  if(!video)return;
  const vv=globalThis.visualViewport,doc=globalThis.document?.documentElement;
  const width=Math.max(1,Math.round(vv?.width||globalThis.innerWidth||doc?.clientWidth||1));
  const height=Math.max(1,Math.round(vv?.height||globalThis.innerHeight||doc?.clientHeight||1));
  const host=video.parentElement;
  if(host?.id==='scan'){host.style.setProperty('padding','0','important');host.style.setProperty('overflow','hidden','important');host.style.setProperty('width',width+'px','important');host.style.setProperty('height',height+'px','important');}
  video.style.setProperty('width',width+'px','important');video.style.setProperty('height',height+'px','important');video.style.setProperty('object-fit','cover','important');video.style.setProperty('display','block','important');
}

/**
 * Camera-only capture helper. The scanner deliberately requests no IMU access.
 * V30.12.0 can adopt the already-open metric-bridge camera stream so metric
 * lock -> scan does not flash black or request a second camera session.
 */
export class CameraController extends EventTarget{
  constructor({video,width=320,height=480,fps=12,log=null,stream=null}={}){
    super();this.video=video;this.width=width;this.height=height;this.fps=fps;this.log=log;this.stream=stream;
    this.canvas=document.createElement('canvas');this.canvas.width=width;this.canvas.height=height;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.running=false;this._timer=0;this._resizeHandler=()=>fitCameraViewport(this.video);
  }
  adoptStream(stream){
    if(this.stream&&this.stream!==stream)for(const t of this.stream.getTracks?.()||[])try{t.stop()}catch{}
    this.stream=stream||null;return this;
  }
  async start(){
    if(!this.stream){
      const constraints={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:60}}};
      this.stream=await navigator.mediaDevices.getUserMedia(constraints);
    }
    if(this.video){
      fitCameraViewport(this.video);globalThis.addEventListener?.('resize',this._resizeHandler,{passive:true});globalThis.visualViewport?.addEventListener?.('resize',this._resizeHandler,{passive:true});
      if(this.video.srcObject!==this.stream)this.video.srcObject=this.stream;
      try{await this.video.play();}catch(err){throw new Error(`Impossibile avviare video scansione: ${err?.message||err}`);}
    }
    this.running=true;
    this.log?.info('camera-started',{adopted:!!this.stream,tracks:this.stream.getVideoTracks().map(t=>({label:t.label,settings:t.getSettings?.()}))});
    this.dispatchEvent(new Event('started'));return this;
  }
  stop(){this.running=false;clearTimeout(this._timer);globalThis.removeEventListener?.('resize',this._resizeHandler);globalThis.visualViewport?.removeEventListener?.('resize',this._resizeHandler);for(const t of this.stream?.getTracks?.()||[])try{t.stop()}catch{}if(this.video)this.video.srcObject=null;this.stream=null;this.dispatchEvent(new Event('stopped'));}
  capture(){if(!this.video||this.video.readyState<2||!this.ctx)return null;this.ctx.drawImage(this.video,0,0,this.width,this.height);const image=this.ctx.getImageData(0,0,this.width,this.height),gray=new Uint8Array(this.width*this.height),d=image.data;for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;return {at:performance.now(),width:this.width,height:this.height,gray,rgba:image.data,imageData:image};}
  loop(callback){const period=1000/Math.max(1,this.fps);let last=0;const tick=()=>{if(!this.running)return;const now=performance.now();if(now-last>=period){last=now;const f=this.capture();if(f)callback(f);}this._timer=setTimeout(tick,4);};tick();return ()=>{this.running=false;clearTimeout(this._timer);};}
}
