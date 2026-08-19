import {qNormalize} from '../slam/math.js';

/*
 * Room Scanner V30.7 - WebXR metric bootstrap.
 *
 * WebXR is deliberately confined to this calibration stage. The immersive
 * session gives us a metric local-floor reference space, metric hit-test
 * points and (when Raw Camera Access is available) small visual templates tied
 * to those points. After calibration the XR session ends and normal camera-only
 * SLAM continues from getUserMedia(). No IMU and no monocular AI depth are
 * required by the V30.7 tracking/mapping path.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export function projectionToIntrinsics(proj,width,height){
  return {
    fx:width*.5*proj[0], fy:height*.5*proj[5],
    cx:(1-proj[8])*width*.5, cy:(1-proj[9])*height*.5,
    width,height
  };
}

/* Reflection S=diag(1,1,-1) changes the WebXR -Z-forward world convention to
 * the rest of V30's +Z-forward camera convention. R' = S R S remains a proper
 * rotation. */
function quatToMat(q){const {x,y,z,w}=q,xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];}
function matToQuat(m){const tr=m[0]+m[4]+m[8];let x,y,z,w;if(tr>0){const s=Math.sqrt(tr+1)*2;w=.25*s;x=(m[7]-m[5])/s;y=(m[2]-m[6])/s;z=(m[3]-m[1])/s;}else if(m[0]>m[4]&&m[0]>m[8]){const s=Math.sqrt(1+m[0]-m[4]-m[8])*2;w=(m[7]-m[5])/s;x=.25*s;y=(m[1]+m[3])/s;z=(m[2]+m[6])/s;}else if(m[4]>m[8]){const s=Math.sqrt(1+m[4]-m[0]-m[8])*2;w=(m[2]-m[6])/s;x=(m[1]+m[3])/s;y=.25*s;z=(m[5]+m[7])/s;}else{const s=Math.sqrt(1+m[8]-m[0]-m[4])*2;w=(m[3]-m[1])/s;x=(m[2]+m[6])/s;y=(m[5]+m[7])/s;z=.25*s;}return qNormalize([x,y,z,w]);}
export function xrPoseToSlam(transform){
  const p=transform.position,R=quatToMat(transform.orientation),S=[1,1,-1],M=new Array(9);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)M[r*3+c]=S[r]*R[r*3+c]*S[c];
  return {p:[p.x,p.y,-p.z],q:matToQuat(M)};
}
export const xrPointToSlam=p=>[p.x,p.y,-p.z];

function rayForUv(uv,K){
  // K.cy is measured from the lower-left texture origin in Raw Camera Access.
  const px=uv[0]*K.width,py=(1-uv[1])*K.height;
  const x=(px-K.cx)/K.fx,y=(py-K.cy)/K.fy,z=-1,n=Math.hypot(x,y,z)||1;
  return new XRRay(new DOMPointReadOnly(0,0,0,1),new DOMPointReadOnly(x/n,y/n,z/n,0));
}
function stableStats(history){
  if(!history.length)return null;const c=[mean(history.map(p=>p[0])),mean(history.map(p=>p[1])),mean(history.map(p=>p[2]))];
  const rms=Math.sqrt(mean(history.map(p=>dist(p,c)**2)));return {p:c,rms};
}
function grayscalePatch(rgba,size,outSize){
  const out=new Uint8Array(outSize*outSize);let sum=0,sum2=0;
  for(let oy=0;oy<outSize;oy++)for(let ox=0;ox<outSize;ox++){
    const sx=clamp(Math.floor((ox+.5)*size/outSize),0,size-1),sy=clamp(Math.floor((oy+.5)*size/outSize),0,size-1);
    // readPixels returns bottom-left rows. Flip them here so stored patch UVs are
    // top-left like normal HTML canvas / analysis frames.
    const src=((size-1-sy)*size+sx)*4,v=(rgba[src]*77+rgba[src+1]*150+rgba[src+2]*29)>>8;
    out[oy*outSize+ox]=v;sum+=v;sum2+=v*v;
  }
  const n=out.length,m=sum/n,variance=Math.max(0,sum2/n-m*m);return {patch:out,variance};
}

