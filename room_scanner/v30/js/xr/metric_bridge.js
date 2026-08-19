/**
 * Conservative camera-only metric bridge.
 *
 * It does not invent a metric pose from monocular imagery. The saved WebXR
 * common-view calibration is accepted only when at least three calibrated
 * visual patches are re-observed close to their expected image positions. In
 * that situation the current camera is explicitly treated as a re-localized
 * approximation of the saved common view. The caller can then refine it with
 * its own PnP/SLAM stage while retaining the known metric scale.
 */
export class MetricBridge extends EventTarget{
  constructor({video,calibration,log=null,analysisWidth=320,analysisHeight=480}={}){this.video=video;this.calibration=calibration;this.log=log;this.w=analysisWidth;this.h=analysisHeight;this.canvas=document.createElement('canvas');this.canvas.width=this.w;this.canvas.height=this.h;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.running=false;this.timer=0;this.result=null;}
  async start(){if(!this.video)throw new Error('bridge video missing');if(!this.calibration?.anchors?.length)throw new Error('calibration missing');if(!this.video.srcObject){this.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});this.video.srcObject=this.stream;await this.video.play().catch(()=>{});}this.running=true;this._loop();return this;}
  stop(){this.running=false;clearTimeout(this.timer);for(const t of this.stream?.getTracks?.()||[])try{t.stop()}catch{}if(this.stream&&this.video)this.video.srcObject=null;this.stream=null;}
  _loop(){if(!this.running)return;try{const r=this.evaluate();this.dispatchEvent(new CustomEvent('update',{detail:r}));if(r.locked&&!this.result){this.result=r;this.dispatchEvent(new CustomEvent('locked',{detail:r}));}}catch(err){this.log?.warn('metric-bridge-evaluate',{message:err.message});}this.timer=setTimeout(()=>this._loop(),140);}
  evaluate(){if(this.video.readyState<2)return {locked:false,found:0,inliers:0,rmse:null};this.ctx.drawImage(this.video,0,0,this.w,this.h);const im=this.ctx.getImageData(0,0,this.w,this.h).data,gray=new Uint8Array(this.w*this.h);for(let i=0,j=0;i<im.length;i+=4,j++)gray[j]=(im[i]*77+im[i+1]*150+im[i+2]*29)>>8;const groups=groupAnchors(this.calibration),matches=[];for(const g of groups){const m=findGroup(gray,this.w,this.h,g);if(m)matches.push(m);}const inliers=matches.filter(m=>m.score>=.42&&m.shiftN<=.06),rmse=inliers.length?Math.sqrt(inliers.reduce((s,m)=>s+m.shiftN*m.shiftN,0)/inliers.length):null,locked=inliers.length>=3&&rmse<=.045;const common=this.calibration.commonView||{};return {locked,found:matches.length,inliers:inliers.length,rmse,pose:locked?(common.pose||this.calibration.pose||null):null,intrinsicsNorm:common.intrinsicsNorm||this.calibration.intrinsicsNorm||null,cameraSize:common.cameraSize||this.calibration.cameraSize||null,unit:'m',method:'verified-common-view-template-lock',matches};}
}
function groupAnchors(cal){
  const map=new Map(),objects=new Map((cal?.objects||[]).map(o=>[o.id,o]));
  for(const a of cal.anchors||[]){if(!a?.objectId||!Array.isArray(a.uv)||!a.patch)continue;if(!map.has(a.objectId))map.set(a.objectId,[]);map.get(a.objectId).push(a);}
  return [...map].map(([id,as])=>{const templates=[];const push=(patch,size,source)=>{if(!patch?.length)return;const n=size||Math.round(Math.sqrt(patch.length));if(n<4||patch.length<n*n)return;templates.push({patch:Uint8Array.from(patch),size:n,source});};
    for(const a of as){push(a.patch,a.patchSize,'common');for(const o of a.observations||[])push(o.patch,o.patchSize,'anchor-observation');}
    for(const v of objects.get(id)?.roiViews||[])for(const sc of v.scales||[])push(sc.patch,sc.patchSize||Math.round(Math.sqrt(sc.patch?.length||0)),'roi-atlas');
    return {id,uv:[as.reduce((s,a)=>s+a.uv[0],0)/as.length,as.reduce((s,a)=>s+a.uv[1],0)/as.length],templates:templates.slice(-30)};});
}
function findGroup(gray,w,h,g){let best=null;for(const t of g.templates){const size=t.size;if(size<4||t.patch.length<size*size)continue;const cx=Math.round(g.uv[0]*w),cy=Math.round(g.uv[1]*h),range=Math.max(8,Math.round(Math.min(w,h)*.055)),step=Math.max(2,Math.floor(size/4));for(let y=cy-range;y<=cy+range;y+=step)for(let x=cx-range;x<=cx+range;x+=step){const patch=sample(gray,w,h,x,y,size);if(!patch)continue;const score=zncc(t.patch,patch);if(!best||score>best.score){const uv=[x/w,y/h],shiftN=Math.hypot(uv[0]-g.uv[0],uv[1]-g.uv[1]);best={id:g.id,score,uv,expectedUv:g.uv,shiftN};}}}return best;}
function sample(g,w,h,cx,cy,n){const half=n>>1,x0=cx-half,y0=cy-half;if(x0<0||y0<0||x0+n>=w||y0+n>=h)return null;const out=new Uint8Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++)out[y*n+x]=g[(y0+y)*w+x0+x];return out;}
function zncc(a,b){if(a.length!==b.length||!a.length)return -1;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i]}ma/=a.length;mb/=b.length;let n=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;n+=x*y;da+=x*x;db+=y*y}return n/(Math.sqrt(da*db)+1e-9);}
