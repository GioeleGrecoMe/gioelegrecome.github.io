/**
 * Room Scanner V30.11.4 conservative camera-only metric bridge.
 *
 * The bridge only accepts the saved WebXR metric frame after >=3 calibrated
 * pin regions are visually re-observed near their expected common-view image
 * positions. Matching is intentionally bounded so it cannot monopolise the
 * browser main thread on a phone.
 */
function previewViewportSize(){
  const vv=globalThis.visualViewport;
  const doc=globalThis.document?.documentElement;
  const width=Math.max(1,Math.round(vv?.width||globalThis.innerWidth||doc?.clientWidth||1));
  const height=Math.max(1,Math.round(vv?.height||globalThis.innerHeight||doc?.clientHeight||1));
  return {width,height};
}

function fitPreviewViewport(video){
  if(!video)return {width:0,height:0};
  const {width,height}=previewViewportSize();
  const host=video.parentElement;
  if(host){
    host.style.setProperty('padding','0','important');
    host.style.setProperty('overflow','hidden','important');
    host.style.setProperty('width',width+'px','important');
    host.style.setProperty('height',height+'px','important');
    host.style.setProperty('min-height',height+'px','important');
    host.style.setProperty('max-height',height+'px','important');
  }
  video.style.setProperty('position','absolute','important');
  video.style.setProperty('left','0','important');
  video.style.setProperty('top','0','important');
  video.style.setProperty('right','auto','important');
  video.style.setProperty('bottom','auto','important');
  video.style.setProperty('width',width+'px','important');
  video.style.setProperty('height',height+'px','important');
  video.style.setProperty('min-width','0','important');
  video.style.setProperty('min-height','0','important');
  video.style.setProperty('max-width','none','important');
  video.style.setProperty('max-height','none','important');
  video.style.setProperty('object-fit','cover','important');
  video.style.setProperty('object-position','center center','important');
  video.style.setProperty('display','block','important');
  video.style.setProperty('z-index','0','important');
  return {width,height};
}

function waitForVideoGeometry(video,timeoutMs=1600){
  if(!video)return Promise.resolve(false);
  if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0)return Promise.resolve(true);
  return new Promise(resolve=>{
    let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);video.removeEventListener('loadedmetadata',onReady);video.removeEventListener('canplay',onReady);resolve(value);};
    const onReady=()=>finish(video.videoWidth>0&&video.videoHeight>0);
    const timer=setTimeout(()=>finish(false),timeoutMs);
    video.addEventListener('loadedmetadata',onReady,{once:true});
    video.addEventListener('canplay',onReady,{once:true});
  });
}

