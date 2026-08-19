import {qNormalize,qAngle,projectPoint} from '../slam/math.js';

/*
 * Room Scanner V30.8 - user-selected multi-view WebXR landmark calibration.
 *
 * Design goal
 * -----------
 * The V30.7 hand-off failed too often because it stored one tiny automatic
 * template for each generic hit-test ray. A template that is not deliberately
 * distinctive is difficult to re-detect after WebXR is closed and the normal
 * getUserMedia camera is opened.
 *
 * V30.8 changes the calibration contract:
 *   1. Raw Camera Access is sampled at a coarse grid to find visually rich,
 *      high-gradient candidate regions. This is NOT semantic object detection;
 *      it deliberately favours stable details such as corners, handles, plugs,
 *      picture-frame edges and furniture junctions.
 *   2. The user chooses the details to trust by tapping the highlighted
 *      candidates. Each user pin creates a small cluster of metric WebXR
 *      hit-test points around that detail instead of only one point.
 *   3. After the cluster has a stable metric position, the hit-test source is
 *      cancelled. The fixed 3D points are then reprojected into every following
 *      WebXR view and several appearance templates are collected from spatially
 *      separated camera poses.
 *   4. Calibration can finish only when every selected object has enough views
 *      AND all selected objects are visible together in one final common view.
 *      That final common view is what the camera-only bridge asks the user to
 *      reproduce immediately after WebXR ends.
 *
 * This makes the hand-off a well-conditioned metric PnP problem while keeping
 * WebXR completely outside the later camera-only SLAM/MVS loop.
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
 * V30's +Z-forward convention. The conversion is intentionally isolated here. */
function quatToMat(q){const {x,y,z,w}=q,xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];}
function matToQuat(m){const tr=m[0]+m[4]+m[8];let x,y,z,w;if(tr>0){const s=Math.sqrt(tr+1)*2;w=.25*s;x=(m[7]-m[5])/s;y=(m[2]-m[6])/s;z=(m[3]-m[1])/s;}else if(m[0]>m[4]&&m[0]>m[8]){const s=Math.sqrt(1+m[0]-m[4]-m[8])*2;w=(m[7]-m[5])/s;x=.25*s;y=(m[1]+m[3])/s;z=(m[2]+m[6])/s;}else if(m[4]>m[8]){const s=Math.sqrt(1+m[4]-m[0]-m[8])*2;w=(m[2]-m[6])/s;x=(m[1]+m[3])/s;y=.25*s;z=(m[5]+m[7])/s;}else{const s=Math.sqrt(1+m[8]-m[0]-m[4])*2;w=(m[3]-m[1])/s;x=(m[2]+m[6])/s;y=(m[5]+m[7])/s;z=.25*s;}return qNormalize([x,y,z,w]);}
export function xrPoseToSlam(transform){
  const p=transform.position,R=quatToMat(transform.orientation),S=[1,1,-1],M=new Array(9);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)M[r*3+c]=S[r]*R[r*3+c]*S[c];
  return {p:[p.x,p.y,-p.z],q:matToQuat(M)};
}
export const xrPointToSlam=p=>[p.x,p.y,-p.z];

function rayForUv(uv,K){
  // UV is top-left normalized view space. XRRay itself points down WebXR -Z.
  const px=uv[0]*K.width,py=(1-uv[1])*K.height;
  const x=(px-K.cx)/K.fx,y=(py-K.cy)/K.fy,z=-1,n=Math.hypot(x,y,z)||1;
  return new XRRay(new DOMPointReadOnly(0,0,0,1),new DOMPointReadOnly(x/n,y/n,z/n,0));
}
function stableStats(history){
  if(!history.length)return null;
  const c=[mean(history.map(p=>p[0])),mean(history.map(p=>p[1])),mean(history.map(p=>p[2]))];
  const rms=Math.sqrt(mean(history.map(p=>dist(p,c)**2)));
  return {p:c,rms};
}
function grayscalePatch(rgba,size,outSize){
  const out=new Uint8Array(outSize*outSize);let sum=0,sum2=0;
  for(let oy=0;oy<outSize;oy++)for(let ox=0;ox<outSize;ox++){
    const sx=clamp(Math.floor((ox+.5)*size/outSize),0,size-1),sy=clamp(Math.floor((oy+.5)*size/outSize),0,size-1);
    // readPixels is bottom-left; stored templates use the normal top-left image convention.
    const src=((size-1-sy)*size+sx)*4,v=(rgba[src]*77+rgba[src+1]*150+rgba[src+2]*29)>>8;
    out[oy*outSize+ox]=v;sum+=v;sum2+=v*v;
  }
  const n=out.length,m=sum/n,variance=Math.max(0,sum2/n-m*m);
  return {patch:out,variance};
}
function patchStats(a){let s=0,s2=0;for(const v of a){s+=v;s2+=v*v;}const n=a.length,m=s/n,sd=Math.sqrt(Math.max(1,s2/n-m*m));return {m,sd};}
function zncc(a,b){if(!a||!b||a.length!==b.length)return -1;const A=patchStats(a),B=patchStats(b);if(A.sd<3||B.sd<3)return -1;let n=0;for(let i=0;i<a.length;i++)n+=(a[i]-A.m)*(b[i]-B.m);return n/(a.length*A.sd*B.sd);}

