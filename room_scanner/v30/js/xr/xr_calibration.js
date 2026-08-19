/*
 * Room Scanner V30.13.0 - minimal user-selected multi-view WebXR calibration with REAL
 * XRAnchor-backed pins.
 *
 * V30.8 bug fixed here
 * --------------------
 * V30.8 converted hit-test poses to plain XYZ values, cancelled the hit-test
 * source and then drew the visual marker forever at target.seedUv. Therefore the
 * marker visible to the user was screen-space even while the underlying XYZ was
 * intended to represent the room.
 *
 * V30.11 contract
 * --------------
 *  1. Every metric point must be created by XRHitTestResult.createAnchor().
 *  2. A point counts only while its XRAnchor is present in frame.trackedAnchors.
 *  3. Its room position is re-read every XR frame with
 *       frame.getPose(anchor.anchorSpace, referenceSpace).
 *  4. The DOM canvas is only a diagnostic projection. Its marker UV is derived
 *     from the live anchor pose every frame; seedUv is never reused after the
 *     anchor becomes active.
 *  5. Apply becomes available as soon as >=3 user pins have useful multi-view
 *     evidence and >=3 such pins are visible together in a non-degenerate
 *     common view. Global multi-pin pose samples remain diagnostic only.
 *  6. createAnchor() is started while the XRFrame/hit result is current, but no
 *     frame.getPose() is performed after awaiting that promise. The first anchor
 *     pose is read from a subsequent active XR frame.
 */

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const clonePose=p=>({p:[...p.p],q:[...p.q]});

function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(v=>v/n);}
function qAngle(a,b){const A=qNormalize(a),B=qNormalize(b),d=Math.abs(A[0]*B[0]+A[1]*B[1]+A[2]*B[2]+A[3]*B[3]);return 2*Math.acos(clamp(d,-1,1));}
function qRotate(q,v){
  const [x,y,z,w]=qNormalize(q),[vx,vy,vz]=v;
  const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
  return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];
}
function qConj(q){return [-q[0],-q[1],-q[2],q[3]];}

function mat3ToQuat(m){
  const [m00,m01,m02,m10,m11,m12,m20,m21,m22]=m,tr=m00+m11+m22;let x,y,z,w;
  if(tr>0){const s=Math.sqrt(tr+1)*2;w=.25*s;x=(m21-m12)/s;y=(m02-m20)/s;z=(m10-m01)/s;}
  else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;w=(m21-m12)/s;x=.25*s;y=(m01+m10)/s;z=(m02+m20)/s;}
  else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;w=(m02-m20)/s;x=(m01+m10)/s;y=.25*s;z=(m12+m21)/s;}
  else{const s=Math.sqrt(1+m22-m00-m11)*2;w=(m10-m01)/s;x=(m02+m20)/s;y=(m12+m21)/s;z=.25*s;}
  return qNormalize([x,y,z,w]);
}

export function projectionToIntrinsics(proj,width,height){
  return {fx:width*.5*proj[0],fy:height*.5*proj[5],cx:(1-proj[8])*width*.5,cy:(1-proj[9])*height*.5,width,height};
}

/* WebXR camera/world uses -Z forward. V30 SLAM uses +Z forward. Reflection S
 * = diag(1,1,-1) is applied to position and to both sides of the rotation. */
function xrPoseToSlam(transform){
  const M=transform?.matrix;
  if(M?.length>=16){
    const r00=M[0],r01=M[4],r02=M[8],r10=M[1],r11=M[5],r12=M[9],r20=M[2],r21=M[6],r22=M[10];
    const q=mat3ToQuat([r00,r01,-r02,r10,r11,-r12,-r20,-r21,r22]);
    return {p:[M[12],M[13],-M[14]],q};
  }
  const p=transform.position,o=transform.orientation;
  // Fallback uses the equivalent quaternion reflection for S*R*S.
  return {p:[p.x,p.y,-p.z],q:qNormalize([-o.x,-o.y,o.z,o.w])};
}
function xrPointToSlam(p){return [p.x,p.y,-p.z];}

export function projectSlamPointToUv(pose,p,K){
  if(!pose||!p||!K)return null;
  const rel=[p[0]-pose.p[0],p[1]-pose.p[1],p[2]-pose.p[2]],cam=qRotate(qConj(pose.q),rel),z=cam[2];
  if(!(z>1e-4))return null;
  const px=K.fx*cam[0]/z+K.cx,py=K.cy-K.fy*cam[1]/z;
  return {u:px/K.width,v:py/K.height,z,px,py};
}

function rayForUv(uv,K){
  const x=(uv[0]*K.width-K.cx)/Math.max(1e-9,K.fx),y=(K.cy-uv[1]*K.height)/Math.max(1e-9,K.fy),n=Math.hypot(x,y,1)||1;
  return new XRRay(new DOMPointReadOnly(0,0,0,1),new DOMPointReadOnly(x/n,y/n,-1/n,0));
}
function stableStats(history){
  if(!history.length)return null;const c=[mean(history.map(p=>p[0])),mean(history.map(p=>p[1])),mean(history.map(p=>p[2]))];
  return {p:c,rms:Math.sqrt(mean(history.map(p=>dist(p,c)**2)))};
}
function grayscalePatch(rgba,size,outSize){
  const out=new Uint8Array(outSize*outSize);let sum=0,sum2=0;
  for(let oy=0;oy<outSize;oy++)for(let ox=0;ox<outSize;ox++){
    const sx=clamp(Math.floor((ox+.5)*size/outSize),0,size-1),sy=clamp(Math.floor((oy+.5)*size/outSize),0,size-1),src=((size-1-sy)*size+sx)*4,v=(rgba[src]*77+rgba[src+1]*150+rgba[src+2]*29)>>8;
    out[oy*outSize+ox]=v;sum+=v;sum2+=v*v;
  }
  const n=out.length,m=sum/n,variance=Math.max(0,sum2/n-m*m);return {patch:out,variance};
}
function patchStats(a){let s=0,s2=0;for(const v of a){s+=v;s2+=v*v;}const n=a.length,m=s/n,sd=Math.sqrt(Math.max(1,s2/n-m*m));return {m,sd};}
function zncc(a,b){if(!a||!b||a.length!==b.length)return -1;const A=patchStats(a),B=patchStats(b);if(A.sd<3||B.sd<3)return -1;let n=0;for(let i=0;i<a.length;i++)n+=(a[i]-A.m)*(b[i]-B.m);return n/(a.length*A.sd*B.sd);}