export class MetricBridge extends EventTarget{
  constructor({video,calibration,log=null,analysisWidth=320,analysisHeight=480}={}){
    super();
    this.video=video;this.calibration=calibration;this.log=log;
    // Relocalisation does not need the full SLAM analysis resolution. Use a
    // smaller frame to preserve UI/video responsiveness during metric lock.
    const scale=Math.min(1,192/Math.max(1,analysisWidth));
    this.w=Math.max(128,Math.round(analysisWidth*scale));
    this.h=Math.max(192,Math.round(analysisHeight*scale));
    this.canvas=document.createElement('canvas');this.canvas.width=this.w;this.canvas.height=this.h;
    this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.running=false;this.cancelled=false;this.timer=0;this.result=null;this.stream=null;
    this._resizeHandler=()=>fitPreviewViewport(this.video);this._lastGeometryCheck=0;
    this._groups=groupAnchors(calibration);
  }
  async start(){
    if(!this.video)throw new Error('bridge video missing');
    if(!this.calibration?.anchors?.length)throw new Error('calibration missing');
    this.cancelled=false;
    fitPreviewViewport(this.video);
    globalThis.addEventListener?.('resize',this._resizeHandler,{passive:true});
    globalThis.visualViewport?.addEventListener?.('resize',this._resizeHandler,{passive:true});
    if(!this.video.srcObject){
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(this.cancelled){for(const t of stream.getTracks?.()||[])try{t.stop()}catch{};return this;}
      this.stream=stream;this.video.srcObject=stream;
      try{await this.video.play();}catch(err){this.stop();throw new Error(`Impossibile avviare anteprima camera: ${err?.message||err}`);}
    }
    if(this.cancelled)return this;
    await waitForVideoGeometry(this.video);
    const viewport=fitPreviewViewport(this.video);
    this.running=true;this._loop();
    this.log?.info('metric-bridge-camera-ready',{analysis:[this.w,this.h],groups:this._groups.length,viewport,videoIntrinsic:[this.video.videoWidth||0,this.video.videoHeight||0],videoRect:{width:this.video.getBoundingClientRect?.().width||0,height:this.video.getBoundingClientRect?.().height||0}});
    return this;
  }
  pause(){this.running=false;clearTimeout(this.timer);}
  resume(){if(this.cancelled||this.running)return;this.running=true;this._loop();}
  takeStream(){
    this.pause();
    const stream=this.stream;
    this.stream=null;
    if(this.video)this.video.srcObject=null;
    globalThis.removeEventListener?.('resize',this._resizeHandler);
    globalThis.visualViewport?.removeEventListener?.('resize',this._resizeHandler);
    return stream;
  }
  async restoreStream(stream){
    if(!stream)return;
    this.cancelled=false;this.stream=stream;
    if(this.video){fitPreviewViewport(this.video);this.video.srcObject=stream;try{await this.video.play();}catch{}await waitForVideoGeometry(this.video);fitPreviewViewport(this.video);globalThis.addEventListener?.('resize',this._resizeHandler,{passive:true});globalThis.visualViewport?.addEventListener?.('resize',this._resizeHandler,{passive:true});}
  }
  stop(){
    this.cancelled=true;this.pause();
    for(const t of this.stream?.getTracks?.()||[])try{t.stop()}catch{}
    if(this.stream&&this.video)this.video.srcObject=null;
    globalThis.removeEventListener?.('resize',this._resizeHandler);
    globalThis.visualViewport?.removeEventListener?.('resize',this._resizeHandler);
    this.stream=null;
  }
  _loop(){
    if(!this.running)return;
    const started=performance.now();
    if(started-this._lastGeometryCheck>1000){
      this._lastGeometryCheck=started;
      const vp=fitPreviewViewport(this.video),rect=this.video?.getBoundingClientRect?.();
      if(rect&&rect.height<vp.height*.72)this.log?.warn('metric-preview-layout',{viewport:vp,rect:{width:rect.width,height:rect.height},intrinsic:[this.video.videoWidth||0,this.video.videoHeight||0]});
    }
    try{
      const r=this.evaluate();
      r.computeMs=performance.now()-started;
      this.dispatchEvent(new CustomEvent('update',{detail:r}));
      if(r.locked&&!this.result){this.result=r;this.dispatchEvent(new CustomEvent('locked',{detail:r}));}
    }catch(err){this.log?.warn('metric-bridge-evaluate',{message:err.message,stack:err.stack||null});}
    // ~4 Hz is sufficient for user guidance and leaves ample time for paint,
    // touch handling and the browser camera compositor between evaluations.
    this.timer=setTimeout(()=>this._loop(),240);
  }
  evaluate(){
    if(this.video.readyState<2)return {locked:false,found:0,inliers:0,rmse:null,matches:[]};
    this.ctx.drawImage(this.video,0,0,this.w,this.h);
    const im=this.ctx.getImageData(0,0,this.w,this.h).data,gray=new Uint8Array(this.w*this.h);
    for(let i=0,j=0;i<im.length;i+=4,j++)gray[j]=(im[i]*77+im[i+1]*150+im[i+2]*29)>>8;
    const matches=[];
    for(const g of this._groups){const m=findGroup(gray,this.w,this.h,g);if(m)matches.push(m);}
    const inliers=matches.filter(m=>m.score>=.42&&m.shiftN<=.065);
    const rmse=inliers.length?Math.sqrt(inliers.reduce((s,m)=>s+m.shiftN*m.shiftN,0)/inliers.length):null;
    const locked=inliers.length>=3&&rmse<=.05;
    const common=this.calibration.commonView||{};
    return {locked,found:matches.length,inliers:inliers.length,rmse,pose:locked?(common.pose||this.calibration.pose||null):null,intrinsicsNorm:common.intrinsicsNorm||this.calibration.intrinsicsNorm||null,cameraSize:common.cameraSize||this.calibration.cameraSize||null,unit:'m',method:'verified-common-view-template-lock-v30.11.4',matches};
  }
}

