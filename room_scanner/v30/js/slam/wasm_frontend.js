/**
 * Hybrid vision frontend for Room Scanner V30.13.
 *
 * The previous V30.13 build only instantiated a 34-byte sentinel WASM module
 * and then estimated motion with a tiny JavaScript optical-flow fallback.  That
 * was useful for plumbing tests, but it is not a substitute for real visual
 * SLAM and it directly limited MVS / Gaussian quality.
 *
 * V30.13 restores the intended AlvaAR path.  We first try a vendored
 * `vendor/alva_ar.js`; when that file is not present we can load the official
 * AlvaAR distribution from the configured CDN URL.  The service worker caches
 * the successful CDN response, so subsequent runs can reuse it offline.
 *
 * Feature extraction remains local because the MVS worker needs descriptors in
 * addition to the camera pose produced by AlvaAR.
 */
export class WasmVisionFrontend{
  constructor(options={}){
    if(typeof options==='string')options={sentinelUrl:options};
    this.options=options||{};
    this.instance=null;
    this.alva=null;
    this.alvaModule=null;
    this.alvaLoadError=null;
    this.previous=null;
    this.width=0;this.height=0;
    this.mode='js-fallback';
    this.limits={maxFeatures:4096,descriptorBytes:16,implementation:'js-feature-front-end'};
  }

  async init({width=320,height=480,fovDeg=45,alvaLocalUrl=null,alvaRemoteUrl=null}={}){
    this.width=width;this.height=height;
    // Keep validating the local sentinel when present so broken deployments are
    // still diagnosed, but never advertise it as the actual SLAM engine.
    if(this.options.sentinelUrl){
      try{
        const r=await fetch(this.options.sentinelUrl,{cache:'no-store'});
        if(r.ok){const bytes=await r.arrayBuffer();if(bytes.byteLength>=8){const m=new Uint8Array(bytes,0,4);if(m[0]===0&&m[1]===0x61&&m[2]===0x73&&m[3]===0x6d)this.instance=(await WebAssembly.instantiate(bytes,{})).instance;}}
      }catch{}
    }

    const urls=[];
    if(alvaLocalUrl)urls.push(alvaLocalUrl);
    if(alvaRemoteUrl)urls.push(alvaRemoteUrl);
    for(const url of urls){
      try{
        const mod=await import(/* webpackIgnore: true */ url);
        if(!mod?.AlvaAR?.Initialize)throw new Error('AlvaAR export missing');
        this.alvaModule=mod;
        this.alva=await mod.AlvaAR.Initialize(width,height,fovDeg);
        this.mode='alvaar-wasm';
        this.limits.implementation='AlvaAR-WASM+local-descriptors';
        this.alvaLoadError=null;
        break;
      }catch(err){
        this.alvaLoadError=err;
      }
    }
    return this;
  }

  processFrame(frame,{maxFeatures=700,threshold=10}={}){
    if(!frame?.gray)throw new TypeError('camera frame required');
    const local=this.process(frame.gray,frame.width,frame.height,{maxFeatures,threshold});
    let cameraPose=null,framePoints=[];
    if(this.alva&&frame.imageData){
      try{
        const p=this.alva.findCameraPose(frame.imageData);
        if(p&&p.length>=16)cameraPose=Array.from(p).slice(0,16).map(Number);
        framePoints=this.alva.getFramePoints?.()||[];
      }catch(err){
        this.alvaLoadError=err;
      }
    }
    return {...local,cameraPose,framePoints,trackingMode:cameraPose?'alvaar-wasm':'feature-flow-fallback'};
  }

  process(gray,width,height,{maxFeatures=500,threshold=12}={}){
    if(!(gray instanceof Uint8Array)||gray.length<width*height)throw new TypeError('grayscale Uint8Array required');
    const features=detect(gray,width,height,maxFeatures,threshold),matches=match(this.previous?.features||[],features);
    this.previous={features,width,height};
    return {count:features.length,features,matches:{count:matches.length,items:matches}};
  }

  reset(){this.previous=null;try{this.alva?.reset?.();}catch{}}
}

function detect(g,w,h,maxN,thr){
  const out=[],step=3;
  for(let y=3;y<h-3;y+=step)for(let x=3;x<w-3;x+=step){
    const i=y*w+x,gx=(g[i+1]-g[i-1])+(g[i+w+1]-g[i+w-1]),gy=(g[i+w]-g[i-w])+(g[i+w+1]-g[i-w-1]),score=Math.abs(gx)+Math.abs(gy);
    if(score<thr*5)continue;
    const desc=[];
    for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[-2,2],[2,-2],[-3,1],[3,-1],[1,3],[-1,-3]])desc.push(g[(y+dy)*w+(x+dx)]);
    out.push({x,y,score,desc});
  }
  out.sort((a,b)=>b.score-a.score);return out.slice(0,maxN);
}
function distDesc(a,b){if(!a?.length||a.length!==b?.length)return Infinity;let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s;}
function match(prev,cur){
  const provisional=[];
  for(let j=0;j<cur.length;j++){
    let best=-1,bd=Infinity,second=Infinity;
    for(let i=0;i<prev.length;i++){
      const d=distDesc(cur[j].desc,prev[i].desc)+.18*Math.hypot(cur[j].x-prev[i].x,cur[j].y-prev[i].y);
      if(d<bd){second=bd;bd=d;best=i}else if(d<second)second=d;
    }
    if(best>=0&&bd<1050&&(second===Infinity||bd<second*.90))provisional.push({prev:best,curr:j,distance:bd,dx:cur[j].x-prev[best].x,dy:cur[j].y-prev[best].y});
  }
  // Mutual-best pruning is cheap and removes repeated-texture matches before MVS.
  const bestByPrev=new Map();
  for(const m of provisional){const old=bestByPrev.get(m.prev);if(!old||m.distance<old.distance)bestByPrev.set(m.prev,m);}
  return [...bestByPrev.values()];
}
