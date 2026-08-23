/** Return the source rectangle cropped with the same semantics as object-fit:cover. */
export function coverCrop(sourceWidth,sourceHeight,targetWidth,targetHeight){
  const sw=Math.max(1,Number(sourceWidth)||1),sh=Math.max(1,Number(sourceHeight)||1),tw=Math.max(1,Number(targetWidth)||1),th=Math.max(1,Number(targetHeight)||1);
  const sourceAspect=sw/sh,targetAspect=tw/th;
  let cropW=sw,cropH=sh,sx=0,sy=0;
  if(sourceAspect>targetAspect){cropW=sh*targetAspect;sx=(sw-cropW)/2;}
  else if(sourceAspect<targetAspect){cropH=sw/targetAspect;sy=(sh-cropH)/2;}
  return {sx,sy,sw:cropW,sh:cropH,sourceWidth:sw,sourceHeight:sh,targetWidth:tw,targetHeight:th};
}

/**
 * Choose the Alva analysis raster without changing orientation or aspect ratio.
 * Alva is extremely sensitive to throwing away spatial resolution: the long
 * side is configurable (the scan test uses 960 px), while every source pixel remains represented.
 */
export function analysisRasterForSource(sourceWidth,sourceHeight,{longSide=960}={}){
  const sw=Math.max(1,Math.round(Number(sourceWidth)||1)),sh=Math.max(1,Math.round(Number(sourceHeight)||1));
  const side=Math.max(320,Math.round(Number(longSide)||960));
  const scale=side/Math.max(sw,sh);
  const width=Math.max(2,Math.round(sw*scale));
  const height=Math.max(2,Math.round(sh*scale));
  return {width,height,scale,sourceWidth:sw,sourceHeight:sh,orientation:width>=height?'landscape':'portrait'};
}

/** Full-frame geometry: no centre crop and no forced 4:3 distortion. */
export function fullFrameGeometry(sourceWidth,sourceHeight,targetWidth,targetHeight){
  const sw=Math.max(1,Number(sourceWidth)||1),sh=Math.max(1,Number(sourceHeight)||1),tw=Math.max(1,Number(targetWidth)||1),th=Math.max(1,Number(targetHeight)||1);
  return {sx:0,sy:0,sw,sh,sourceWidth:sw,sourceHeight:sh,targetWidth:tw,targetHeight:th,croppedFraction:0};
}

