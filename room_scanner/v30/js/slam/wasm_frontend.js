import {loadAlvaModule,getAlvaRuntimeStatus} from './alva_runtime_loader.js';
/**
 * AlvaAR-first vision frontend.
 *
 * IMPORTANT ARCHITECTURE CONTRACT (V30.14+):
 * - AlvaAR is the ONLY source of the long-lived camera pose.
 * - Local JS features/descriptors exist only for MVS correspondence search.
 * - A missing Alva pose never turns into a synthetic camera motion estimate.
 * - The same AlvaAR instance is kept alive from metric bootstrap through Scan,
 *   preserving its internal map / loop-closure / relocalisation state.
 */
export class WasmVisionFrontend{
  constructor(options={}){
    if(typeof options==='string')options={sentinelUrl:options};
    this.options=options||{};this.instance=null;this.alva=null;this.alvaModule=null;this.alvaLoadError=null;this.previous=null;this.width=0;this.height=0;this.fovDeg=45;this.mode='uninitialized';this.lastPoseAt=0;this.hasProcessedPose=false;this.trackingEpoch=0;this.hasPoseInEpoch=false;
    this.limits={maxFeatures:4096,descriptorBytes:16,implementation:'AlvaAR-WASM+local-MVS-descriptors'};
  }

  async init({width=320,height=480,fovDeg=45,alvaLocalUrl=null,alvaRemoteUrl=null,alvaRemoteUrls=null,requireAlva=true}={}){
    this.width=width;this.height=height;this.fovDeg=Math.max(20,Math.min(100,Number(fovDeg)||45));
    // The tiny local wasm_core.wasm is only a deployment/syntax sentinel. It is
    // never accepted as SLAM. Keeping this probe helps diagnose corrupt builds.
    if(this.options.sentinelUrl){
      try{const r=await fetch(this.options.sentinelUrl,{cache:'no-store'});if(r.ok){const bytes=await r.arrayBuffer();if(bytes.byteLength>=8){const m=new Uint8Array(bytes,0,4);if(m[0]===0&&m[1]===0x61&&m[2]===0x73&&m[3]===0x6d)this.instance=(await WebAssembly.instantiate(bytes,{})).instance;}}}catch{}
    }
    if(this.options.alva){this.alva=this.options.alva;this.mode='alvaar-wasm';return this;}
    try{
      const sources=[...(Array.isArray(alvaRemoteUrls)?alvaRemoteUrls:[]),alvaRemoteUrl].filter(Boolean);
      if(!alvaLocalUrl&&!sources.length&&!requireAlva){this.mode='alvaar-unavailable';return this;}
      const cacheKey=new URL('../../vendor/alva_ar.cached.js',import.meta.url).href;
      const mod=await loadAlvaModule({localUrl:alvaLocalUrl,cacheKey,sources});
      this.alvaModule=mod;
      // Use AlvaAR's public Initialize(width,height,fov) overload so its internal intrinsics match our exact camera crop.
      // IMPORTANT: AlvaAR.Initialize accepts FOV as its third argument. V30.21
      // computed the calibrated/cropped FOV in app.js but accidentally dropped it
      // here, forcing Alva's 45deg default even when the camera crop is ~62deg.
      // That intrinsics mismatch can prevent the monocular initializer from ever
      // accepting its first map.
      this.alva=await mod.AlvaAR.Initialize(width,height,this.fovDeg);
      if(!this.alva||typeof this.alva.findCameraPose!=='function')throw new Error('AlvaAR.Initialize non ha restituito un tracker valido');
      this.mode='alvaar-wasm';this.alvaLoadError=null;this.alvaRuntimeStatus=getAlvaRuntimeStatus();
    }catch(err){this.alvaLoadError=err;this.mode='alvaar-unavailable';}
    if(!this.alva&&requireAlva)throw new Error(`AlvaAR non disponibile: ${this.alvaLoadError?.message||'runtime non caricato'}`);
    return this;
  }

