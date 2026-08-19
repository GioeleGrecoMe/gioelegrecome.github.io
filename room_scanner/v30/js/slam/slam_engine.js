import {backproject,cameraToWorld,intrinsicsFromSize,median,optimizePosePnP,poseClone,poseIdentity,qAngle} from './math.js';
import {calibrateDepthFromAnchors,estimateFloorScale,metricDepth} from '../depth/depth_calibration.js';

/*
 * Keyframe/landmark SLAM orchestrator.
 * Heavy feature extraction and descriptor matching are WASM. This layer keeps
 * long-lived track IDs, metric landmarks, poses, and diagnostic quality.
 */
export class SlamEngine{
 constructor(frontend,{cameraHeightM=1.35,fovDeg=62,keyframeIntervalMs=900,minMetricConfidence=.30,relativeReferenceDepthL=1}={}){this.frontend=frontend;this.cameraHeightM=cameraHeightM;this.fovDeg=fovDeg;this.keyframeIntervalMs=keyframeIntervalMs;this.minMetricConfidence=minMetricConfidence;this.relativeReferenceDepthL=relativeReferenceDepthL;this.reset();}
 reset(){this.pose=poseIdentity();this.prevPose=poseIdentity();this.prevTrackIds=[];this.nextTrackId=1;this.landmarks=new Map();this.frameSeq=0;this.keyframes=[];this.lastKeyframeAt=-Infinity;this.lastKeyframePose=poseIdentity();this.metricCalibration=null;this.relativeCalibration=null;this.mapCalibration=null;this.status='BOOT';this.lastQuality={features:0,matches:0,landmarks:0,inliers:0,rmse:Infinity};this.markpoints=[];this.loopClosures=[];this.currentTracks=null;this.frontend?.reset?.();}
 processAnalysis(frame,{motionScore=0}={}){
  const feat=this.frontend.process(frame.gray,frame.width,frame.height,{maxFeatures:900,threshold:17});const K=intrinsicsFromSize(frame.width,frame.height,this.fovDeg),trackIds=Array(feat.count);for(let i=0;i<feat.count;i++)trackIds[i]=this.nextTrackId++;
  const flows=[];for(let m=0;m<feat.matches.count;m++){const ci=feat.matches.curr[m],pi=feat.matches.prev[m];if(pi>=0&&pi<this.prevTrackIds.length){trackIds[ci]=this.prevTrackIds[pi];flows.push([feat.xs[ci],feat.ys[ci],pi]);}}
  const corr=[];for(let i=0;i<feat.count;i++){const lm=this.landmarks.get(trackIds[i]);if(lm)corr.push({world:lm.p,u:feat.xs[i],v:feat.ys[i],trackId:trackIds[i]});}
  this.prevPose=poseClone(this.pose);let solve={pose:this.pose,inliers:0,rmse:Infinity,ok:false};if(corr.length>=10)solve=this.frontend.optimizePose?.(this.pose,corr,K,{iterations:5,maxPoints:180})||optimizePosePnP(this.pose,corr,K,{iterations:5,maxPoints:140});
  if(this._acceptPose(solve))this.pose=solve.pose;else if(feat.matches.count>=20){/* Fallback: tiny rotational visual odometry only. Translation waits for metric landmarks. */const dx=[],dy=[];for(let m=0;m<feat.matches.count;m++){const ci=feat.matches.curr[m],pi=feat.matches.prev[m];const prev=this._prevFeatureXY?.[pi];if(prev){dx.push(feat.xs[ci]-prev[0]);dy.push(feat.ys[ci]-prev[1]);}}if(dx.length){const yaw=-median(dx)/K.fx*.22,pitch=median(dy)/K.fy*.22;const inc={p:[0,0,0],q:[-pitch/2,yaw/2,0,1]};this.pose.q=[this.pose.q[0]+inc.q[0],this.pose.q[1]+inc.q[1],this.pose.q[2],this.pose.q[3]];const n=Math.hypot(...this.pose.q)||1;this.pose.q=this.pose.q.map(v=>v/n);}}
  const flowMag=this._flowMagnitude(feat);
  this._prevFeatureXY=Array.from({length:feat.count},(_,i)=>[feat.xs[i],feat.ys[i]]);this.prevTrackIds=trackIds;this.frameSeq++;
  const angle=qAngle(this.pose.q,this.lastKeyframePose.q),trans=Math.hypot(this.pose.p[0]-this.lastKeyframePose.p[0],this.pose.p[1]-this.lastKeyframePose.p[1],this.pose.p[2]-this.lastKeyframePose.p[2]);
  const due=frame.timestamp-this.lastKeyframeAt>=this.keyframeIntervalMs&&(this.keyframes.length===0||trans>.12||angle>.12||flowMag>3.2||motionScore>.7);
  this.lastQuality={features:feat.count,matches:feat.matches.count,landmarks:corr.length,inliers:solve.inliers,rmse:solve.rmse,flowPx:flowMag,metric:!!this.metricCalibration};
  this.currentTracks={K,trackIds,xs:feat.xs,ys:feat.ys,descriptors:feat.descriptors,descriptorBytes:feat.descriptorBytes};
  return {pose:poseClone(this.pose),K,features:feat,trackIds,keyframeDue:due,quality:this.lastQuality};
 }
 _flowMagnitude(feat){const vals=[];for(let m=0;m<feat.matches.count;m++){const ci=feat.matches.curr[m],pi=feat.matches.prev[m],p=this._prevFeatureXY?.[pi];if(p)vals.push(Math.hypot(feat.xs[ci]-p[0],feat.ys[ci]-p[1]));}return vals.length?median(vals):0;}
 _acceptPose(solve){if(!solve?.ok||solve.inliers<10||!Number.isFinite(solve.rmse)||solve.rmse>5.5)return false;const p=solve.pose?.p,q=solve.pose?.q;if(!p?.every(Number.isFinite)||!q?.every(Number.isFinite))return false;return Math.hypot(p[0]-this.pose.p[0],p[1]-this.pose.p[1],p[2]-this.pose.p[2])<.8&&qAngle(q,this.pose.q)<.7;}
 createKeyframeSnapshot(analysis,cameraFrame){const kf={id:`kf-${crypto.randomUUID()}`,seq:this.keyframes.length,t:cameraFrame.timestamp,pose:poseClone(analysis.pose),K:{...analysis.K},analysisWidth:analysis.K.width,analysisHeight:analysis.K.height,imageWidth:cameraFrame.width,imageHeight:cameraFrame.height,trackIds:[...analysis.trackIds],featureX:Array.from(analysis.features.xs),featureY:Array.from(analysis.features.ys),featureScore:Array.from(analysis.features.scores),descriptors:analysis.features.descriptors,descriptorBytes:analysis.features.descriptorBytes,signature:this._descriptorSignature(analysis.features.descriptors,analysis.features.descriptorBytes),blob:cameraFrame.blob,depth:null,depthCalibration:null};const loop=this._tryLoopClosure(kf);if(loop?.ok){kf.pose=poseClone(loop.pose);this.pose=poseClone(loop.pose);this.loopClosures.push({from:kf.id,to:loop.candidateId,inliers:loop.inliers,rmse:loop.rmse,t:Date.now()});}this.keyframes.push(kf);this.lastKeyframeAt=cameraFrame.timestamp;this.lastKeyframePose=poseClone(kf.pose);return kf;}
 integrateDepth(kf,result){
  const {depth,width,height}=result;const poseRefinement=this._refineKeyframePose(kf);let cal=null;const anchors=[];for(let i=0;i<kf.trackIds.length;i++){const lm=this.landmarks.get(kf.trackIds[i]);if(!lm)continue;const pc=this._worldToCamera(kf.pose,lm.p);if(pc[2]<=.05)continue;anchors.push({u:kf.featureX[i]/kf.analysisWidth,v:kf.featureY[i]/kf.analysisHeight,z:pc[2]});}
  if(anchors.length>=6)cal=calibrateDepthFromAnchors(depth,width,height,anchors);
  if(!cal){const Kimage={...kf.K,width:kf.imageWidth,height:kf.imageHeight,fx:kf.K.fx*kf.imageWidth/kf.analysisWidth,fy:kf.K.fy*kf.imageHeight/kf.analysisHeight,cx:kf.imageWidth/2,cy:kf.imageHeight/2};cal=estimateFloorScale(depth,width,height,Kimage,this.cameraHeightM);if(cal)cal.source='floor-height';}
  if(!cal&&this.metricCalibration)cal={...this.metricCalibration,confidence:this.metricCalibration.confidence*.95,source:'carry'};
  if(!cal){const finite=[];for(let i=0;i<depth.length;i+=17)if(Number.isFinite(depth[i])&&depth[i]>1e-6)finite.push(depth[i]);const med=median(finite)||1;cal={mode:'direct',a:1/med,b:0,confidence:.08,source:'nominal-unscaled'};}
  /* A monocular network gives relative depth even where camera height / floor
   * fitting is unreliable. Do not discard that geometry: normalize it to a
   * stable map unit L, then use depth-backed tracks for visual PnP. */
  const metricAllowed=cal.confidence>=this.minMetricConfidence&&cal.source!=='nominal-unscaled';
  if(metricAllowed){this.metricCalibration={mode:cal.mode,a:cal.a,b:cal.b,confidence:cal.confidence,source:cal.source};cal={...cal,relative:false,scaleKind:'metric'};}
  else cal=this._relativeCalibration(depth,width,height,cal,anchors);
  this.mapCalibration=cal;kf.depth={width,height,data:depth};kf.depthCalibration=cal;const mappingAllowed=true;
  /* Attach 3D landmarks to tracked visual features. Once attached they let the
   * next frames estimate metric 6-DoF with reprojection PnP. */
  let added=0;for(let i=0;i<kf.trackIds.length;i++){const u=kf.featureX[i]/kf.analysisWidth*width,v=kf.featureY[i]/kf.analysisHeight*height,x=Math.max(0,Math.min(width-1,Math.round(u))),y=Math.max(0,Math.min(height-1,Math.round(v))),raw=depth[y*width+x],z=metricDepth(raw,cal);if(!Number.isFinite(z)||z<.03||z>16)continue;const Kd={fx:kf.K.fx*width/kf.analysisWidth,fy:kf.K.fy*height/kf.analysisHeight,cx:width/2,cy:height/2,width,height},pc=backproject(u,v,z,Kd),pw=cameraToWorld(kf.pose,pc),id=kf.trackIds[i],old=this.landmarks.get(id);if(old){old.p=[old.p[0]*.7+pw[0]*.3,old.p[1]*.7+pw[1]*.3,old.p[2]*.7+pw[2]*.3];old.views++;}else{this.landmarks.set(id,{id,p:pw,views:1,firstKf:kf.id});added++;}}
  for(const mark of this.markpoints){if(mark.p)continue;const lm=this.landmarks.get(mark.trackId);if(lm){mark.p=[...lm.p];mark.views=lm.views;mark.kind=cal.relative?'relative-L':'metric';}}
  return {calibration:cal,landmarksAdded:added,totalLandmarks:this.landmarks.size,mappingAllowed,relative:!!cal.relative,scaleKind:cal.scaleKind,poseRefinement};
 }