/** Map normalized full-sensor intrinsics into the exact analysis crop. */
export function intrinsicsForCrop(intrinsicsNorm,geometry,{fallbackFovDeg=62}={}){
  const g=geometry||fullFrameGeometry(1,1,1,1),W=g.targetWidth,H=g.targetHeight;
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
 * presented frame. Uploaded files therefore use one continuous playback pass:
 * capture t=0 first, then keep a single requestVideoFrameCallback chain alive.
 * This avoids the play/pause frame-step race that can drop Alva's bootstrap frames.
 */
export class CameraController extends EventTarget{
  constructor({video,width=null,height=null,longSide=960,fps=8,log=null,stream=null,source='camera',cameraAuthorized=false}={}){
    super();this.video=video;this.width=Number(width)||0;this.height=Number(height)||0;this.longSide=Math.max(320,Math.round(Number(longSide)||960));this.fps=fps;this.log=log;this.stream=stream;this.source=source;
    this.cameraAuthorized=cameraAuthorized===true;
    this.canvas=document.createElement('canvas');this.canvas.width=Math.max(2,this.width||2);this.canvas.height=Math.max(2,this.height||2);this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.running=false;this._timer=0;this._videoFrameHandle=0;this.geometry=null;this.frameSeq=0;this.lastDeliveredMediaTime=-Infinity;
    this.frameEpoch=`capture-${Date.now().toString(36)}`;this._onEnded=()=>this._finishExternal();
  }
  adoptStream(stream){if(this.stream&&this.stream!==stream)for(const t of this.stream.getTracks?.()||[])try{t.stop()}catch{}this.stream=stream||null;this.source='camera';return this;}
  async start({autoplay=true}={}){
    if(!this.video)throw new Error('elemento video mancante');
    if(this.source==='camera'){
      if(!this.cameraAuthorized)throw new Error('La camera reale richiede una conferma esplicita dell’utente prima di richiedere getUserMedia.');
      if(!this.stream){const constraints={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}};this.stream=await navigator.mediaDevices.getUserMedia(constraints);}
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
    const raster=analysisRasterForSource(this.video.videoWidth,this.video.videoHeight,{longSide:this.longSide});
    this.width=raster.width;this.height=raster.height;this.canvas.width=this.width;this.canvas.height=this.height;
    this.geometry=fullFrameGeometry(this.video.videoWidth,this.video.videoHeight,this.width,this.height);this.running=true;
    this.log?.info?.('capture-source-started',{source:this.source,geometry:this.geometry,analysisRaster:[this.width,this.height],video:[this.video.videoWidth,this.video.videoHeight],duration:Number(this.video.duration)||null,readyState:this.video.readyState,rvfc:typeof this.video.requestVideoFrameCallback==='function',tracks:(this.stream?.getVideoTracks?.()||[]).map(t=>({label:t.label,settings:t.getSettings?.()}))});
    this.dispatchEvent(new Event('started'));return this;
  }
  _finishExternal(){if(this.source==='camera')return;this.running=false;clearTimeout(this._timer);if(this._videoFrameHandle)this.video?.cancelVideoFrameCallback?.(this._videoFrameHandle);this._videoFrameHandle=0;this.dispatchEvent(new CustomEvent('ended',{detail:{source:this.source,frames:this.frameSeq}}));}
  stop({clearVideo=true}={}){this.running=false;clearTimeout(this._timer);if(this._videoFrameHandle)this.video?.cancelVideoFrameCallback?.(this._videoFrameHandle);this._videoFrameHandle=0;this.video?.removeEventListener('ended',this._onEnded);for(const t of this.stream?.getTracks?.()||[])try{t.stop()}catch{}this.stream=null;if(this.video){this.video.pause();this.video.srcObject=null;if(clearVideo&&this.source!=='camera'){this.video.removeAttribute('src');this.video.load();}}this.dispatchEvent(new Event('stopped'));}
  capture({mediaTime=null,presentedFrames=null}={}){
    if(!this.video||this.video.readyState<2||!this.ctx)return null;
    const vw=this.video.videoWidth,vh=this.video.videoHeight,g=fullFrameGeometry(vw,vh,this.width,this.height);this.geometry=g;
    // Preserve the complete source image. Resizing is isotropic because target
    // width/height have the same aspect ratio as the source.
    this.ctx.drawImage(this.video,0,0,vw,vh,0,0,this.width,this.height);
    const image=this.ctx.getImageData(0,0,this.width,this.height),gray=new Uint8Array(this.width*this.height),d=image.data;
    for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
    const at=nowMs(),captureSeq=++this.frameSeq,frameId=`${this.frameEpoch}-${captureSeq}`;
    const mt=Number.isFinite(Number(mediaTime))?Number(mediaTime):(Number(this.video.currentTime)||0);
    return {frameId,captureSeq,at,mediaTime:mt,presentedFrames:Number.isFinite(Number(presentedFrames))?Number(presentedFrames):null,width:this.width,height:this.height,gray,rgba:image.data,imageData:image,frameSignature:sampledRgbaSignature(image.data,this.width,this.height),geometry:g,source:this.source};
  }

  /**
   * Consume an uploaded video in one continuous decoder pass.
   *
   * Why this exists: repeatedly calling play()/pause() for every rVFC callback
   * is not frame stepping. Chromium may advance several frames while playback is
   * being resumed, and AlvaAR can fail initialization if even one of the first
   * frames is missing. We instead capture the already-decoded t=0 frame, start
   * playback exactly once, and keep the rVFC chain active until EOF.
   *
   * playbackRate is deliberately below 1 for offline analysis. Alva + feature
   * extraction are synchronous JavaScript/WASM work; slowing media time gives
   * the main thread enough wall-clock time to service every presented frame
   * instead of letting the video clock run ahead while processing.
   */
  async consumeDecodedFrames(onFrame,{timeout=120000,playbackRate=.25,includeInitial=true}={}){
    const video=this.video;if(!video||!this.running)throw new Error('controller video non attivo');
    if(typeof onFrame!=='function')throw new Error('callback frame mancante');
    if(typeof video.requestVideoFrameCallback!=='function')return {supported:false,frames:0,duplicates:0,lastMediaTime:null};

    video.pause();
    const previousRate=Number(video.playbackRate)||1;
    const safeRate=Math.max(.0625,Math.min(1,Number(playbackRate)||.25));
    video.playbackRate=safeRate;
    try{
      if(Math.abs((Number(video.currentTime)||0))>1e-4){
        await this.seekDecodedFrame(0,{timeout:5000});
      }
      // waitVideoReady() guarantees a drawable first frame, but a paint turn
      // makes the t=0 canvas read deterministic after an explicit seek.
      await new Promise(resolve=>(typeof requestAnimationFrame==='function'?requestAnimationFrame(resolve):setTimeout(resolve,0)));

      let delivered=0,duplicates=0,lastMediaTime=-Infinity,lastSignature=null,finished=false,handle=0,timer=0;
      const deliver=(meta={})=>{
        const frame=this.capture({mediaTime:Number.isFinite(Number(meta.mediaTime))?Number(meta.mediaTime):(Number(video.currentTime)||0),presentedFrames:meta.presentedFrames});
        if(!frame)return false;
        const sameTime=Number.isFinite(lastMediaTime)&&Math.abs(frame.mediaTime-lastMediaTime)<1e-7;
        const samePixels=lastSignature!=null&&frame.frameSignature===lastSignature;
        if((sameTime&&samePixels)||(samePixels&&frame.mediaTime<=lastMediaTime+1e-7)){duplicates++;return false;}
        lastMediaTime=frame.mediaTime;lastSignature=frame.frameSignature;delivered++;onFrame(frame,meta);return true;
      };

      if(includeInitial)deliver({mediaTime:Number(video.currentTime)||0,presentedFrames:0,initial:true});

      const result=await new Promise((resolve,reject)=>{
        const cleanup=()=>{if(timer)clearTimeout(timer);if(handle)try{video.cancelVideoFrameCallback?.(handle)}catch{};this._videoFrameHandle=0;video.removeEventListener('ended',onEnded);video.removeEventListener('error',onError);};
        const finish=(err=null)=>{if(finished)return;finished=true;cleanup();err?reject(err):resolve({supported:true,frames:delivered,duplicates,lastMediaTime:Number.isFinite(lastMediaTime)?lastMediaTime:null,playbackRate:safeRate});};
        const onEnded=()=>finish();
        const onError=()=>finish(new Error(`decoder video: ${video.error?.message||'errore media'}`));
        const tick=(now,meta={})=>{
          if(finished)return;
          try{deliver(meta);}catch(err){finish(err);return;}
          if(video.ended){finish();return;}
          handle=video.requestVideoFrameCallback(tick);this._videoFrameHandle=handle;
        };
        video.addEventListener('ended',onEnded,{once:true});video.addEventListener('error',onError,{once:true});
        handle=video.requestVideoFrameCallback(tick);this._videoFrameHandle=handle;
        timer=setTimeout(()=>finish(new Error(`timeout decodifica continua dopo ${Math.round(timeout/1000)} s`)),Math.max(1000,Number(timeout)||120000));
        Promise.resolve(video.play()).catch(err=>finish(new Error(`playback continuo fallito: ${err?.message||err}`)));
      });
      return result;
    }finally{
      try{video.pause();}catch{}
      try{video.playbackRate=previousRate;}catch{}
    }
  }

  /** Legacy one-frame helper kept only for diagnostics/fallback comparisons. */
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