/* Pure helper exported for regression tests. High score requires texture in
 * BOTH image directions, which suppresses blank walls and single long edges. */
export function patchDetailScore(patch,size=Math.round(Math.sqrt(patch.length))){
  if(!patch?.length||size<4)return 0;
  let gx2=0,gy2=0,corners=0;
  for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
    const i=y*size+x,gx=(patch[i+1]-patch[i-1])*.5,gy=(patch[i+size]-patch[i-size])*.5;
    gx2+=gx*gx;gy2+=gy*gy;corners+=Math.min(gx*gx,gy*gy);
  }
  const n=Math.max(1,(size-2)*(size-2));
  return Math.sqrt(Math.min(gx2,gy2)/n)+.45*Math.sqrt(corners/n);
}

export function projectSlamPointToUv(pose,p,K){
  const pr=projectPoint(pose,p,K);if(!pr)return null;
  return {u:pr.u/K.width,v:pr.v/K.height,z:pr.z,px:pr.u,py:pr.v};
}
function maxPoseBaseline(poses){let best=0;for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)best=Math.max(best,dist(poses[i].p,poses[j].p));return best;}
function maxPoseAngle(poses){let best=0;for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)best=Math.max(best,qAngle(poses[i].q,poses[j].q));return best;}
function clonePose(p){return {p:[...p.p],q:[...p.q]};}

export class XRMetricCalibrator extends EventTarget{
  constructor({overlayRoot,config,log}){
    super();this.root=overlayRoot;this.cfg=config;this.log=log;this.session=null;this.refSpace=null;this.viewerSpace=null;this.gl=null;this.binding=null;this.layer=null;this.latestPose=null;this.latestIntrinsics=null;this.latestK=null;this.cameraSize=null;this._running=false;this._fbo=null;this._endPromise=null;
    this.candidates=[];this.targets=[];this._targetSeq=0;this._lastCandidateScanAt=0;this._lastProgressAt=0;this._latestTexture=null;
  }
  async start(){
    if(!navigator.xr)throw new Error('WebXR non disponibile su questo browser');
    const supported=await navigator.xr.isSessionSupported('immersive-ar');if(!supported)throw new Error('immersive-ar non supportato');
    const opts={requiredFeatures:['local-floor','hit-test','camera-access','dom-overlay'],domOverlay:{root:this.root}};
    this.log?.info('xr-calibration-request',{requiredFeatures:opts.requiredFeatures,mode:'user-selected-multiview-landmarks'});
    this.session=await navigator.xr.requestSession('immersive-ar',opts);this._running=true;
    this.gl=document.createElement('canvas').getContext('webgl',{xrCompatible:true,alpha:true,preserveDrawingBuffer:false});if(!this.gl)throw new Error('WebGL XR context non disponibile');
    await this.gl.makeXRCompatible?.();this.binding=new XRWebGLBinding(this.session,this.gl);this.layer=new XRWebGLLayer(this.session,this.gl,{alpha:true,antialias:false});this.session.updateRenderState({baseLayer:this.layer});
    this.refSpace=await this.session.requestReferenceSpace('local-floor');this.viewerSpace=await this.session.requestReferenceSpace('viewer');this._fbo=this.gl.createFramebuffer();
    this._endPromise=new Promise(resolve=>this.session.addEventListener('end',()=>{this._running=false;resolve();this.dispatchEvent(new Event('ended'));},{once:true}));
    this.session.requestAnimationFrame((t,f)=>this._frame(t,f));this.log?.info('xr-calibration-started',{blendMode:this.session.environmentBlendMode});return this;
  }