 _refineKeyframePose(kf){
  const corr=[];for(let i=0;i<kf.trackIds.length;i++){const lm=this.landmarks.get(kf.trackIds[i]);if(lm)corr.push({world:lm.p,u:kf.featureX[i],v:kf.featureY[i],trackId:kf.trackIds[i]});}
  if(corr.length<10||!this.frontend?.optimizePose)return {ok:false,reason:corr.length<10?'few-landmarks':'pnp-unavailable',matches:corr.length};
  const r=this.frontend.optimizePose(kf.pose,corr,kf.K,{iterations:9,maxPoints:220});const jump=r?.pose?.p?Math.hypot(r.pose.p[0]-kf.pose.p[0],r.pose.p[1]-kf.pose.p[1],r.pose.p[2]-kf.pose.p[2]):Infinity;
  if(!r?.ok||r.inliers<10||!Number.isFinite(r.rmse)||r.rmse>5||jump>2.5)return {ok:false,reason:'pnp-rejected',matches:corr.length,inliers:r?.inliers||0,rmse:r?.rmse};
  kf.pose=poseClone(r.pose);this.pose=poseClone(r.pose);return {ok:true,matches:corr.length,inliers:r.inliers,rmse:r.rmse};
 }

 _relativeCalibration(depth,width,height,suggested,anchors){
  const mode=suggested?.mode==='inverse'?'inverse':'direct';
  /* Once landmarks exist, their depth is in L too: anchor fitting compensates
   * frame-to-frame monocular-depth drift without claiming metric accuracy. */
  let fitted=null;if(anchors.length>=6)fitted=calibrateDepthFromAnchors(depth,width,height,anchors);
  if(fitted&&fitted.a>0&&Number.isFinite(fitted.a))this.relativeCalibration={...fitted,source:'relative-anchors-L',confidence:1,relative:true,scaleKind:'relative-L',referenceDepthL:this.relativeReferenceDepthL};
  if(!this.relativeCalibration){const values=[];for(let i=0;i<depth.length;i+=17){const raw=depth[i],value=mode==='inverse'?1/Math.max(1e-6,raw):raw;if(Number.isFinite(value)&&value>1e-6)values.push(value);}const med=median(values)||1;this.relativeCalibration={mode,a:this.relativeReferenceDepthL/med,b:0,confidence:1,source:'relative-L-normalized',relative:true,scaleKind:'relative-L',referenceDepthL:this.relativeReferenceDepthL};}
  return {...this.relativeCalibration};
 }

