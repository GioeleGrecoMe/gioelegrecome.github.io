/* getUserMedia camera adapter. No V20/WebXR dependency. Analysis frames are
 * intentionally small for WASM SLAM while JPEG keyframes keep full camera RGB. */
export class CameraSource{
  constructor(video,{analysisWidth=320}={}){this.video=video;this.analysisWidth=analysisWidth;this.stream=null;this.canvas=document.createElement('canvas');this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.fullCanvas=document.createElement('canvas');this.fullCtx=this.fullCanvas.getContext('2d',{willReadFrequently:true});}
  async start(){
    this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    this.video.srcObject=this.stream;await this.video.play();await new Promise(resolve=>{if(this.video.videoWidth)return resolve();this.video.addEventListener('loadedmetadata',resolve,{once:true});});
    return {width:this.video.videoWidth,height:this.video.videoHeight,settings:this.stream.getVideoTracks()[0]?.getSettings?.()||{}};
  }
  analysisFrame(timestamp=performance.now()){
    const vw=this.video.videoWidth,vh=this.video.videoHeight;if(!vw||!vh)return null;const w=Math.min(this.analysisWidth,vw),h=Math.max(24,Math.round(vh*w/vw));this.canvas.width=w;this.canvas.height=h;this.ctx.drawImage(this.video,0,0,w,h);const rgba=this.ctx.getImageData(0,0,w,h).data,gray=new Uint8Array(w*h);for(let i=0,j=0;i<rgba.length;i+=4,j++)gray[j]=(rgba[i]*77+rgba[i+1]*150+rgba[i+2]*29)>>8;return {gray,width:w,height:h,timestamp};
  }
  async keyframe({quality=.82,maxWidth=960}={}){
    const vw=this.video.videoWidth,vh=this.video.videoHeight;if(!vw||!vh)throw new Error('camera frame unavailable');const w=Math.min(maxWidth,vw),h=Math.round(vh*w/vw);this.fullCanvas.width=w;this.fullCanvas.height=h;this.fullCtx.drawImage(this.video,0,0,w,h);const image=this.fullCtx.getImageData(0,0,w,h);const blob=await new Promise((resolve,reject)=>this.fullCanvas.toBlob(b=>b?resolve(b):reject(new Error('JPEG encode failed')),'image/jpeg',quality));return {blob,image,width:w,height:h,timestamp:performance.now()};
  }
  stop(){for(const t of this.stream?.getTracks?.()||[])t.stop();this.video.srcObject=null;this.stream=null;}
}