  /** Pose-only hot path used during the short metric bootstrap. */
  trackPose(frame){
    if(!this.alva)throw new Error('AlvaAR not initialized');
    if(!frame?.imageData)throw new TypeError('ImageData frame required by AlvaAR');
    let cameraPose=null,framePoints=[];
    try{const p=this.alva.findCameraPose(frame.imageData);if(p&&p.length>=16){cameraPose=Array.from(p).slice(0,16).map(Number);this.lastPoseAt=frame.at||performance.now();this.hasPoseInEpoch=true;}framePoints=this.alva.getFramePoints?.()||[];}
    catch(err){this.alvaLoadError=err;}
    // `lastPoseAt` belongs to the physical Alva instance and may legitimately
    // predate Scan (for example the metric-bootstrap bridge).  It must never
    // turn the first empty Scan result into a tracking loss.  The epoch is
    // deliberately app-side bookkeeping only: the internal Alva map remains
    // alive, so its own relocalisation/loop-closure memory is preserved.
    return {cameraPose,framePoints,trackingEpoch:this.trackingEpoch,hasPoseInEpoch:this.hasPoseInEpoch,trackingMode:cameraPose?'alvaar-wasm':(this.hasPoseInEpoch?'alvaar-lost':'alvaar-initializing')};
  }

  /** Full path: Alva pose + lightweight descriptors for MVS only. */
  processFrame(frame,{maxFeatures=700,threshold=10}={}){
    if(!frame?.gray)throw new TypeError('camera frame required');
    // Ask Alva first. Its current tracked points are the best places to extract
    // lightweight MVS descriptors because they have already survived Alva's
    // visual-SLAM feature selection. These points never drive the pose here;
    // findCameraPose() remains the sole trajectory source.
    const tracking=this.trackPose(frame);
    const alvaFeatures=featuresAtTrackedPoints(frame.gray,frame.width,frame.height,tracking.framePoints,maxFeatures);
    // During monocular initialization every millisecond should go back to Alva.
    // The old path ran a full JavaScript feature detector whenever Alva exposed
    // fewer than ~90 tracked points, exactly the common INIT state. Those local
    // descriptors NEVER feed findCameraPose(), so they only reduced the rate at
    // which the real SLAM initializer saw camera frames. Keep them disabled until
    // Alva has produced its first pose; after that they remain available for MVS.
    if(!tracking.cameraPose){
      // Never steal CPU from first-map initialization. Once a real Alva pose
      // existed, retain a compact local feature packet while it is lost so the
      // app-side reference memory can recognise a known area. These features
      // never feed Alva and cannot synthesize a camera trajectory.
      if(!this.hasProcessedPose){this.previous=null;return {count:alvaFeatures.length,features:alvaFeatures,matches:{count:0,items:[]},...tracking,alvaFeatureCount:alvaFeatures.length,initializerFastPath:true};}
      const recoveryFeatures=mergeFeatures(alvaFeatures,detect(frame.gray,frame.width,frame.height,Math.min(280,maxFeatures),threshold),Math.min(280,maxFeatures)),matches=match(this.previous?.features||[],recoveryFeatures);this.previous={features:recoveryFeatures,width:frame.width,height:frame.height};
      return {count:recoveryFeatures.length,features:recoveryFeatures,matches:{count:matches.length,items:matches},...tracking,alvaFeatureCount:alvaFeatures.length,initializerFastPath:false,localRecoveryFeatures:true};
    }
    this.hasProcessedPose=true;
    let features=alvaFeatures;
    if(features.length<Math.min(90,maxFeatures)){
      const extra=detect(frame.gray,frame.width,frame.height,maxFeatures,threshold);
      features=mergeFeatures(features,extra,maxFeatures);
    }
    const matches=match(this.previous?.features||[],features);this.previous={features,width:frame.width,height:frame.height};
    return {count:features.length,features,matches:{count:matches.length,items:matches},...tracking,alvaFeatureCount:alvaFeatures.length,initializerFastPath:false};
  }

  process(gray,width,height,{maxFeatures=500,threshold=12}={}){
    if(!(gray instanceof Uint8Array)||gray.length<width*height)throw new TypeError('grayscale Uint8Array required');
    const features=detect(gray,width,height,maxFeatures,threshold),matches=match(this.previous?.features||[],features);this.previous={features,width,height};return {count:features.length,features,matches:{count:matches.length,items:matches}};
  }