export class XRMetricCalibrator extends EventTarget{
  constructor({overlayRoot,config,log}){super();this.root=overlayRoot;this.cfg=config;this.log=log;this.session=null;this.refSpace=null;this.viewerSpace=null;this.gl=null;this.binding=null;this.layer=null;this.sources=[];this.grid=[];this.anchors=new Map();this.histories=new Map();this.latestPose=null;this.latestIntrinsics=null;this.cameraSize=null;this._running=false;this._fbo=null;this._lastCameraTexture=null;this._endPromise=null;}
  async start(){
    if(!navigator.xr)throw new Error('WebXR non disponibile su questo browser');
    const supported=await navigator.xr.isSessionSupported('immersive-ar');if(!supported)throw new Error('immersive-ar non supportato');
    const opts={requiredFeatures:['local-floor','hit-test','camera-access','dom-overlay'],domOverlay:{root:this.root}};
    this.log?.info('xr-calibration-request',{requiredFeatures:opts.requiredFeatures});
    this.session=await navigator.xr.requestSession('immersive-ar',opts);
    this._running=true;this.gl=document.createElement('canvas').getContext('webgl',{xrCompatible:true,alpha:true,preserveDrawingBuffer:false});if(!this.gl)throw new Error('WebGL XR context non disponibile');
    await this.gl.makeXRCompatible?.();this.binding=new XRWebGLBinding(this.session,this.gl);this.layer=new XRWebGLLayer(this.session,this.gl,{alpha:true,antialias:false});this.session.updateRenderState({baseLayer:this.layer});
    this.refSpace=await this.session.requestReferenceSpace('local-floor');this.viewerSpace=await this.session.requestReferenceSpace('viewer');
    this._fbo=this.gl.createFramebuffer();
    this._endPromise=new Promise(resolve=>this.session.addEventListener('end',()=>{this._running=false;resolve();this.dispatchEvent(new Event('ended'));},{once:true}));
    this.session.requestAnimationFrame((t,f)=>this._frame(t,f));
    this.log?.info('xr-calibration-started',{blendMode:this.session.environmentBlendMode});
    return this;
  }
  async _initRays(K){
    if(this.sources.length)return;
    const us=[.20,.39,.61,.80],vs=[.23,.50,.77];let id=0;
    for(const v of vs)for(const u of us){
      try{const source=await this.session.requestHitTestSource({space:this.viewerSpace,offsetRay:rayForUv([u,v],K)});const item={id:`a${id++}`,uv:[u,v],source};this.sources.push(item);this.grid.push(item);this.histories.set(item.id,[]);}catch(err){this.log?.warn('xr-hit-source-failed',{u,v,message:err.message});}
    }
    this.log?.info('xr-hit-sources-ready',{count:this.sources.length});
  }
  _emitProgress(){
    const anchors=[...this.anchors.values()],xs=anchors.map(a=>a.p[0]),ys=anchors.map(a=>a.p[1]),zs=anchors.map(a=>a.p[2]);
    const span=anchors.length?Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs)):0,vertical=anchors.length?Math.max(...ys)-Math.min(...ys):0;
    const ready=anchors.length>=this.cfg.xrCalibrationMinAnchors&&span>=this.cfg.xrCalibrationMinSpanM&&vertical>=this.cfg.xrCalibrationMinVerticalSpanM;
    const detail={count:anchors.length,target:this.cfg.xrCalibrationTargetAnchors,span,vertical,ready,cameraSize:this.cameraSize};this.dispatchEvent(new CustomEvent('progress',{detail}));return detail;
  }
  _cameraPatch(texture,uv,K){
    const gl=this.gl,size=clamp(Math.round(Math.min(K.width,K.height)*this.cfg.xrCalibrationPatchFraction),36,96),x=Math.round(uv[0]*K.width-size/2),y=Math.round((1-uv[1])*K.height-size/2),x0=clamp(x,0,K.width-size),y0=clamp(y,0,K.height-size);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);throw new Error('camera texture framebuffer incomplete');}
    const rgba=new Uint8Array(size*size*4);gl.readPixels(x0,y0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,rgba);gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);
    const g=grayscalePatch(rgba,size,this.cfg.xrCalibrationPatchSize);return {...g,patchRel:size/Math.min(K.width,K.height)};
  }
  async _frame(_time,frame){
    if(!this._running)return;try{
      const pose=frame.getViewerPose(this.refSpace);if(pose?.views?.length){const view=pose.views[0],camera=view.camera;if(camera){const K=projectionToIntrinsics(view.projectionMatrix,camera.width,camera.height);this.latestIntrinsics={fxN:K.fx/K.width,fyN:K.fy/K.height,cxN:K.cx/K.width,cyN:K.cy/K.height};this.cameraSize=[camera.width,camera.height];this.latestPose=xrPoseToSlam(view.transform);await this._initRays(K);let texture=null;try{texture=this.binding.getCameraImage(camera);this._lastCameraTexture=texture;}catch(err){this.log?.warn('xr-camera-texture-failed',{message:err.message});}
        for(const item of this.sources){const hits=frame.getHitTestResults(item.source);if(!hits.length)continue;const hp=hits[0].getPose(this.refSpace);if(!hp)continue;const p=xrPointToSlam(hp.transform.position),hist=this.histories.get(item.id);hist.push(p);while(hist.length>this.cfg.xrCalibrationStableFrames)hist.shift();if(hist.length<this.cfg.xrCalibrationStableFrames||this.anchors.has(item.id))continue;const s=stableStats(hist);if(s.rms>this.cfg.xrCalibrationHitStdM)continue;let patch=null;try{if(texture)patch=this._cameraPatch(texture,item.uv,K);}catch(err){this.log?.warn('xr-patch-read-failed',{id:item.id,message:err.message});}
          if(!patch||patch.variance<45)continue;this.anchors.set(item.id,{id:item.id,uv:item.uv,p:s.p,hitStdM:s.rms,patchSize:this.cfg.xrCalibrationPatchSize,patchRel:patch.patchRel,variance:patch.variance,patch:Array.from(patch.patch)});this.log?.info('xr-anchor-accepted',{id:item.id,p:s.p,hitStdM:s.rms,variance:patch.variance});this._emitProgress();
        }
      }}
    }catch(err){this.log?.error('xr-calibration-frame-error',{message:err.message,stack:err.stack});}
    if(this._running)this.session.requestAnimationFrame((t,f)=>this._frame(t,f));
  }
  quality(){return this._emitProgress();}
  async finish(){const q=this.quality();if(!q.ready)throw new Error(`Calibrazione non completa: ${q.count} riferimenti, span ${q.span.toFixed(2)} m, verticale ${q.vertical.toFixed(2)} m`);const result={format:'ROOMSCAN-V30-XR-CALIBRATION-1',createdAt:Date.now(),referenceSpace:'local-floor',coordinateConvention:'+X right +Y up +Z forward',anchors:[...this.anchors.values()],pose:this.latestPose,intrinsicsNorm:this.latestIntrinsics,cameraSize:this.cameraSize,quality:q};await this.stop();return result;}
  async stop(){if(this.session){try{await this.session.end();}catch{}}await this._endPromise?.catch(()=>{});for(const s of this.sources)try{s.source.cancel?.();}catch{}this.sources=[];}
}
