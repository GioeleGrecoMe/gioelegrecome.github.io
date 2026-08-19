/* getUserMedia camera adapter. No V20/WebXR dependency.
 *
 * IMPORTANT: portrait cameras are commonly 720x1280 or 1080x1920. The V30
 * WASM front-end has a finite working image. Always fit BOTH dimensions inside
 * the WASM limits while preserving aspect ratio; limiting only width creates
 * 320x569 portrait frames and causes process_frame() to reject every frame.
 */
export function fitAnalysisSize(vw,vh,{maxWidth=320,maxHeight=480,minWidth=32,minHeight=24}={}){
  if(!(vw>0&&vh>0))return {width:0,height:0,scale:0};
  const s=Math.min(1,maxWidth/vw,maxHeight/vh);
  let w=Math.max(minWidth,Math.round(vw*s));
  let h=Math.max(minHeight,Math.round(vh*s));
  // Rounding must never push a dimension outside the declared limits.
  if(w>maxWidth||h>maxHeight){const s2=Math.min(maxWidth/w,maxHeight/h);w=Math.max(minWidth,Math.floor(w*s2));h=Math.max(minHeight,Math.floor(h*s2));}
  return {width:w,height:h,scale:Math.min(w/vw,h/vh)};
}

export class CameraSource{
  constructor(video,{analysisWidth=320,analysisHeight=480}={}){
    this.video=video;this.analysisWidth=analysisWidth;this.analysisHeight=analysisHeight;this.stream=null;
    this.canvas=document.createElement('canvas');this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.fullCanvas=document.createElement('canvas');this.fullCtx=this.fullCanvas.getContext('2d',{willReadFrequently:true});
    this.lastAnalysisSize=null;
  }
  async start(){
    this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    this.video.srcObject=this.stream;await this.video.play();await new Promise(resolve=>{if(this.video.videoWidth)return resolve();this.video.addEventListener('loadedmetadata',resolve,{once:true});});
    const track=this.stream.getVideoTracks()[0],settings=track?.getSettings?.()||{},caps=track?.getCapabilities?.()||{};let rearInputs=[];try{rearInputs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput').map(d=>({label:d.label||'',deviceId:d.deviceId,groupId:d.groupId})).filter(d=>/(back|rear|environment|wide|ultra)/i.test(d.label));}catch{}const zoom=caps.zoom?{min:caps.zoom.min,max:caps.zoom.max,step:caps.zoom.step}:null;
    return {width:this.video.videoWidth,height:this.video.videoHeight,analysis:fitAnalysisSize(this.video.videoWidth,this.video.videoHeight,{maxWidth:this.analysisWidth,maxHeight:this.analysisHeight}),settings,lens:{selected:'environment-default',wideAutoSelected:false,wideCandidate:!!(zoom&&zoom.min<1),zoom,rearInputs,calibration:'fixed-fov-unverified'}};
  }
  analysisFrame(timestamp=performance.now()){
    const vw=this.video.videoWidth,vh=this.video.videoHeight;if(!vw||!vh)return null;
    const size=fitAnalysisSize(vw,vh,{maxWidth:this.analysisWidth,maxHeight:this.analysisHeight});const w=size.width,h=size.height;if(!w||!h)return null;
    this.lastAnalysisSize=size;this.canvas.width=w;this.canvas.height=h;this.ctx.drawImage(this.video,0,0,w,h);
    const rgba=this.ctx.getImageData(0,0,w,h).data,gray=new Uint8Array(w*h);for(let i=0,j=0;i<rgba.length;i+=4,j++)gray[j]=(rgba[i]*77+rgba[i+1]*150+rgba[i+2]*29)>>8;
    return {gray,width:w,height:h,timestamp,sourceWidth:vw,sourceHeight:vh,scale:size.scale};
  }
  async keyframe({quality=.82,maxWidth=960}={}){
    const vw=this.video.videoWidth,vh=this.video.videoHeight;if(!vw||!vh)throw new Error('camera frame unavailable');
    const scale=Math.min(1,maxWidth/vw),w=Math.max(1,Math.round(vw*scale)),h=Math.max(1,Math.round(vh*scale));
    this.fullCanvas.width=w;this.fullCanvas.height=h;this.fullCtx.drawImage(this.video,0,0,w,h);const image=this.fullCtx.getImageData(0,0,w,h);
    const blob=await new Promise((resolve,reject)=>this.fullCanvas.toBlob(b=>b?resolve(b):reject(new Error('JPEG encode failed')),'image/jpeg',quality));return {blob,image,width:w,height:h,timestamp:performance.now()};
  }
  stop(){for(const t of this.stream?.getTracks?.()||[])t.stop();this.video.srcObject=null;this.stream=null;}
}