export function patchDetailScore(patch,size=Math.round(Math.sqrt(patch.length))){
  if(!patch?.length||size<4)return 0;let gx2=0,gy2=0,corners=0;
  for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
    const i=y*size+x,gx=(patch[i+1]-patch[i-1])*.5,gy=(patch[i+size]-patch[i-size])*.5;gx2+=gx*gx;gy2+=gy*gy;corners+=Math.min(gx*gx,gy*gy);
  }
  const n=Math.max(1,(size-2)*(size-2));return Math.sqrt(Math.min(gx2,gy2)/n)+.45*Math.sqrt(corners/n);
}
function maxPoseBaseline(poses){let best=0;for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)best=Math.max(best,dist(poses[i].p,poses[j].p));return best;}
function maxPoseAngle(poses){let best=0;for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)best=Math.max(best,qAngle(poses[i].q,poses[j].q));return best;}
function averageUv(vs){if(!vs.length)return null;return [mean(vs.map(v=>v.uv[0])),mean(vs.map(v=>v.uv[1]))];}
function maxTriangleArea3(points){
  let best=0;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)for(let k=j+1;k<points.length;k++){
    const a=points[i],b=points[j],c=points[k],ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    best=Math.max(best,.5*Math.hypot(...cross));
  }
  return best;
}
function maxTriangleArea2(points){
  let best=0;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)for(let k=j+1;k<points.length;k++){
    const a=points[i],b=points[j],c=points[k],twice=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
    best=Math.max(best,.5*twice);
  }
  return best;
}
function targetCenter(target){
  const ps=(target.points||[]).map(p=>p.p).filter(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
  if(!ps.length)return null;
  return [mean(ps.map(p=>p[0])),mean(ps.map(p=>p[1])),mean(ps.map(p=>p[2]))];
}

export class XRMetricCalibrator extends EventTarget{
  constructor({overlayRoot,config,log}){
    super();
    this.root=overlayRoot;this.cfg=config;this.log=log;
    this.session=null;this.refSpace=null;this.viewerSpace=null;this.gl=null;this.binding=null;this.layer=null;
    this.latestPose=null;this.latestIntrinsics=null;this.latestK=null;this.cameraSize=null;
    this._running=false;this._fbo=null;this._endPromise=null;this._missingTrackedAnchorsLogged=false;
    this.candidates=[];this.targets=[];this.globalPoses=[];this._targetSeq=0;this._lastCandidateScanAt=0;this._lastProgressAt=0;this._latestTexture=null;
    this.manualAim={uv:[0.5,0.5],source:null,history:[],valid:false,stable:false,point:null,xrPoint:null,depthM:null,rmsM:null,lastHitAt:0};
    this._manualAimRequestSeq=0;this._centerAimPending=false;this._scenePinProgram=null;this._scenePinUniforms=null;
    // Public, diagnostic-only handle used by the V30.10 DOM overlay. The XRAnchor
    // remains the authoritative source of pin position.
    if(typeof window!=='undefined'){window.__ROOMSCAN_ACTIVE_CALIBRATOR=this;window.dispatchEvent(new CustomEvent('roomscan:xr-calibrator-ready',{detail:{calibrator:this}}));}
  }

  async start(){
    if(!navigator.xr)throw new Error('WebXR non disponibile su questo browser');
    if(!await navigator.xr.isSessionSupported('immersive-ar'))throw new Error('immersive-ar non supportato');
    const required=['local-floor','hit-test','camera-access','dom-overlay'];
    if(this.cfg.xrRequireRealAnchors!==false)required.push('anchors');
    const opts={requiredFeatures:required,domOverlay:{root:this.root}};
    this.log?.info('xr-calibration-request',{requiredFeatures:required,mode:'real-xranchor-user-selected-multiview'});
    this.session=await navigator.xr.requestSession('immersive-ar',opts);this._running=true;
    this.gl=document.createElement('canvas').getContext('webgl',{xrCompatible:true,alpha:true,preserveDrawingBuffer:false});
    if(!this.gl)throw new Error('WebGL XR context non disponibile');
    await this.gl.makeXRCompatible?.();
    this.binding=new XRWebGLBinding(this.session,this.gl);
    this.layer=new XRWebGLLayer(this.session,this.gl,{alpha:true,antialias:true});
    this.session.updateRenderState({baseLayer:this.layer});
    this._initScenePinRenderer();
    this.refSpace=await this.session.requestReferenceSpace('local-floor');
    this.viewerSpace=await this.session.requestReferenceSpace('viewer');
    this._fbo=this.gl.createFramebuffer();

    // A reference-space reset changes the numeric coordinate basis. Anchors stay
    // authoritative, but pose-diversity samples from the previous basis cannot
    // be mixed with new ones.
    this.refSpace.addEventListener?.('reset',()=>{
      this.globalPoses=[];
      for(const t of this.targets){t.viewPoses=[];t.views=0;t.maxBaselineM=0;t.maxAngleRad=0;t.ready=false;}
      this.log?.warn('xr-reference-space-reset',{action:'pose-coverage-cleared-live-anchors-retained'});
      this._emitProgress(true);
    });

    this._endPromise=new Promise(resolve=>this.session.addEventListener('end',()=>{this._running=false;resolve();this.dispatchEvent(new Event('ended'));},{once:true}));
    this.session.requestAnimationFrame((t,f)=>this._frame(t,f));
    this.log?.info('xr-calibration-started',{blendMode:this.session.environmentBlendMode,realAnchorsRequired:this.cfg.xrRequireRealAnchors!==false});
    return this;
  }

  _cameraPatch(texture,uv,K,{fraction=this.cfg.xrCalibrationPatchFraction,outSize=this.cfg.xrCalibrationPatchSize}={}){
    const gl=this.gl,size=clamp(Math.round(Math.min(K.width,K.height)*fraction),28,96),x=Math.round(uv[0]*K.width-size/2),y=Math.round((1-uv[1])*K.height-size/2),x0=clamp(x,0,K.width-size),y0=clamp(y,0,K.height-size);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);throw new Error('camera texture framebuffer incomplete');}
    const rgba=new Uint8Array(size*size*4);gl.readPixels(x0,y0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,rgba);gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);
    const g=grayscalePatch(rgba,size,outSize);return {...g,patchRel:size/Math.min(K.width,K.height),detail:patchDetailScore(g.patch,outSize)};
  }

  _refreshCandidates(texture,K,time){
    if(!texture||time-this._lastCandidateScanAt<this.cfg.xrCandidateRefreshMs||this.targets.length>=this.cfg.xrCalibrationMaxTargets)return;
    this._lastCandidateScanAt=time;const raw=[],us=[.14,.32,.50,.68,.86],vs=[.13,.30,.47,.64];let index=0;
    for(const v of vs)for(const u of us){
      try{const p=this._cameraPatch(texture,[u,v],K,{fraction:this.cfg.xrCandidatePatchFraction,outSize:this.cfg.xrCandidatePatchSize}),score=p.detail+.025*Math.sqrt(p.variance);if(p.variance>=this.cfg.xrCandidateMinVariance&&p.detail>=this.cfg.xrCandidateMinDetail)raw.push({id:`c${index}`,uv:[u,v],score,variance:p.variance,detail:p.detail});}
      catch(err){this.log?.warn('xr-candidate-patch-failed',{message:err.message});break;}index++;
    }
    raw.sort((a,b)=>b.score-a.score);const out=[];
    for(const c of raw){const nearSelected=this.targets.some(t=>Math.hypot(t.seedUv[0]-c.uv[0],t.seedUv[1]-c.uv[1])<.11);if(nearSelected||out.some(o=>Math.hypot(o.uv[0]-c.uv[0],o.uv[1]-c.uv[1])<.13))continue;out.push(c);if(out.length>=this.cfg.xrCandidateMaxVisible)break;}
    this.candidates=out;this.log?.debug?.('xr-candidates-updated',{count:out.length,best:out[0]?.score||0});this._emitProgress(true);
  }

  async setManualAim(uv){
    if(!this._running||!this.latestK||!this.viewerSpace)return false;
    const clean=[clamp(Number(uv?.[0])||.5,.03,.97),clamp(Number(uv?.[1])||.5,.03,.88)];
    const seq=++this._manualAimRequestSeq;
    const old=this.manualAim.source;this.manualAim={uv:clean,source:null,history:[],valid:false,stable:false,point:null,depthM:null,rmsM:null,lastHitAt:0};
    try{old?.cancel?.();}catch{}
    try{
      const source=await this.session.requestHitTestSource({space:this.viewerSpace,offsetRay:rayForUv(clean,this.latestK)});
      if(seq!==this._manualAimRequestSeq){try{source.cancel?.();}catch{}return false;}
      this.manualAim.source=source;this._emitProgress(true);return true;
    }catch(err){this.log?.warn('xr-manual-aim-source-failed',{message:err.message});this.dispatchEvent(new CustomEvent('pin-rejected',{detail:{message:err.message}}));return false;}
  }

  clearManualAim(){
    ++this._manualAimRequestSeq;try{this.manualAim.source?.cancel?.();}catch{}
    this.manualAim={uv:[.5,.5],source:null,history:[],valid:false,stable:false,point:null,xrPoint:null,depthM:null,rmsM:null,lastHitAt:0};this._emitProgress(true);
  }

  _ensureCenterAim(){
    if(this.manualAim?.source||this._centerAimPending||!this.viewerSpace||!this.latestK)return;
    this._centerAimPending=true;
    this.setManualAim([.5,.5]).catch(err=>this.log?.warn('xr-center-aim',{message:err?.message||String(err)})).finally(()=>{this._centerAimPending=false;});
  }

  _compileShader(type,source){const gl=this.gl,sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(sh)||'shader compile failed';gl.deleteShader(sh);throw new Error(msg);}return sh;}
  _initScenePinRenderer(){
    const gl=this.gl;if(!gl)return;
    const vs=this._compileShader(gl.VERTEX_SHADER,'uniform vec3 u_point;uniform mat4 u_projection;uniform mat4 u_view;uniform float u_size;void main(){gl_Position=u_projection*u_view*vec4(u_point,1.0);gl_PointSize=u_size;}');
    const fs=this._compileShader(gl.FRAGMENT_SHADER,'precision mediump float;uniform vec4 u_color;void main(){vec2 p=gl_PointCoord-vec2(0.5);float r=length(p);if(r>0.5)discard;float ring=smoothstep(0.38,0.48,r);vec4 c=mix(u_color,vec4(1.0,1.0,1.0,1.0),ring);gl_FragColor=c;}');
    const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'pin shader link failed');
    this._scenePinProgram=program;this._scenePinUniforms={point:gl.getUniformLocation(program,'u_point'),projection:gl.getUniformLocation(program,'u_projection'),view:gl.getUniformLocation(program,'u_view'),size:gl.getUniformLocation(program,'u_size'),color:gl.getUniformLocation(program,'u_color')};
  }
  _drawScenePoint(point,projection,viewMatrix,{size=22,color=[.1,.85,1,1]}={}){
    const gl=this.gl,u=this._scenePinUniforms;if(!gl||!this._scenePinProgram||!point)return;gl.useProgram(this._scenePinProgram);gl.uniform3f(u.point,point[0],point[1],point[2]);gl.uniformMatrix4fv(u.projection,false,projection);gl.uniformMatrix4fv(u.view,false,viewMatrix);gl.uniform1f(u.size,size);gl.uniform4fv(u.color,color);gl.drawArrays(gl.POINTS,0,1);
  }
  _renderScenePins(frame,view){
    const gl=this.gl;if(!gl||!this.layer||!view||!this._scenePinProgram)return;const vp=this.layer.getViewport(view);if(!vp)return;gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);gl.viewport(vp.x,vp.y,vp.width,vp.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);const tracked=this._trackedSet(frame),P=view.projectionMatrix,V=view.transform.inverse.matrix;
    if(tracked)for(const t of this.targets)for(const p of t.points||[]){const a=p.runtimeAnchor;if(!a||!tracked.has(a))continue;let pose=null;try{pose=frame.getPose(a.anchorSpace,this.refSpace);}catch{}if(!pose)continue;const x=pose.transform.position;p.xrP=[x.x,x.y,x.z];this._drawScenePoint(p.xrP,P,V,{size:24,color:[.05,.78,1,1]});}
    if(this.manualAim?.valid&&this.manualAim.xrPoint)this._drawScenePoint(this.manualAim.xrPoint,P,V,{size:this.manualAim.stable?18:12,color:this.manualAim.stable?[.2,1,.45,.95]:[1,.8,.2,.85]});
    gl.disable(gl.BLEND);
  }

  _processManualAim(frame){
    const a=this.manualAim;if(!a?.source||!this.latestPose)return;
    let hits=[];try{hits=frame.getHitTestResults(a.source)||[];}catch{return;}
    if(!hits.length){a.valid=false;a.stable=false;a.point=null;a.xrPoint=null;a.depthM=null;return;}
    const hp=hits[0].getPose(this.refSpace);if(!hp){a.valid=false;a.stable=false;return;}
    const raw=hp.transform.position,p=xrPointToSlam(raw);a.xrPoint=[raw.x,raw.y,raw.z];a.history.push(p);while(a.history.length>(this.cfg.xrManualAimStableFrames||6))a.history.shift();
    const st=stableStats(a.history),need=this.cfg.xrManualAimStableFrames||6;a.valid=true;a.point=p;a.depthM=dist(this.latestPose.p,p);a.rmsM=st?.rms??null;a.stable=!!st&&a.history.length>=need&&st.rms<=(this.cfg.xrManualAimHitStdM||.02);a.lastHitAt=performance.now();
  }

  async confirmManualPin(){
    const a=this.manualAim;
    if(!a?.valid){this.dispatchEvent(new CustomEvent('pin-rejected',{detail:{message:'Nessuna superficie WebXR sotto il reticolo. Muovi lentamente il telefono finché compare la profondità.'}}));return false;}
    if(!a.stable){this.dispatchEvent(new CustomEvent('pin-rejected',{detail:{message:`Hit-test non ancora stabile (${Number(a.rmsM||0).toFixed(3)} m). Tieni fermo il reticolo per un istante.`}}));return false;}
    const candidate={id:'manual-confirmed',uv:[...a.uv],score:1,variance:999,detail:999,manual:true,previewPoint:[...a.point],previewDepthM:a.depthM};
    try{const id=await this.pinCandidate(candidate);this.clearManualAim();return id;}catch(err){this.log?.warn('xr-manual-pin-rejected',{message:err.message});this.dispatchEvent(new CustomEvent('pin-rejected',{detail:{message:err.message}}));return false;}
  }

  async pinNearestCandidate(uv){
    // Compatibility with the original app.js click handler. V30.9 could throw
    // here and become an unhandled Promise rejection. V30.10 never rejects for
    // normal user placement failures: tap -> aim preview -> explicit confirm.
    try{await this.setManualAim(uv);return true;}catch(err){this.log?.warn('xr-user-pin-tap-rejected',{message:err.message});this.dispatchEvent(new CustomEvent('pin-rejected',{detail:{message:err.message}}));return false;}
  }

  async pinCandidate(candidate){
    if(!this.latestK)throw new Error('Attendi il primo frame WebXR valido');
    const id=`obj${++this._targetSeq}`,offsets=[[0,0]],rays=[];
    for(let i=0;i<offsets.length;i++){
      const uv=[clamp(candidate.uv[0]+offsets[i][0],.04,.96),clamp(candidate.uv[1]+offsets[i][1],.04,.86)];
      try{const source=await this.session.requestHitTestSource({space:this.viewerSpace,offsetRay:rayForUv(uv,this.latestK)});rays.push({id:`${id}:p${i}`,uv,source,history:[],anchor:null,anchorPending:false,persistentHandle:null,persistentHandlePending:false,pendingMeta:null,resolved:null});}
      catch(err){this.log?.warn('xr-selected-hit-source-failed',{id,i,message:err.message});}
    }
    if(rays.length<this.cfg.xrCalibrationMinPointsPerTarget){for(const r of rays)try{r.source.cancel?.();}catch{}throw new Error('ARCore non fornisce abbastanza hit-test su questo dettaglio');}
    const target={id,seedUv:[...candidate.uv],candidateScore:candidate.score,state:'acquiring',createdAt:Date.now(),rays,points:[],viewPoses:[],views:0,maxBaselineM:0,maxAngleRad:0,visible:false,visiblePoints:0,lastVisible:[],displayUv:null,ready:false,roiViews:[],roiSectors:[]};
    this.targets.push(target);this.candidates=this.candidates.filter(c=>c.id!==candidate.id);this.log?.info('xr-user-target-pinned',{id,uv:target.seedUv,rays:rays.length,score:candidate.score,contract:'XRAnchor-required'});this._emitProgress(true);return id;
  }

  _deleteAnchor(anchor){try{anchor?.delete?.();}catch{}}
  undoLastTarget(){
    const t=this.targets.pop();if(!t)return false;
    for(const r of t.rays||[]){try{r.source?.cancel?.();}catch{}this._deleteAnchor(r.anchor);}
    for(const p of t.points||[])this._deleteAnchor(p.runtimeAnchor);
    this.log?.info('xr-user-target-removed',{id:t.id});this._emitProgress(true);return true;
  }

  _requestPersistentHandle(ray){
    if(this.cfg.xrRequestPersistentHandles===false||!ray.anchor||typeof ray.anchor.requestPersistentHandle!=='function'||ray.persistentHandlePending)return;
    ray.persistentHandlePending=true;
    Promise.resolve().then(()=>ray.anchor.requestPersistentHandle()).then(handle=>{ray.persistentHandle=handle||null;if(ray.resolved)ray.resolved.persistentHandle=ray.persistentHandle;ray.persistentHandlePending=false;this.log?.info('xr-anchor-persistent-handle',{id:ray.id,persistent:!!handle});}).catch(err=>{ray.persistentHandlePending=false;this.log?.warn('xr-anchor-persistence-unavailable',{id:ray.id,message:err.message});});
  }

  _beginAnchorCreation(ray,hit,patch,stable){
    if(ray.anchorPending||ray.anchor||ray.resolved)return;
    if(typeof hit?.createAnchor!=='function')throw new Error('Il runtime WebXR non espone XRHitTestResult.createAnchor(): calibrazione world-locked non disponibile.');
    ray.anchorPending=true;
    ray.pendingMeta={hitStdM:stable.rms,reference:{uv:[...ray.uv],patch:Array.from(patch.patch),patchSize:this.cfg.xrCalibrationPatchSize,patchRel:patch.patchRel,variance:patch.variance,detail:patch.detail}};
    let promise;
    try{
      // IMPORTANT: invoke createAnchor while this hit-test result belongs to the
      // current active XR frame. Do not query that frame after this Promise settles.
      promise=hit.createAnchor();
    }catch(err){ray.anchorPending=false;ray.pendingMeta=null;throw err;}
    Promise.resolve(promise).then(anchor=>{
      ray.anchorPending=false;
      if(!anchor?.anchorSpace){this._deleteAnchor(anchor);throw new Error('XRAnchor creato senza anchorSpace');}
      ray.anchor=anchor;this._requestPersistentHandle(ray);
      this.log?.info('xr-anchor-created-awaiting-tracking',{id:ray.id});
    }).catch(err=>{ray.anchorPending=false;ray.anchor=null;ray.pendingMeta=null;this.log?.warn('xr-anchor-create-failed',{id:ray.id,message:err.message});});
  }

  _trackedSet(frame){
    const s=frame?.trackedAnchors;
    if(s&&typeof s.has==='function')return s;
    if(!this._missingTrackedAnchorsLogged){this._missingTrackedAnchorsLogged=true;this.log?.error('xr-trackedAnchors-missing',{message:'Calibration refuses getPose-only fallback; real anchor tracking is required.'});}
    return null;
  }

  _tryResolveRayAnchor(target,ray,frame){
    if(!ray.anchor||ray.resolved)return;
    const tracked=this._trackedSet(frame);if(!tracked||!tracked.has(ray.anchor))return;
    const pose=frame.getPose(ray.anchor.anchorSpace,this.refSpace);if(!pose)return;
    const meta=ray.pendingMeta;if(!meta)return;
    ray.resolved={id:ray.id,objectId:target.id,p:xrPointToSlam(pose.transform.position),xrP:[pose.transform.position.x,pose.transform.position.y,pose.transform.position.z],seedUv:[...ray.uv],hitStdM:meta.hitStdM,reference:meta.reference,observations:[],persistentHandle:ray.persistentHandle||null,runtimeAnchor:ray.anchor,tracked:true,realAnchor:true};
    this.log?.info('xr-target-point-anchored',{objectId:target.id,id:ray.id,p:ray.resolved.p,hitStdM:meta.hitStdM,persistent:!!ray.persistentHandle});
  }

  _processAcquiringTarget(target,frame,texture,K){
    for(const ray of target.rays){
      if(ray.resolved){continue;}
      if(ray.anchor){this._tryResolveRayAnchor(target,ray,frame);continue;}
      if(ray.anchorPending)continue;
      const hits=frame.getHitTestResults(ray.source);if(!hits.length)continue;const hp=hits[0].getPose(this.refSpace);if(!hp)continue;
      const p=xrPointToSlam(hp.transform.position);ray.history.push(p);while(ray.history.length>this.cfg.xrCalibrationStableFrames)ray.history.shift();if(ray.history.length<this.cfg.xrCalibrationStableFrames)continue;
      const stable=stableStats(ray.history);if(!stable||stable.rms>this.cfg.xrCalibrationHitStdM)continue;
      let patch=null;try{if(texture)patch=this._cameraPatch(texture,ray.uv,K);}catch(err){this.log?.warn('xr-selected-patch-read-failed',{id:ray.id,message:err.message});}
      if(!patch||patch.variance<this.cfg.xrCalibrationMinPatchVariance||patch.detail<this.cfg.xrCalibrationMinPatchDetail)continue;
      try{this._beginAnchorCreation(ray,hits[0],patch,stable);}catch(err){this.log?.error('xr-anchor-required-failed',{id:ray.id,message:err.message});}
    }

    const resolved=target.rays.map(r=>r.resolved).filter(Boolean);
    if(resolved.length>=this.cfg.xrCalibrationMinPointsPerTarget){
      target.points=resolved;target.state='tracking';
      for(const r of target.rays){try{r.source?.cancel?.();}catch{}if(!r.resolved)this._deleteAnchor(r.anchor);}
      target.rays=[];
      this.log?.info('xr-target-real-anchor-ready',{id:target.id,points:resolved.length});this._emitProgress(true);
    }
  }

  _updatePointAnchor(point,frame){
    const anchor=point.runtimeAnchor,tracked=this._trackedSet(frame);
    point.tracked=false;
    if(!anchor||!tracked||!tracked.has(anchor))return false;
    let pose;try{pose=frame.getPose(anchor.anchorSpace,this.refSpace);}catch(err){this.log?.warn('xr-anchor-getpose-failed',{id:point.id,message:err.message});return false;}
    if(!pose)return false;
    point.p=xrPointToSlam(pose.transform.position);point.xrP=[pose.transform.position.x,pose.transform.position.y,pose.transform.position.z];point.tracked=true;
    // A handle may resolve after the point was promoted from its acquisition ray.
    return true;
  }

  _pointVisible(point,frame,texture,K){
    if(!this._updatePointAnchor(point,frame))return null;
    const pr=projectSlamPointToUv(this.latestPose,point.p,K);if(!pr||pr.u<.045||pr.u>.955||pr.v<.045||pr.v>.84)return null;
    if(!texture)return null;
    let p;try{p=this._cameraPatch(texture,[pr.u,pr.v],K);}catch{return null;}
    const templates=[point.reference,...point.observations.slice(-3)],patch=p.patch;let score=-1;
    for(const t of templates){const s=zncc(Uint8Array.from(t.patch),patch);if(s>score)score=s;}
    if(score<this.cfg.xrCalibrationTrackingZncc)return null;
    return {id:point.id,uv:[pr.u,pr.v],patch:Array.from(patch),patchSize:this.cfg.xrCalibrationPatchSize,patchRel:p.patchRel,variance:p.variance,detail:p.detail,score};
  }

  _captureRoiView(target,texture,K,pose){
    if(!texture||!target.displayUv)return;
    const center=target.points.length?[mean(target.points.map(p=>p.p[0])),mean(target.points.map(p=>p.p[1])),mean(target.points.map(p=>p.p[2]))]:null;if(!center)return;
    const dx=pose.p[0]-center[0],dy=pose.p[1]-center[1],dz=pose.p[2]-center[2],range=Math.hypot(dx,dy,dz)||1;
    const az=Math.atan2(dx,dz),el=Math.asin(clamp(dy/range,-1,1)),azN=this.cfg.xrRoiAzimuthSectors||8,elN=this.cfg.xrRoiElevationBands||3;
    const azBin=Math.floor(((az+Math.PI)/(2*Math.PI))*azN)%azN,elBin=clamp(Math.floor(((el+Math.PI/2)/Math.PI)*elN),0,elN-1),sector=`${azBin}:${elBin}`;
    target.roiViews=target.roiViews||[];target.roiSectors=target.roiSectors||[];const views=target.roiViews,last=views[views.length-1],farEnough=!last||dist(last.pose.p,pose.p)>=(this.cfg.xrRoiCaptureStepM||.055)||qAngle(last.pose.q,pose.q)>=(this.cfg.xrRoiCaptureStepAngleRad||.055),newSector=!target.roiSectors.includes(sector);
    if(!farEnough&&!newSector)return;if(views.length>=(this.cfg.xrRoiMaxViewsPerTarget||24)&&!newSector)return;
    const scales=[];for(const fraction of (this.cfg.xrRoiScales||[.055,.11,.20])){try{const p=this._cameraPatch(texture,target.displayUv,K,{fraction,outSize:this.cfg.xrRoiPatchSize||24});scales.push({fraction,patch:Array.from(p.patch),variance:p.variance,detail:p.detail,patchRel:p.patchRel});}catch(err){this.log?.debug?.('xr-roi-scale-read-failed',{id:target.id,fraction,message:err.message});}}
    if(!scales.length)return;
    const item={at:Date.now(),uv:[...target.displayUv],pose:clonePose(pose),worldCenter:[...center],depthM:range,azimuthRad:az,elevationRad:el,sector,scales};
    views.push(item);while(views.length>(this.cfg.xrRoiMaxViewsPerTarget||24))views.shift();target.roiViews=views;if(!target.roiSectors.includes(sector))target.roiSectors.push(sector);
    this.log?.info('xr-pin-roi-view',{id:target.id,views:views.length,sectors:target.roiSectors.length,sector,depthM:range,scales:scales.length});
  }

  _processTrackingTarget(target,frame,texture,K){
    const visible=[];for(const p of target.points){const v=this._pointVisible(p,frame,texture,K);if(v)visible.push({point:p,...v});}
    target.visiblePoints=visible.length;target.visible=visible.length>=this.cfg.xrCalibrationMinPointsPerTarget;target.lastVisible=visible;target.displayUv=target.visible?averageUv(visible):null;
    if(!target.visible)return;
    this._captureRoiView(target,texture,K,this.latestPose);
    const pose=this.latestPose,poses=target.viewPoses,farEnough=!poses.length||dist(poses[poses.length-1].p,pose.p)>=this.cfg.xrCalibrationViewStepM||qAngle(poses[poses.length-1].q,pose.q)>=this.cfg.xrCalibrationViewStepAngleRad;
    if(farEnough&&poses.length<this.cfg.xrCalibrationMaxViewsPerTarget){
      target.viewPoses.push(clonePose(pose));target.views=target.viewPoses.length;target.maxBaselineM=maxPoseBaseline(target.viewPoses);target.maxAngleRad=maxPoseAngle(target.viewPoses);
      for(const v of visible){const arr=v.point.observations;arr.push({uv:v.uv,patch:v.patch,patchSize:v.patchSize,patchRel:v.patchRel,variance:v.variance,detail:v.detail,score:v.score,pose:clonePose(pose)});while(arr.length>this.cfg.xrCalibrationMaxTemplatesPerPoint)arr.shift();}
      this.log?.info('xr-target-view-added',{id:target.id,view:target.views,visiblePoints:visible.length,baselineM:target.maxBaselineM,angleRad:target.maxAngleRad,tracking:'XRAnchor'});
    }
    // A pin is 'useful' once it has several genuinely separated observations.
    // Sector count is deliberately diagnostic only: on a planar wall a good
    // lateral camera translation can remain inside one coarse azimuth bin.
    // Requiring four sectors was the main reason Apply could remain disabled.
    target.ready=target.points.length>=this.cfg.xrCalibrationMinPointsPerTarget
      &&target.views>=this.cfg.xrCalibrationMinViewsPerTarget
      &&target.maxBaselineM>=this.cfg.xrCalibrationMinTargetBaselineM
      &&(target.roiViews?.length||0)>=(this.cfg.xrRoiMinViewsPerTarget||4);
  }

  _captureGlobalPoseIfEligible(){
    const minPins=this.cfg.xrCalibrationMinPinsPerPose??3,visibleTargets=this.targets.filter(t=>t.state==='tracking'&&t.visible);
    if(visibleTargets.length<minPins||!this.latestPose)return;
    const pose=this.latestPose,stepM=this.cfg.xrCalibrationGlobalPoseStepM??this.cfg.xrCalibrationViewStepM??.075,stepA=this.cfg.xrCalibrationGlobalPoseStepAngleRad??this.cfg.xrCalibrationViewStepAngleRad??.07;
    const tooSimilar=this.globalPoses.some(s=>dist(s.pose.p,pose.p)<stepM&&qAngle(s.pose.q,pose.q)<stepA);if(tooSimilar)return;
    const sample={at:Date.now(),pose:clonePose(pose),targetIds:visibleTargets.map(t=>t.id),anchorPointIds:visibleTargets.flatMap(t=>t.lastVisible.map(v=>v.point.id))};
    this.globalPoses.push(sample);if(this.globalPoses.length>24)this.globalPoses.shift();
    this.log?.info('xr-global-calibration-pose-added',{poseCount:this.globalPoses.length,visibleAnchoredPins:visibleTargets.length,targetIds:sample.targetIds});
  }

  _quality(){
    const selected=this.targets.length,readyList=this.targets.filter(t=>t.ready),readyTargets=readyList.length;
    // Apply uses ANY three useful pins. Extra experimental pins that are not yet
    // ready must never make the whole calibration impossible to finish.
    const commonReady=readyList.filter(t=>t.visible),commonVisibleTargets=commonReady.length;
    const commonVisiblePoints=commonReady.reduce((sum,t)=>sum+(t.visiblePoints||0),0);
    const points=this.targets.flatMap(t=>t.points||[]),centers=commonReady.map(targetCenter).filter(Boolean),uvs=commonReady.map(t=>t.displayUv).filter(uv=>Array.isArray(uv)&&uv.length===2);
    let span=0;for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++)span=Math.max(span,dist(centers[i],centers[j]));
    const triangleAreaM2=maxTriangleArea3(centers),screenTriangleArea=maxTriangleArea2(uvs);
    const minSpan=this.cfg.xrCalibrationMinSpanM??.20,minArea=this.cfg.xrCalibrationMinTriangleAreaM2??.0025,minScreenArea=this.cfg.xrCalibrationMinScreenTriangleArea??.0015;
    const enoughUseful=readyTargets>=this.cfg.xrCalibrationMinTargets;
    const commonView=commonVisibleTargets>=this.cfg.xrCalibrationMinTargets&&commonVisiblePoints>=this.cfg.xrCalibrationMinCommonPoints;
    const geometryOk=commonView&&span>=minSpan&&triangleAreaM2>=minArea&&screenTriangleArea>=minScreenArea;
    const minGlobal=this.cfg.xrCalibrationMinGlobalPoses??3,poseCoverageOk=this.globalPoses.length>=minGlobal;
    // Global pose coverage remains recorded for diagnostics, but no longer gates
    // Apply: useful per-pin multi-view evidence already carries the required
    // perspective diversity. A current common view is still required so the
    // camera-only bridge gets coherent UVs and a single common camera pose.
    const ready=enoughUseful&&commonView&&geometryOk;
    const minUsefulViews=readyList.length?Math.min(...readyList.map(t=>t.roiViews?.length||0)):0;
    let blocker=null;
    if(selected<this.cfg.xrCalibrationMinTargets)blocker=`aggiungi ${this.cfg.xrCalibrationMinTargets-selected} pin`;
    else if(!enoughUseful)blocker=`muoviti attorno ai pin: ${readyTargets}/${this.cfg.xrCalibrationMinTargets} hanno viste sufficienti`;
    else if(!commonView)blocker=`riporta almeno ${this.cfg.xrCalibrationMinTargets} pin utili nella stessa inquadratura`;
    else if(!geometryOk)blocker='distribuisci i 3 pin formando un triangolo più ampio';
    return {selected,readyTargets,target:this.cfg.xrCalibrationMinTargets,maxTargets:this.cfg.xrCalibrationMaxTargets,totalPoints:points.length,
      commonVisibleTargets,commonVisibleReadyTargets:commonVisibleTargets,commonVisiblePoints,commonView,span,triangleAreaM2,screenTriangleArea,geometryOk,
      poseCount:this.globalPoses.length,requiredPoseCount:minGlobal,poseCoverageOk,poseCoverageRequiredForApply:false,minUsefulViews,blocker,
      applyTargetIds:commonReady.map(t=>t.id),realAnchorPoints:points.filter(p=>p.realAnchor).length,trackedAnchorPoints:points.filter(p=>p.tracked).length,ready,cameraSize:this.cameraSize,candidates:this.candidates.map(c=>({...c})),targets:this.targets.map(t=>({id:t.id,
      // app.js draws t.seedUv. Feed it the LIVE anchor projection once tracking
      // starts, and an off-screen value when tracking is lost.
      seedUv:t.state==='tracking'?(t.visible&&t.displayUv?[...t.displayUv]:[-2,-2]):[...t.seedUv],
      originalSeedUv:[...t.seedUv],state:t.state,points:t.points.length,views:t.views,baselineM:t.maxBaselineM,visible:t.visible,visiblePoints:t.visiblePoints,trackedPoints:t.points.filter(p=>p.tracked).length,roiViews:t.roiViews?.length||0,roiSectors:t.roiSectors?.length||0,ready:t.ready,trackingSource:t.state==='tracking'?'XRAnchor':'hit-test-acquisition'})),manualAim:{uv:[...(this.manualAim?.uv||[.5,.5])],valid:!!this.manualAim?.valid,stable:!!this.manualAim?.stable,point:this.manualAim?.point?[...this.manualAim.point]:null,depthM:this.manualAim?.depthM??null,rmsM:this.manualAim?.rmsM??null}};
  }

  _emitProgress(force=false){const now=performance.now();if(!force&&now-this._lastProgressAt<120)return this._quality();this._lastProgressAt=now;const detail=this._quality();this.dispatchEvent(new CustomEvent('progress',{detail}));if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('roomscan:xr-progress',{detail}));return detail;}

  async _frame(time,frame){
    if(!this._running)return;
    try{
      const viewerPose=frame.getViewerPose(this.refSpace);
      if(viewerPose?.views?.length){
        const view=viewerPose.views[0],camera=view.camera;
        if(camera){
          const K=projectionToIntrinsics(view.projectionMatrix,camera.width,camera.height);this.latestK=K;this.latestIntrinsics={fxN:K.fx/K.width,fyN:K.fy/K.height,cxN:K.cx/K.width,cyN:K.cy/K.height};this.cameraSize=[camera.width,camera.height];this.latestPose=xrPoseToSlam(view.transform);
          let texture=null;try{texture=this.binding.getCameraImage(camera);this._latestTexture=texture;}catch(err){this.log?.warn('xr-camera-texture-failed',{message:err.message});}
          this._ensureCenterAim();
          this._processManualAim(frame);
          for(const t of this.targets){if(t.state==='acquiring')this._processAcquiringTarget(t,frame,texture,K);else if(t.state==='tracking')this._processTrackingTarget(t,frame,texture,K);}
          this._captureGlobalPoseIfEligible();this._renderScenePins(frame,view);this._emitProgress(false);
        }
      }
    }catch(err){this.log?.error('xr-calibration-frame-error',{message:err.message,stack:err.stack});}
    if(this._running)this.session.requestAnimationFrame((t,f)=>this._frame(t,f));
  }

  quality(){return this._quality();}

  async finish(){
    const q=this._quality();
    if(!q.ready){
      if(q.selected<this.cfg.xrCalibrationMinTargets)throw new Error(`Aggiungi almeno ${this.cfg.xrCalibrationMinTargets} pin.`);
      if(q.readyTargets<this.cfg.xrCalibrationMinTargets)throw new Error(`Servono almeno ${this.cfg.xrCalibrationMinTargets} pin con viste utili. Ora sono pronti ${q.readyTargets}: fai piccoli spostamenti laterali attorno ai pin.`);
      if(!q.commonView)throw new Error(`Porta almeno ${this.cfg.xrCalibrationMinTargets} pin utili nella stessa inquadratura finale.`);
      throw new Error(`Distribuisci meglio almeno 3 pin: crea un triangolo visibile più ampio (span attuale ${q.span.toFixed(2)} m).`);
    }

    // Freeze exactly the useful pins visible in this common frame. Extra pins
    // that are incomplete or currently off-screen are ignored, never blockers.
    const applyTargets=this.targets.filter(t=>t.ready&&t.visible);
    const anchors=[];
    for(const t of applyTargets)for(const p of t.points){
      const vis=t.lastVisible.find(v=>v.point.id===p.id);if(!vis||!p.tracked)continue;
      anchors.push({id:p.id,objectId:t.id,p:[...p.p],seedUv:[...p.seedUv],uv:[...vis.uv],patch:vis.patch,patchSize:vis.patchSize,patchRel:vis.patchRel,variance:vis.variance,detail:vis.detail,hitStdM:p.hitStdM,realAnchor:true,persistentHandle:p.persistentHandle||null,observations:p.observations.map(o=>({...o,pose:o.pose?clonePose(o.pose):null}))});
    }
    if(anchors.length<this.cfg.xrCalibrationMinCommonPoints)throw new Error('Vista comune persa nell’ultimo frame: tieni almeno 3 pin utili visibili e riprova.');

    const result={format:'ROOMSCAN-V30-XR-CALIBRATION-2',createdAt:Date.now(),referenceSpace:'local-floor',coordinateConvention:'+X right +Y up +Z forward',mode:'user-selected-multiview-real-xranchors',realAnchors:true,anchors,objects:applyTargets.map(t=>({id:t.id,seedUv:[...t.seedUv],points:t.points.map(p=>p.id),views:t.views,baselineM:t.maxBaselineM,maxAngleRad:t.maxAngleRad,roiViews:(t.roiViews||[]).map(v=>({...v,pose:clonePose(v.pose),worldCenter:[...v.worldCenter],uv:[...v.uv],scales:v.scales.map(s=>({...s,patch:[...s.patch]}))})),roiSectors:[...(t.roiSectors||[])]})),pose:clonePose(this.latestPose),intrinsicsNorm:{...this.latestIntrinsics},cameraSize:[...this.cameraSize],commonView:{pose:clonePose(this.latestPose),intrinsicsNorm:{...this.latestIntrinsics},cameraSize:[...this.cameraSize],anchorIds:anchors.map(a=>a.id)},poseCoverage:this.globalPoses.map(s=>({at:s.at,pose:clonePose(s.pose),targetIds:[...s.targetIds],anchorPointIds:[...s.anchorPointIds]})),quality:{...q,appliedTargetIds:applyTargets.map(t=>t.id)}};
    this.log?.info('xr-calibration-real-anchor-finished',{anchors:anchors.length,persistent:anchors.filter(a=>a.persistentHandle).length,poseCount:q.poseCount,quality:q});
    await this.stop({deleteAnchors:false});
    return result;
  }

  async stop({deleteAnchors=true}={}){
    if(!this.session)return;
    try{this.manualAim?.source?.cancel?.();}catch{}
    for(const t of this.targets){for(const r of t.rays||[]){try{r.source?.cancel?.();}catch{}if(deleteAnchors)this._deleteAnchor(r.anchor);}if(deleteAnchors)for(const p of t.points||[])this._deleteAnchor(p.runtimeAnchor);}
    const s=this.session;this._running=false;this.session=null;
    try{await s.end();}catch{}
    if(typeof window!=='undefined'&&window.__ROOMSCAN_ACTIVE_CALIBRATOR===this)window.__ROOMSCAN_ACTIVE_CALIBRATOR=null;
  }
}
