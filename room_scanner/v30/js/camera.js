function fitCameraViewport(video){
  if(!video)return;
  const vv=globalThis.visualViewport,doc=globalThis.document?.documentElement;
  const width=Math.max(1,Math.round(vv?.width||globalThis.innerWidth||doc?.clientWidth||1));
  const height=Math.max(1,Math.round(vv?.height||globalThis.innerHeight||doc?.clientHeight||1));
  const host=video.parentElement;
  if(host?.id==='scan'){host.style.setProperty('padding','0','important');host.style.setProperty('overflow','hidden','important');host.style.setProperty('width',width+'px','important');host.style.setProperty('height',height+'px','important');}
  video.style.setProperty('width',width+'px','important');video.style.setProperty('height',height+'px','important');video.style.setProperty('object-fit','cover','important');video.style.setProperty('display','block','important');
}

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

/**
 * Camera-only capture helper.
 *
 * V30.14 keeps the image geometry consistent end-to-end: the analysis frame is
 * center-cropped with object-fit:cover semantics instead of stretching a 16:9
 * phone feed into the 2:3 analysis canvas. The crop metadata is attached to
 * every frame so the live AR splat overlay can map analysis pixels back onto
 * the actual camera preview exactly.
 */
export class CameraController extends EventTarget{
  constructor({video,width=320,height=480,fps=12,log=null,stream=null}={}){
    super();this.video=video;this.width=width;this.height=height;this.fps=fps;this.log=log;this.stream=stream;
    this.canvas=document.createElement('canvas');this.canvas.width=width;this.canvas.height=height;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.running=false;this._timer=0;this.geometry=null;this._resizeHandler=()=>fitCameraViewport(this.video);
  }
  adoptStream(stream){if(this.stream&&this.stream!==stream)for(const t of this.stream.getTracks?.()||[])try{t.stop()}catch{}this.stream=stream||null;return this;}
  async start(){
    if(!this.stream){const constraints={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:12,max:15}}};this.stream=await navigator.mediaDevices.getUserMedia(constraints);}
    if(this.video){fitCameraViewport(this.video);globalThis.addEventListener?.('resize',this._resizeHandler,{passive:true});globalThis.visualViewport?.addEventListener?.('resize',this._resizeHandler,{passive:true});if(this.video.srcObject!==this.stream)this.video.srcObject=this.stream;try{await this.video.play();}catch(err){throw new Error(`Impossibile avviare video scansione: ${err?.message||err}`);}await waitVideoDimensions(this.video);this.geometry=coverCrop(this.video.videoWidth||this.width,this.video.videoHeight||this.height,this.width,this.height);}
    this.running=true;this.log?.info('camera-started',{adopted:!!this.stream,geometry:this.geometry,tracks:this.stream.getVideoTracks().map(t=>({label:t.label,settings:t.getSettings?.()}))});this.dispatchEvent(new Event('started'));return this;
  }
  stop(){this.running=false;clearTimeout(this._timer);globalThis.removeEventListener?.('resize',this._resizeHandler);globalThis.visualViewport?.removeEventListener?.('resize',this._resizeHandler);for(const t of this.stream?.getTracks?.()||[])try{t.stop()}catch{}if(this.video)this.video.srcObject=null;this.stream=null;this.dispatchEvent(new Event('stopped'));}
  capture(){
    if(!this.video||this.video.readyState<2||!this.ctx)return null;
    const vw=this.video.videoWidth||this.width,vh=this.video.videoHeight||this.height,g=coverCrop(vw,vh,this.width,this.height);this.geometry=g;
    this.ctx.drawImage(this.video,g.sx,g.sy,g.sw,g.sh,0,0,this.width,this.height);
    const image=this.ctx.getImageData(0,0,this.width,this.height),gray=new Uint8Array(this.width*this.height),d=image.data;for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
    return {at:performance.now(),width:this.width,height:this.height,gray,rgba:image.data,imageData:image,geometry:g};
  }
  loop(callback){const period=1000/Math.max(1,this.fps);let last=0;const tick=()=>{if(!this.running)return;const now=performance.now();if(now-last>=period){last=now;const f=this.capture();if(f)callback(f);}this._timer=setTimeout(tick,4);};tick();return ()=>{this.running=false;clearTimeout(this._timer);};}
}
function waitVideoDimensions(video,timeout=1800){if(video.videoWidth&&video.videoHeight)return Promise.resolve();return new Promise(resolve=>{const started=performance.now(),tick=()=>{if(video.videoWidth&&video.videoHeight||performance.now()-started>timeout)return resolve();setTimeout(tick,30);};tick();});}
