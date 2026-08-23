/** Return the source rectangle cropped with the same semantics as object-fit:cover. */
export function coverCrop(sourceWidth,sourceHeight,targetWidth,targetHeight){
  const sw=Math.max(1,Number(sourceWidth)||1),sh=Math.max(1,Number(sourceHeight)||1),tw=Math.max(1,Number(targetWidth)||1),th=Math.max(1,Number(targetHeight)||1);
  const sourceAspect=sw/sh,targetAspect=tw/th;
  let cropW=sw,cropH=sh,sx=0,sy=0;
  if(sourceAspect>targetAspect){cropW=sh*targetAspect;sx=(sw-cropW)/2;}
  else if(sourceAspect<targetAspect){cropH=sw/targetAspect;sy=(sh-cropH)/2;}
  return {sx,sy,sw:cropW,sh:cropH,sourceWidth:sw,sourceHeight:sh,targetWidth:tw,targetHeight:th};
}

/** Map normalized full-sensor intrinsics into the exact analysis crop. */
export function intrinsicsForCrop(intrinsicsNorm,geometry,{fallbackFovDeg=62}={}){
  const g=geometry||coverCrop(1,1,1,1),W=g.targetWidth,H=g.targetHeight;
  if(intrinsicsNorm&&[intrinsicsNorm.fxN,intrinsicsNorm.fyN,intrinsicsNorm.cxN,intrinsicsNorm.cyN].every(Number.isFinite)){
    const fxFull=intrinsicsNorm.fxN*g.sourceWidth,fyFull=intrinsicsNorm.fyN*g.sourceHeight,cxFull=intrinsicsNorm.cxN*g.sourceWidth,cyFull=intrinsicsNorm.cyN*g.sourceHeight;
    return {fx:fxFull*W/g.sw,fy:fyFull*H/g.sh,cx:(cxFull-g.sx)*W/g.sw,cy:(cyFull-g.sy)*H/g.sh,width:W,height:H};
  }
  const f=.5*W/Math.tan((Number(fallbackFovDeg)||62)*Math.PI/360);
  return {fx:f,fy:f,cx:W/2,cy:H/2,width:W,height:H};
}

/** Analysis pixel -> original camera pixel. */
export function analysisPixelToSource(geometry,u,v){
  const g=geometry;if(!g)return {x:u,y:v};
  return {x:g.sx+(u/g.targetWidth)*g.sw,y:g.sy+(v/g.targetHeight)*g.sh};
}

/** Original camera pixel -> viewport pixel for a video rendered object-fit:cover. */
export function sourcePixelToViewport({sourceWidth,sourceHeight},x,y,viewportWidth,viewportHeight){
  const scale=Math.max(viewportWidth/sourceWidth,viewportHeight/sourceHeight),drawW=sourceWidth*scale,drawH=sourceHeight*scale,ox=(viewportWidth-drawW)/2,oy=(viewportHeight-drawH)/2;
  return {x:ox+x*scale,y:oy+y*scale,scale,offsetX:ox,offsetY:oy};
}

function nowMs(){return typeof performance!=='undefined'&&performance.now?performance.now():Date.now();}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

/**
 * Wait until the element exposes a frame that drawImage() can actually read.
 * For uploaded files also require a finite duration; metadata dimensions alone
 * are not enough because the first decoded frame may still be unavailable.
 */
export async function waitVideoReady(video,{timeout=7000,requireDuration=false}={}){
  const start=nowMs();
  while(nowMs()-start<timeout){
    const dimensions=Number(video?.videoWidth)>0&&Number(video?.videoHeight)>0;
    const dataReady=Number(video?.readyState)>=2;
    const duration=Number(video?.duration);
    const durationReady=!requireDuration||(Number.isFinite(duration)&&duration>0);
    if(dimensions&&dataReady&&durationReady)return true;
    if(video?.error)throw new Error(`decoder video: ${video.error.message||`MediaError ${video.error.code}`}`);
    await sleep(25);
  }
  return false;
}

function sampledRgbaSignature(rgba,width,height){
  if(!rgba?.length)return '00000000';
  let h=2166136261>>>0;
  const pixels=Math.max(1,(width|0)*(height|0)),samples=Math.min(193,pixels);
  for(let k=0;k<samples;k++){
    const p=Math.min(pixels-1,Math.floor(k*(pixels-1)/Math.max(1,samples-1))),i=p*4;
    h^=rgba[i]||0;h=Math.imul(h,16777619)>>>0;
    h^=rgba[i+1]||0;h=Math.imul(h,16777619)>>>0;
    h^=rgba[i+2]||0;h=Math.imul(h,16777619)>>>0;
  }
  return h.toString(16).padStart(8,'0');
}