 _descriptorSignature(desc,db=16){const n=Math.floor(desc.length/db),sig=new Uint8Array(db);if(!n)return sig;for(let b=0;b<db;b++){for(let bit=0;bit<8;bit++){let ones=0;for(let i=0;i<n;i++)ones+=(desc[i*db+b]>>bit)&1;if(ones*2>=n)sig[b]|=1<<bit;}}return sig;}
 _sigDistance(a,b){let d=0;for(let i=0;i<Math.min(a.length,b.length);i++){let v=a[i]^b[i];while(v){v&=v-1;d++;}}return d;}
 _tryLoopClosure(kf){if(kf.seq<10)return null;const candidates=this.keyframes.filter(x=>kf.seq-x.seq>=8&&x.signature&&this._sigDistance(kf.signature,x.signature)<=48).sort((a,b)=>this._sigDistance(kf.signature,a.signature)-this._sigDistance(kf.signature,b.signature)).slice(0,3);for(const old of candidates){const corr=this._matchKeyframesToLandmarks(kf,old);if(corr.length<14)continue;const r=this.frontend.optimizePose?.(kf.pose,corr,kf.K,{iterations:6,maxPoints:180})||optimizePosePnP(kf.pose,corr,kf.K,{iterations:6,maxPoints:140});if(r?.ok&&r.inliers>=14&&r.rmse<5.5)return {...r,candidateId:old.id};}return null;}
 _matchKeyframesToLandmarks(cur,old){const db=cur.descriptorBytes||16,ci=[...cur.trackIds.keys()].sort((a,b)=>(cur.featureScore[b]||0)-(cur.featureScore[a]||0)).slice(0,180),oi=[...old.trackIds.keys()].filter(i=>this.landmarks.has(old.trackIds[i])).sort((a,b)=>(old.featureScore?.[b]||0)-(old.featureScore?.[a]||0)).slice(0,220),out=[];for(const i of ci){let best=999,second=999,bj=-1;const co=i*db;for(const j of oi){const oo=j*db;let d=0;for(let k=0;k<db;k++){let v=cur.descriptors[co+k]^old.descriptors[oo+k];while(v){v&=v-1;d++;}}if(d<best){second=best;best=d;bj=j;}else if(d<second)second=d;}if(bj>=0&&best<50&&best*100<second*82){const lm=this.landmarks.get(old.trackIds[bj]);if(lm)out.push({world:lm.p,u:cur.featureX[i],v:cur.featureY[i]});}}return out;}