function groupAnchors(cal){
  const map=new Map(),objects=new Map((cal?.objects||[]).map(o=>[o.id,o]));
  for(const a of cal?.anchors||[]){
    if(!a?.objectId||!Array.isArray(a.uv)||!a.patch)continue;
    if(!map.has(a.objectId))map.set(a.objectId,[]);
    map.get(a.objectId).push(a);
  }
  return [...map].map(([id,as])=>{
    const common=[],observed=[],roi=[];
    const push=(dst,patch,size,source)=>{if(!patch?.length)return;const n=size||Math.round(Math.sqrt(patch.length));if(n<4||patch.length<n*n)return;dst.push({patch:Uint8Array.from(patch),size:n,source});};
    for(const a of as){push(common,a.patch,a.patchSize,'common');for(const o of a.observations||[])push(observed,o.patch,o.patchSize,'anchor-observation');}
    for(const v of objects.get(id)?.roiViews||[])for(const sc of v.scales||[])push(roi,sc.patch,sc.patchSize||Math.round(Math.sqrt(sc.patch?.length||0)),'roi-atlas');
    // Initial metric lock should be cheap and biased toward the saved common
    // view. Extra ROI views remain stored for later/refined relocalisation.
    const templates=[...common.slice(-2),...observed.slice(-2),...roi.slice(-4)].slice(0,8);
    return {id,uv:[as.reduce((s,a)=>s+a.uv[0],0)/as.length,as.reduce((s,a)=>s+a.uv[1],0)/as.length],templates};
  }).filter(g=>g.templates.length);
}

function findGroup(gray,w,h,g){
  let best=null,comparisons=0;
  const maxComparisons=520;
  for(const t of g.templates){
    const size=t.size;if(size<4||t.patch.length<size*size)continue;
    const cx=Math.round(g.uv[0]*w),cy=Math.round(g.uv[1]*h),range=Math.max(7,Math.round(Math.min(w,h)*.05)),step=Math.max(3,Math.floor(size/3));
    for(let y=cy-range;y<=cy+range;y+=step){
      for(let x=cx-range;x<=cx+range;x+=step){
        if(++comparisons>maxComparisons)return best;
        const patch=sample(gray,w,h,x,y,size);if(!patch)continue;
        const score=zncc(t.patch,patch);
        if(!best||score>best.score){const uv=[x/w,y/h],shiftN=Math.hypot(uv[0]-g.uv[0],uv[1]-g.uv[1]);best={id:g.id,score,uv,expectedUv:g.uv,shiftN,source:t.source};}
      }
    }
  }
  return best;
}
function sample(g,w,h,cx,cy,n){const half=n>>1,x0=cx-half,y0=cy-half;if(x0<0||y0<0||x0+n>=w||y0+n>=h)return null;const out=new Uint8Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++)out[y*n+x]=g[(y0+y)*w+x0+x];return out;}
function zncc(a,b){if(a.length!==b.length||!a.length)return -1;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i]}ma/=a.length;mb/=b.length;let n=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;n+=x*y;da+=x*x;db+=y*y}return n/(Math.sqrt(da*db)+1e-9);}