/**
 * Camera/video capture helper.
 *
 * Uploaded files are deliberately decoded differently from a live camera. A
 * fixed "seek every 1/30 s" loop is not frame accurate (especially for 24/25
 * fps H.264), and `seeked` does not guarantee that drawImage() sees the newly
 * presented frame. `nextDecodedFrame()` advances through actual compositor
 * frames via requestVideoFrameCallback and returns decoder `mediaTime`.
 */
export class CameraController extends EventTarget{
  constructor({video,width=320,height=240,fps=8,log=null,stream=null,source='camera',cameraAuthorized=false}={}){
    super();this.video=video;this.width=width;this.height=height;this.fps=fps;this.log=log;this.stream=stream;this.source=source;
    this.cameraAuthorized=cameraAuthorized===true;
    this.canvas=document.createElement('canvas');this.canvas.width=width;this.canvas.height=height;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.running=false;this._timer=0;this._videoFrameHandle=0;this.geometry=null;this.frameSeq=0;this.lastDeliveredMediaTime=-Infinity;
    this.frameEpoch=`capture-${Date.now().toString(36)}`;this._onEnded=()=>this._finishExternal();
  }
  adoptStream(stream){if(this.stream&&this.stream!==stream)for(const t of this.stream.getTracks?.()||[])try{t.stop()}catch{}this.stream=stream||null;this.source='camera';return this;}
  async start({autoplay=true}={}){
    if(!this.video)throw new Error('elemento video mancante');
    if(this.source==='camera'){
      if(!this.cameraAuthorized)throw new Error('La camera reale richiede una conferma esplicita dell’utente prima di richiedere getUserMedia.');
      if(!this.stream){const constraints={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}}};this.stream=await navigator.mediaDevices.getUserMedia(constraints);}
      if(this.video.srcObject!==this.stream)this.video.srcObject=this.stream;
    }else{
      if(!this.video.src)throw new Error('video di simulazione non impostato');
      this.video.preload='auto';this.video.muted=true;this.video.playsInline=true;
      // Invalidate a previously decoded blob/source before waiting for data.
      try{this.video.load();}catch{}
    }
    // Uploaded files are consumed by processUploadedVideo(), which owns EOF.
    // Attaching the ordinary ended handler there can stop recording before the
    // final decoder callback is handed to AlvaAR.
    if(this.source!=='file')this.video.addEventListener('ended',this._onEnded,{once:true});
    const ready=await waitVideoReady(this.video,{requireDuration:this.source==='file'});
    if(!ready)throw new Error(`il video ${this.source} non ha fornito un frame decodificabile`);
    if(autoplay){try{await this.video.play();}catch(err){throw new Error(`Impossibile avviare video ${this.source}: ${err?.message||err}`);}}
    this.geometry=coverCrop(this.video.videoWidth,this.video.videoHeight,this.width,this.height);this.running=true;
    this.log?.info?.('capture-source-started',{source:this.source,geometry:this.geometry,video:[this.video.videoWidth,this.video.videoHeight],duration:Number(this.video.duration)||null,readyState:this.video.readyState,rvfc:typeof this.video.requestVideoFrameCallback==='function',tracks:(this.stream?.getVideoTracks?.()||[]).map(t=>({label:t.label,settings:t.getSettings?.()}))});
    this.dispatchEvent(new Event('started'));return this;
  }
  _finishExternal(){if(this.source==='camera')return;this.running=false;clearTimeout(this._timer);if(this._videoFrameHandle)this.video?.cancelVideoFrameCallback?.(this._videoFrameHandle);this._videoFrameHandle=0;this.dispatchEvent(new CustomEvent('ended',{detail:{source:this.source,frames:this.frameSeq}}));}
  stop({clearVideo=true}={}){this.running=false;clearTimeout(this._timer);if(this._videoFrameHandle)this.video?.cancelVideoFrameCallback?.(this._videoFrameHandle);this._videoFrameHandle=0;this.video?.removeEventListener('ended',this._onEnded);for(const t of this.stream?.getTracks?.()||[])try{t.stop()}catch{}this.stream=null;if(this.video){this.video.pause();this.video.srcObject=null;if(clearVideo&&this.source!=='camera'){this.video.removeAttribute('src');this.video.load();}}this.dispatchEvent(new Event('stopped'));}
  capture({mediaTime=null,presentedFrames=null}={}){
    if(!this.video||this.video.readyState<2||!this.ctx)return null;
    const vw=this.video.videoWidth,vh=this.video.videoHeight,g=coverCrop(vw,vh,this.width,this.height);this.geometry=g;
    this.ctx.drawImage(this.video,g.sx,g.sy,g.sw,g.sh,0,0,this.width,this.height);
    const image=this.ctx.getImageData(0,0,this.width,this.height),gray=new Uint8Array(this.width*this.height),d=image.data;
    for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
    const at=nowMs(),captureSeq=++this.frameSeq,frameId=`${this.frameEpoch}-${captureSeq}`;
    const mt=Number.isFinite(Number(mediaTime))?Number(mediaTime):(Number(this.video.currentTime)||0);
    return {frameId,captureSeq,at,mediaTime:mt,presentedFrames:Number.isFinite(Number(presentedFrames))?Number(presentedFrames):null,width:this.width,height:this.height,gray,rgba:image.data,imageData:image,frameSignature:sampledRgbaSignature(image.data,this.width,this.height),geometry:g,source:this.source};
  }

  /** Advance an uploaded file by one actual decoded/presented frame. */
  async nextDecodedFrame(previousMediaTime=-Infinity,{timeout=5000}={}){
    const video=this.video;if(!video||!this.running)return null;
    if(typeof video.requestVideoFrameCallback!=='function')return null;
    const previous=Number(previousMediaTime);
    return await new Promise((resolve,reject)=>{
      let settled=false,timer=0,handle=0;
      const cleanup=()=>{if(timer)clearTimeout(timer);video.removeEventListener('ended',onEnded);video.removeEventListener('error',onError);if(handle)try{video.cancelVideoFrameCallback?.(handle)}catch{}this._videoFrameHandle=0;};
      const finish=(value,err=null)=>{if(settled)return;settled=true;cleanup();try{video.pause();}catch{}err?reject(err):resolve(value);};
      const onEnded=()=>finish(null);
      const onError=()=>finish(null,new Error(`decoder video: ${video.error?.message||'errore media'}`));
      const onFrame=(now,meta={})=>{
        const mediaTime=Number(meta.mediaTime);
        if(Number.isFinite(mediaTime)&&(!Number.isFinite(previous)||mediaTime>previous+1e-6)){
          finish({now,mediaTime,presentedFrames:Number(meta.presentedFrames)||null,width:Number(meta.width)||video.videoWidth,height:Number(meta.height)||video.videoHeight});return;
        }
        if(video.ended){finish(null);return;}
        handle=video.requestVideoFrameCallback(onFrame);this._videoFrameHandle=handle;
      };
      video.addEventListener('ended',onEnded,{once:true});video.addEventListener('error',onError,{once:true});
      handle=video.requestVideoFrameCallback(onFrame);this._videoFrameHandle=handle;
      timer=setTimeout(()=>finish(null,new Error(`timeout decoder: nessun nuovo frame dopo mediaTime=${Number.isFinite(previous)?previous.toFixed(6):'inizio'}`)),timeout);
      Promise.resolve(video.play()).catch(err=>finish(null,new Error(`playback frame-step fallito: ${err?.message||err}`)));
    });
  }

  /** Frame-accurate fallback for browsers without requestVideoFrameCallback. */
  async seekDecodedFrame(time,{timeout=3500}={}){
    const video=this.video;if(!video||!this.running)return null;video.pause();
    const target=Math.max(0,Math.min(Math.max(0,(Number(video.duration)||0)-1e-5),Number(time)||0));
    await new Promise((resolve,reject)=>{
      let settled=false,timer=0;
      const cleanup=()=>{if(timer)clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',fail);};
      const finish=(err=null)=>{if(settled)return;settled=true;cleanup();err?reject(err):resolve();};
      const done=()=>finish();const fail=()=>finish(new Error('seek video fallito'));
      video.addEventListener('seeked',done,{once:true});video.addEventListener('error',fail,{once:true});
      timer=setTimeout(()=>finish(new Error(`timeout seek a ${target.toFixed(3)} s`)),timeout);
      if(Math.abs(video.currentTime-target)<5e-4)queueMicrotask(done);else video.currentTime=target;
    });
    // seeked may precede canvas presentation. Two paint turns are the fallback
    // synchronization when rVFC is unavailable.
    await new Promise(resolve=>(typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>requestAnimationFrame(resolve)):setTimeout(resolve,24)));
    return {mediaTime:Number(video.currentTime)||target,presentedFrames:null};
  }

  loop(callback){
    const period=1000/Math.max(1,this.fps);let last=-Infinity;
    const deliver=(now,meta=null)=>{if(now-last<period)return;last=now;const f=this.capture({mediaTime:meta?.mediaTime,presentedFrames:meta?.presentedFrames}),duplicateExternal=this.source!=='camera'&&f&&Math.abs(f.mediaTime-this.lastDeliveredMediaTime)<1e-6;if(f&&!duplicateExternal){this.lastDeliveredMediaTime=f.mediaTime;try{callback(f);}catch(err){this.log?.warn?.('capture-callback',{message:err?.message||String(err)});}}};
    if(typeof this.video?.requestVideoFrameCallback==='function'){
      const tick=(now,meta)=>{if(!this.running)return;deliver(now,meta);this._videoFrameHandle=this.video.requestVideoFrameCallback(tick);};this._videoFrameHandle=this.video.requestVideoFrameCallback(tick);
    }else{
      const tick=()=>{if(!this.running)return;deliver(nowMs());this._timer=setTimeout(tick,4);};tick();
    }
    return ()=>this.stop({clearVideo:false});
  }
}