  /* Read a small camera patch without downloading the full Raw Camera frame. */
  _cameraPatch(texture,uv,K,{fraction=this.cfg.xrCalibrationPatchFraction,outSize=this.cfg.xrCalibrationPatchSize}={}){
    const gl=this.gl,size=clamp(Math.round(Math.min(K.width,K.height)*fraction),28,96),x=Math.round(uv[0]*K.width-size/2),y=Math.round((1-uv[1])*K.height-size/2),x0=clamp(x,0,K.width-size),y0=clamp(y,0,K.height-size);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);throw new Error('camera texture framebuffer incomplete');}
    const rgba=new Uint8Array(size*size*4);gl.readPixels(x0,y0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,rgba);gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);
    const g=grayscalePatch(rgba,size,outSize);return {...g,patchRel:size/Math.min(K.width,K.height),detail:patchDetailScore(g.patch,outSize)};
  }

  /* Candidate discovery is intentionally lightweight: 20 small readbacks every
   * ~0.7 s, then non-maximum suppression. It identifies distinctive VISUAL
   * regions; the user decides which physical objects/details are trustworthy. */
  _refreshCandidates(texture,K,time){
    if(!texture||time-this._lastCandidateScanAt<this.cfg.xrCandidateRefreshMs||this.targets.length>=this.cfg.xrCalibrationMaxTargets)return;
    this._lastCandidateScanAt=time;const raw=[];
    const us=[.14,.32,.50,.68,.86],vs=[.13,.30,.47,.64];let index=0;
    for(const v of vs)for(const u of us){
      try{
        const p=this._cameraPatch(texture,[u,v],K,{fraction:this.cfg.xrCandidatePatchFraction,outSize:this.cfg.xrCandidatePatchSize});
        const score=p.detail+.025*Math.sqrt(p.variance);
        if(p.variance>=this.cfg.xrCandidateMinVariance&&p.detail>=this.cfg.xrCandidateMinDetail)raw.push({id:`c${index}`,uv:[u,v],score,variance:p.variance,detail:p.detail});
      }catch(err){this.log?.warn('xr-candidate-patch-failed',{message:err.message});break;}
      index++;
    }
    raw.sort((a,b)=>b.score-a.score);const out=[];
    for(const c of raw){
      const nearSelected=this.targets.some(t=>Math.hypot(t.seedUv[0]-c.uv[0],t.seedUv[1]-c.uv[1])<.11);
      if(nearSelected||out.some(o=>Math.hypot(o.uv[0]-c.uv[0],o.uv[1]-c.uv[1])<.13))continue;
      out.push(c);if(out.length>=this.cfg.xrCandidateMaxVisible)break;
    }
    this.candidates=out;this.log?.debug?.('xr-candidates-updated',{count:out.length,best:out[0]?.score||0});this._emitProgress(true);
  }

  /* Called by the DOM overlay when the user taps a highlighted candidate. */
  async pinNearestCandidate(uv){
    if(!this._running)throw new Error('Calibrazione WebXR non attiva');
    if(this.targets.some(t=>t.state==='acquiring'))throw new Error('Attendi un istante: sto fissando metricamente il pin appena selezionato.');
    if(this.targets.length>=this.cfg.xrCalibrationMaxTargets)throw new Error(`Massimo ${this.cfg.xrCalibrationMaxTargets} pin`);
    let best=null,bd=.095;for(const c of this.candidates){const d=Math.hypot(c.uv[0]-uv[0],c.uv[1]-uv[1]);if(d<bd){bd=d;best=c;}}
    // Manual fallback: if a highlighted candidate moved between refreshes, test
    // the tapped patch directly instead of forcing the user to wait for the
    // next candidate scan. Blank / low-detail regions are still rejected.
    if(!best&&this._latestTexture&&this.latestK){try{const p=this._cameraPatch(this._latestTexture,uv,this.latestK,{fraction:this.cfg.xrCandidatePatchFraction,outSize:this.cfg.xrCandidatePatchSize});if(p.variance>=this.cfg.xrCandidateMinVariance&&p.detail>=this.cfg.xrCandidateMinDetail)best={id:'manual',uv:[...uv],score:p.detail+.025*Math.sqrt(p.variance),variance:p.variance,detail:p.detail};}catch{}}
    if(!best)throw new Error('Seleziona un dettaglio evidenziato, con bordi/texture chiari e non una parete uniforme.');
    return this.pinCandidate(best);
  }
  async pinCandidate(candidate){
    const id=`obj${++this._targetSeq}`,offset=this.cfg.xrCalibrationClusterOffsetUv;
    const offsets=[[0,0],[-offset,0],[offset,0],[0,-offset],[0,offset]],rays=[];
    for(let i=0;i<offsets.length;i++){
      const uv=[clamp(candidate.uv[0]+offsets[i][0],.04,.96),clamp(candidate.uv[1]+offsets[i][1],.04,.86)];
      try{const source=await this.session.requestHitTestSource({space:this.viewerSpace,offsetRay:rayForUv(uv,this.latestK)});rays.push({id:`${id}:p${i}`,uv,source,history:[],resolved:null});}
      catch(err){this.log?.warn('xr-selected-hit-source-failed',{id,i,message:err.message});}
    }
    if(rays.length<this.cfg.xrCalibrationMinPointsPerTarget){for(const r of rays)try{r.source.cancel?.();}catch{}throw new Error('ARCore non fornisce abbastanza hit-test su questo dettaglio');}
    const target={id,seedUv:[...candidate.uv],candidateScore:candidate.score,state:'acquiring',createdAt:Date.now(),rays,points:[],viewPoses:[],views:0,maxBaselineM:0,maxAngleRad:0,visible:false,visiblePoints:0,lastVisible:[],ready:false};
    this.targets.push(target);this.candidates=this.candidates.filter(c=>c.id!==candidate.id);this.log?.info('xr-user-target-pinned',{id,uv:target.seedUv,rays:rays.length,score:candidate.score});this._emitProgress(true);return id;
  }
  undoLastTarget(){
    const t=this.targets.pop();if(!t)return false;for(const r of t.rays||[])try{r.source?.cancel?.();}catch{}this.log?.info('xr-user-target-removed',{id:t.id});this._emitProgress(true);return true;
  }

  _processAcquiringTarget(target,frame,texture,K){
    for(const ray of target.rays){
      if(ray.resolved)continue;const hits=frame.getHitTestResults(ray.source);if(!hits.length)continue;const hp=hits[0].getPose(this.refSpace);if(!hp)continue;
      const p=xrPointToSlam(hp.transform.position);ray.history.push(p);while(ray.history.length>this.cfg.xrCalibrationStableFrames)ray.history.shift();if(ray.history.length<this.cfg.xrCalibrationStableFrames)continue;
      const s=stableStats(ray.history);if(!s||s.rms>this.cfg.xrCalibrationHitStdM)continue;let patch=null;try{if(texture)patch=this._cameraPatch(texture,ray.uv,K);}catch(err){this.log?.warn('xr-selected-patch-read-failed',{id:ray.id,message:err.message});}
      if(!patch||patch.variance<this.cfg.xrCalibrationMinPatchVariance||patch.detail<this.cfg.xrCalibrationMinPatchDetail)continue;
      ray.resolved={id:ray.id,objectId:target.id,p:s.p,seedUv:[...ray.uv],hitStdM:s.rms,reference:{uv:[...ray.uv],patch:Array.from(patch.patch),patchSize:this.cfg.xrCalibrationPatchSize,patchRel:patch.patchRel,variance:patch.variance,detail:patch.detail},observations:[]};
      this.log?.info('xr-target-point-acquired',{objectId:target.id,id:ray.id,p:s.p,hitStdM:s.rms,variance:patch.variance,detail:patch.detail});
    }
    const resolved=target.rays.map(r=>r.resolved).filter(Boolean);
    if(resolved.length>=this.cfg.xrCalibrationMinPointsPerTarget){
      target.points=resolved;target.state='tracking';for(const r of target.rays)try{r.source.cancel?.();}catch{}target.rays=[];
      this.log?.info('xr-target-metric-ready',{id:target.id,points:resolved.length});this._emitProgress(true);
    }
  }

  _pointVisible(point,texture,K){
    const pr=projectSlamPointToUv(this.latestPose,point.p,K);if(!pr||pr.u<.045||pr.u>.955||pr.v<.045||pr.v>.84)return null;
    let p;try{p=this._cameraPatch(texture,[pr.u,pr.v],K);}catch{return null;}
    const templates=[point.reference,...point.observations.slice(-3)],patch=p.patch;let score=-1;
    for(const t of templates){const s=zncc(Uint8Array.from(t.patch),patch);if(s>score)score=s;}
    if(score<this.cfg.xrCalibrationTrackingZncc)return null;
    return {id:point.id,uv:[pr.u,pr.v],patch:Array.from(patch),patchSize:this.cfg.xrCalibrationPatchSize,patchRel:p.patchRel,variance:p.variance,detail:p.detail,score};
  }
  _processTrackingTarget(target,texture,K){
    const visible=[];for(const p of target.points){const v=this._pointVisible(p,texture,K);if(v)visible.push({point:p,...v});}
    target.visiblePoints=visible.length;target.visible=visible.length>=this.cfg.xrCalibrationMinPointsPerTarget;target.lastVisible=visible;
    if(!target.visible)return;
    const pose=this.latestPose,poses=target.viewPoses,farEnough=!poses.length||dist(poses[poses.length-1].p,pose.p)>=this.cfg.xrCalibrationViewStepM||qAngle(poses[poses.length-1].q,pose.q)>=this.cfg.xrCalibrationViewStepAngleRad;
    if(farEnough&&poses.length<this.cfg.xrCalibrationMaxViewsPerTarget){
      target.viewPoses.push(clonePose(pose));target.views=target.viewPoses.length;target.maxBaselineM=maxPoseBaseline(target.viewPoses);target.maxAngleRad=maxPoseAngle(target.viewPoses);
      for(const v of visible){const arr=v.point.observations;arr.push({uv:v.uv,patch:v.patch,patchSize:v.patchSize,patchRel:v.patchRel,variance:v.variance,detail:v.detail,score:v.score,pose:clonePose(pose)});while(arr.length>this.cfg.xrCalibrationMaxTemplatesPerPoint)arr.shift();}
      this.log?.info('xr-target-view-added',{id:target.id,view:target.views,visiblePoints:visible.length,baselineM:target.maxBaselineM,angleRad:target.maxAngleRad});
    }
    target.ready=target.points.length>=this.cfg.xrCalibrationMinPointsPerTarget&&target.views>=this.cfg.xrCalibrationMinViewsPerTarget&&target.maxBaselineM>=this.cfg.xrCalibrationMinTargetBaselineM;
  }

  _quality(){
    const selected=this.targets.length,readyTargets=this.targets.filter(t=>t.ready).length,commonVisibleTargets=this.targets.filter(t=>t.ready&&t.visible).length,commonVisiblePoints=this.targets.reduce((s,t)=>s+(t.ready?t.visiblePoints:0),0),points=this.targets.flatMap(t=>t.points||[]),xs=points.map(a=>a.p[0]),ys=points.map(a=>a.p[1]),zs=points.map(a=>a.p[2]);
    const span=points.length?Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs)):0,vertical=points.length?Math.max(...ys)-Math.min(...ys):0;
    const allReady=selected>=this.cfg.xrCalibrationMinTargets&&readyTargets===selected;
    const commonView=allReady&&commonVisibleTargets===selected&&commonVisiblePoints>=this.cfg.xrCalibrationMinCommonPoints;
    const geometryOk=span>=this.cfg.xrCalibrationMinSpanM&&vertical>=this.cfg.xrCalibrationMinVerticalSpanM;
    const ready=commonView&&geometryOk;
    return {selected,readyTargets,target:this.cfg.xrCalibrationMinTargets,maxTargets:this.cfg.xrCalibrationMaxTargets,totalPoints:points.length,commonVisibleTargets,commonVisiblePoints,commonView,span,vertical,geometryOk,ready,cameraSize:this.cameraSize,candidates:this.candidates.map(c=>({...c})),targets:this.targets.map(t=>({id:t.id,seedUv:t.seedUv,state:t.state,points:t.points.length,views:t.views,baselineM:t.maxBaselineM,visible:t.visible,visiblePoints:t.visiblePoints,ready:t.ready}))};
  }
  _emitProgress(force=false){const now=performance.now();if(!force&&now-this._lastProgressAt<120)return this._quality();this._lastProgressAt=now;const detail=this._quality();this.dispatchEvent(new CustomEvent('progress',{detail}));return detail;}

  async _frame(time,frame){
    if(!this._running)return;try{
      const pose=frame.getViewerPose(this.refSpace);if(pose?.views?.length){const view=pose.views[0],camera=view.camera;if(camera){
        const K=projectionToIntrinsics(view.projectionMatrix,camera.width,camera.height);this.latestK=K;this.latestIntrinsics={fxN:K.fx/K.width,fyN:K.fy/K.height,cxN:K.cx/K.width,cyN:K.cy/K.height};this.cameraSize=[camera.width,camera.height];this.latestPose=xrPoseToSlam(view.transform);
        let texture=null;try{texture=this.binding.getCameraImage(camera);this._latestTexture=texture;}catch(err){this.log?.warn('xr-camera-texture-failed',{message:err.message});}
        this._refreshCandidates(texture,K,time);
        for(const t of this.targets){if(t.state==='acquiring')this._processAcquiringTarget(t,frame,texture,K);else if(t.state==='tracking')this._processTrackingTarget(t,texture,K);}
        this._emitProgress(false);
      }}
    }catch(err){this.log?.error('xr-calibration-frame-error',{message:err.message,stack:err.stack});}
    if(this._running)this.session.requestAnimationFrame((t,f)=>this._frame(t,f));
  }

  quality(){return this._quality();}
  async finish(){
    const q=this._quality();
    if(!q.ready){
      if(q.selected<this.cfg.xrCalibrationMinTargets)throw new Error(`Seleziona almeno ${this.cfg.xrCalibrationMinTargets} oggetti/dettagli distinti.`);
      if(q.readyTargets<q.selected)throw new Error('Osserva ogni pin da più posizioni: tutti devono raggiungere almeno 3 viste con parallasse.');
      if(!q.commonView)throw new Error('Porta TUTTI i pin nella stessa inquadratura finale e mantieni il telefono fermo un istante.');
      throw new Error(`Distribuisci meglio i pin nello spazio: span ${q.span.toFixed(2)} m, verticale ${q.vertical.toFixed(2)} m.`);
    }
    const anchors=[];for(const t of this.targets){for(const p of t.points){const vis=t.lastVisible.find(v=>v.point.id===p.id);if(!vis)continue;anchors.push({id:p.id,objectId:t.id,p:p.p,seedUv:p.seedUv,uv:vis.uv,patch:vis.patch,patchSize:vis.patchSize,patchRel:vis.patchRel,variance:vis.variance,detail:vis.detail,hitStdM:p.hitStdM,observations:p.observations.map(o=>({...o,pose:o.pose?clonePose(o.pose):null}))});}}
    if(anchors.length<this.cfg.xrCalibrationMinCommonPoints)throw new Error('Vista comune persa nell’ultimo frame: tieni tutti i pin visibili e riprova.');
    const result={format:'ROOMSCAN-V30-XR-CALIBRATION-2',createdAt:Date.now(),referenceSpace:'local-floor',coordinateConvention:'+X right +Y up +Z forward',mode:'user-selected-multiview-landmarks',anchors,objects:this.targets.map(t=>({id:t.id,seedUv:t.seedUv,points:t.points.map(p=>p.id),views:t.views,baselineM:t.maxBaselineM,maxAngleRad:t.maxAngleRad})),pose:clonePose(this.latestPose),intrinsicsNorm:this.latestIntrinsics,cameraSize:this.cameraSize,commonView:{pose:clonePose(this.latestPose),intrinsicsNorm:this.latestIntrinsics,cameraSize:this.cameraSize,anchorIds:anchors.map(a=>a.id)},quality:q};
    this.log?.info('xr-calibration-common-view-captured',{objects:result.objects.length,anchors:anchors.length,commonVisiblePoints:q.commonVisiblePoints,span:q.span,vertical:q.vertical});await this.stop();return result;
  }
  async stop(){if(this.session){try{await this.session.end();}catch{}}await this._endPromise?.catch(()=>{});for(const t of this.targets)for(const r of t.rays||[])try{r.source?.cancel?.();}catch{}}
}