 _worldToCamera(T,pw){const q=[-T.q[0],-T.q[1],-T.q[2],T.q[3]],d=[pw[0]-T.p[0],pw[1]-T.p[1],pw[2]-T.p[2]];const x=q[0],y=q[1],z=q[2],w=q[3],tx=2*(y*d[2]-z*d[1]),ty=2*(z*d[0]-x*d[2]),tz=2*(x*d[1]-y*d[0]);return [d[0]+w*tx+(y*tz-z*ty),d[1]+w*ty+(z*tx-x*tz),d[2]+w*tz+(x*ty-y*tx)];}

 pinCenter(){
  const c=this.currentTracks;if(!c?.trackIds?.length)return {ok:false,reason:'no-tracks'};let best=-1,bd=Infinity;for(let i=0;i<c.trackIds.length;i++){const d=Math.hypot(c.xs[i]-c.K.cx,c.ys[i]-c.K.cy);if(d<bd){bd=d;best=i;}}if(best<0)return {ok:false,reason:'no-track'};const trackId=c.trackIds[best],lm=this.landmarks.get(trackId),descriptor=c.descriptors?.slice(best*c.descriptorBytes,(best+1)*c.descriptorBytes),relative=!!this.mapCalibration?.relative;const mark={id:`mark-${crypto.randomUUID()}`,trackId,createdAt:Date.now(),views:lm?.views||0,pixel:{u:c.xs[best]/c.K.width,v:c.ys[best]/c.K.height},pose:poseClone(this.pose),descriptor:descriptor?Array.from(descriptor):null,descriptorBytes:c.descriptorBytes||0};if(lm){mark.kind=relative?'relative-L':'metric';mark.p=[...lm.p];}else mark.kind='visual-pending-depth';this.markpoints.push(mark);return {ok:true,mark,metric:!!lm&&!relative};
 }
 diagnostics(){return {frameSeq:this.frameSeq,pose:poseClone(this.pose),landmarks:this.landmarks.size,keyframes:this.keyframes.length,markpoints:this.markpoints,loopClosures:this.loopClosures,metricCalibration:this.metricCalibration,relativeCalibration:this.relativeCalibration,mapCalibration:this.mapCalibration,lastQuality:this.lastQuality};}
}