  /** Start a new UI/Scan lifecycle without resetting AlvaAR's persistent map. */
  beginTrackingEpoch({reason='scan'}={}){this.previous=null;this.hasProcessedPose=false;this.hasPoseInEpoch=false;this.trackingEpoch++;return {trackingEpoch:this.trackingEpoch,reason,alvaMapPreserved:!!this.alva};}
  resetLocalFeatures(){this.previous=null;this.hasProcessedPose=false;}
  resetAll(){this.previous=null;this.lastPoseAt=0;this.hasProcessedPose=false;this.hasPoseInEpoch=false;this.trackingEpoch++;try{this.alva?.reset?.();}catch{}}
  reset(){this.resetLocalFeatures();}
}

function detect(g,w,h,maxN,thr){const out=[],step=3;for(let y=5;y<h-5;y+=step)for(let x=5;x<w-5;x+=step){const i=y*w+x,gx=(g[i+1]-g[i-1])+(g[i+w+1]-g[i+w-1]),gy=(g[i+w]-g[i-w])+(g[i+w+1]-g[i-w-1]),score=Math.abs(gx)+Math.abs(gy);if(score<thr*5)continue;const desc=[];for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[-2,2],[2,-2],[-3,1],[3,-1],[1,3],[-1,-3]])desc.push(g[(y+dy)*w+(x+dx)]);out.push({x,y,score,desc,referenceDesc:referenceDescriptor(g,w,x,y)});}out.sort((a,b)=>b.score-a.score);return out.slice(0,maxN);}
function distDesc(a,b){if(!a?.length||a.length!==b?.length)return Infinity;let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s;}
function match(prev,cur){const provisional=[];for(let j=0;j<cur.length;j++){let best=-1,bd=Infinity,second=Infinity;for(let i=0;i<prev.length;i++){const d=distDesc(cur[j].desc,prev[i].desc)+.18*Math.hypot(cur[j].x-prev[i].x,cur[j].y-prev[i].y);if(d<bd){second=bd;bd=d;best=i}else if(d<second)second=d;}if(best>=0&&bd<1050&&(second===Infinity||bd<second*.90))provisional.push({prev:best,curr:j,distance:bd,dx:cur[j].x-prev[best].x,dy:cur[j].y-prev[best].y});}const bestByPrev=new Map();for(const m of provisional){const old=bestByPrev.get(m.prev);if(!old||m.distance<old.distance)bestByPrev.set(m.prev,m);}return [...bestByPrev.values()];}


const ALVA_DESC_OFFSETS=[[-4,-2],[-2,-4],[0,-4],[2,-4],[4,-2],[-4,0],[-2,-2],[0,-2],[2,-2],[4,0],[-4,2],[-2,2],[0,2],[2,2],[4,2],[-2,4],[0,4],[2,4],[0,0],[3,3]];
function featuresAtTrackedPoints(gray,w,h,points,maxN){
  const out=[],seen=new Set();
  for(const p of Array.from(points||[])){
    const x=Math.round(Number(p?.x)),y=Math.round(Number(p?.y));if(!Number.isFinite(x)||!Number.isFinite(y)||x<5||y<5||x>=w-5||y>=h-5)continue;
    const cell=`${x>>2}:${y>>2}`;if(seen.has(cell))continue;seen.add(cell);
    const desc=referenceDescriptor(gray,w,x,y),i=y*w+x,gx=Math.abs(gray[i+1]-gray[i-1]),gy=Math.abs(gray[i+w]-gray[i-w]);
    out.push({x,y,score:gx+gy+128,desc,referenceDesc:desc.slice(),source:'alva-track'});if(out.length>=maxN)break;
  }
  return out;
}
function referenceDescriptor(gray,w,x,y){return ALVA_DESC_OFFSETS.map(([dx,dy])=>gray[(y+dy)*w+(x+dx)]);}
function mergeFeatures(primary,extra,maxN){const out=[...primary],cells=new Set(out.map(f=>`${Math.round(f.x)>>2}:${Math.round(f.y)>>2}`));for(const f of extra){const c=`${Math.round(f.x)>>2}:${Math.round(f.y)>>2}`;if(cells.has(c))continue;cells.add(c);out.push({...f,source:'local-mvs'});if(out.length>=maxN)break;}return out;}
