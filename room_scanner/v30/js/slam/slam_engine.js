import {intrinsicsFromSize,poseClone,poseIdentity,qAngle,median,triangulateRays} from './math.js';

/*
 * V30.7 camera-only metric SLAM orchestrator.
 *
 * Metric scale is seeded exactly once by the WebXR visual bridge. Afterwards
 * every pose update is image based: WASM FAST/BRIEF correspondences + robust
 * 3D-to-2D PnP. New sparse landmarks are triangulated from tracked rays with
 * metric camera baselines. Semi-dense geometry is supplied separately by MVS.
 */
export class SlamEngine{
  constructor(frontend,{fovDeg=62,keyframeIntervalMs=950,intrinsicsNorm=null}={}){this.frontend=frontend;this.fovDeg=fovDeg;this.keyframeIntervalMs=keyframeIntervalMs;this.intrinsicsNorm=intrinsicsNorm;this.reset();}
  reset(){this.pose=poseIdentity();this.prevPose=poseIdentity();this.prevTrackIds=[];this.nextTrackId=1;this.landmarks=new Map();this.pending=new Map();this.frameSeq=0;this.keyframes=[];this.lastKeyframeAt=-Infinity;this.lastKeyframePose=poseIdentity();this.metricCalibration=null;this.status='BOOT';this.lastQuality={features:0,matches:0,landmarks:0,inliers:0,rmse:Infinity};this.markpoints=[];this.loopClosures=[];this.currentTracks=null;this._prevFeatureXY=null;this._trustedFrames=0;this.frontend?.reset?.();}
  _K(width,height){const n=this.intrinsicsNorm;if(n)return {fx:n.fxN*width,fy:n.fyN*height,cx:n.cxN*width,cy:n.cyN*height,width,height};return intrinsicsFromSize(width,height,this.fovDeg);}
  processAnalysis(frame){
    const feat=this.frontend.process(frame.gray,frame.width,frame.height,{maxFeatures:950,threshold:16}),K=this._K(frame.width,frame.height),trackIds=Array(feat.count);
    for(let i=0;i<feat.count;i++)trackIds[i]=this.nextTrackId++;
    for(let m=0;m<feat.matches.count;m++){const ci=feat.matches.curr[m],pi=feat.matches.prev[m];if(pi>=0&&pi<this.prevTrackIds.length)trackIds[ci]=this.prevTrackIds[pi];}
    const corr=[];for(let i=0;i<feat.count;i++){const lm=this.landmarks.get(trackIds[i]);if(lm)corr.push({world:lm.p,u:feat.xs[i],v:feat.ys[i],trackId:trackIds[i]});}
    this.prevPose=poseClone(this.pose);let solve={pose:this.pose,inliers:0,rmse:Infinity,ok:false};
    if(this.metricCalibration&&corr.length>=8)solve=this.frontend.optimizePose?.(this.pose,corr,K,{iterations:6,maxPoints:220,minInliers:Math.min(10,Math.max(8,corr.length-2))})||solve;
    if(solve.ok){this.pose=solve.pose;this._trustedFrames=Math.min(12,this._trustedFrames+1);}else if(this.metricCalibration){this._trustedFrames=Math.max(0,this._trustedFrames-1);}
    const flowMag=this._flowMagnitude(feat),trusted=!!this.metricCalibration&&(solve.ok||this._trustedFrames>0);
    if(trusted)this._triangulateTracks(feat,trackIds,K);
    this._prevFeatureXY=Array.from({length:feat.count},(_,i)=>[feat.xs[i],feat.ys[i]]);this.prevTrackIds=trackIds;this.frameSeq++;
    const angle=qAngle(this.pose.q,this.lastKeyframePose.q),trans=Math.hypot(this.pose.p[0]-this.lastKeyframePose.p[0],this.pose.p[1]-this.lastKeyframePose.p[1],this.pose.p[2]-this.lastKeyframePose.p[2]);
    const due=!!this.metricCalibration&&frame.timestamp-this.lastKeyframeAt>=this.keyframeIntervalMs&&(this.keyframes.length===0||trans>.10||angle>.10||flowMag>3.0);
    this.lastQuality={features:feat.count,matches:feat.matches.count,landmarks:corr.length,inliers:solve.inliers,rmse:solve.rmse,flowPx:flowMag,metric:!!this.metricCalibration,trusted,triangulated:this.landmarks.size};
    this.currentTracks={K,trackIds,xs:feat.xs,ys:feat.ys};
    return {pose:poseClone(this.pose),K,features:feat,trackIds,keyframeDue:due,quality:this.lastQuality};
  }
  seedMetricFromWebXR({pose,analysis,bindings,rmse=Infinity,inliers=0,calibrationId='webxr'}){
    this.pose=poseClone(pose);this.prevPose=poseClone(pose);this.lastKeyframePose=poseClone(pose);this._trustedFrames=5;let added=0;
    for(const b of bindings||[]){const old=this.landmarks.get(b.trackId);if(old){old.p=[...b.anchor.p];old.views=Math.max(2,old.views||1);old.source='webxr-anchor';}else{this.landmarks.set(b.trackId,{id:b.trackId,p:[...b.anchor.p],views:2,source:'webxr-anchor',firstKf:null});added++;}}
    this.metricCalibration={source:'webxr-visual-bridge',calibrationId,confidence:Math.max(.1,Math.min(1,(inliers/12)*Math.exp(-Math.max(0,rmse-1)/8))),inliers,rmse,createdAt:Date.now()};
    this.currentTracks={K:analysis.K,trackIds:analysis.trackIds,xs:analysis.features.xs,ys:analysis.features.ys};return {added,total:this.landmarks.size,metricCalibration:this.metricCalibration};
  }
  _triangulateTracks(feat,trackIds,K){
    const visible=new Set();for(let i=0;i<feat.count;i++){const id=trackIds[i];visible.add(id);const lm=this.landmarks.get(id);if(lm){lm.views=(lm.lastFrame===this.frameSeq)?lm.views:(lm.views||1)+1;lm.lastFrame=this.frameSeq;continue;}const obs={pose:poseClone(this.pose),K:{...K},u:feat.xs[i],v:feat.ys[i],frameSeq:this.frameSeq};const first=this.pending.get(id);if(!first){this.pending.set(id,obs);continue;}if(this.frameSeq-first.frameSeq<2)continue;const baseline=Math.hypot(this.pose.p[0]-first.pose.p[0],this.pose.p[1]-first.pose.p[1],this.pose.p[2]-first.pose.p[2]);if(baseline<.055)continue;const t=triangulateRays(first,obs,{minAngleRad:.012,maxGapM:.10,minDepthM:.16,maxDepthM:14});if(t.ok){this.landmarks.set(id,{id,p:t.p,views:2,source:'triangulated',firstFrame:first.frameSeq,lastFrame:this.frameSeq,angle:t.angle,gap:t.gap});this.pending.delete(id);}else if(this.frameSeq-first.frameSeq>45)this.pending.set(id,obs);}
    if(this.pending.size>5000){const a=[...this.pending.entries()].sort((x,y)=>y[1].frameSeq-x[1].frameSeq).slice(0,3800);this.pending=new Map(a);}
  }
  _flowMagnitude(feat){const vals=[];for(let m=0;m<feat.matches.count;m++){const ci=feat.matches.curr[m],pi=feat.matches.prev[m],p=this._prevFeatureXY?.[pi];if(p)vals.push(Math.hypot(feat.xs[ci]-p[0],feat.ys[ci]-p[1]));}return vals.length?median(vals):0;}
  createKeyframeSnapshot(analysis,cameraFrame,{analysisGray=null,analysisRgb=null}={}){
    const kf={id:`kf-${crypto.randomUUID()}`,seq:this.keyframes.length,t:cameraFrame.timestamp,pose:poseClone(analysis.pose),K:{...analysis.K},analysisWidth:analysis.K.width,analysisHeight:analysis.K.height,imageWidth:cameraFrame.width,imageHeight:cameraFrame.height,trackIds:[...analysis.trackIds],featureX:Array.from(analysis.features.xs),featureY:Array.from(analysis.features.ys),featureScore:Array.from(analysis.features.scores),descriptors:analysis.features.descriptors.slice(),descriptorBytes:analysis.features.descriptorBytes,signature:this._descriptorSignature(analysis.features.descriptors,analysis.features.descriptorBytes),blob:cameraFrame.blob,analysisGray:analysisGray?.slice?.()||null,analysisRgb:analysisRgb?.slice?.()||null};
    const loop=this._tryLoopClosure(kf);if(loop?.ok){kf.pose=poseClone(loop.pose);this.pose=poseClone(loop.pose);this.loopClosures.push({from:kf.id,to:loop.candidateId,inliers:loop.inliers,rmse:loop.rmse,t:Date.now()});}
    this.keyframes.push(kf);this.lastKeyframeAt=cameraFrame.timestamp;this.lastKeyframePose=poseClone(kf.pose);if(this.keyframes.length>520)this.keyframes.splice(0,this.keyframes.length-520);return kf;
  }
  _descriptorSignature(desc,db=16){const n=Math.floor(desc.length/db),sig=new Uint8Array(db);if(!n)return sig;for(let b=0;b<db;b++)for(let bit=0;bit<8;bit++){let ones=0;for(let i=0;i<n;i++)ones+=(desc[i*db+b]>>bit)&1;if(ones*2>=n)sig[b]|=1<<bit;}return sig;}
  _sigDistance(a,b){let d=0;for(let i=0;i<Math.min(a.length,b.length);i++){let v=a[i]^b[i];while(v){v&=v-1;d++;}}return d;}
  _tryLoopClosure(kf){if(kf.seq<10)return null;const candidates=this.keyframes.filter(x=>kf.seq-x.seq>=8&&x.signature&&this._sigDistance(kf.signature,x.signature)<=48).sort((a,b)=>this._sigDistance(kf.signature,a.signature)-this._sigDistance(kf.signature,b.signature)).slice(0,3);for(const old of candidates){const corr=this._matchKeyframesToLandmarks(kf,old);if(corr.length<14)continue;const r=this.frontend.optimizePose?.(kf.pose,corr,kf.K,{iterations:7,maxPoints:220,minInliers:12});if(r?.ok&&r.inliers>=12&&r.rmse<5.5)return {...r,candidateId:old.id};}return null;}
  _matchKeyframesToLandmarks(cur,old){const db=cur.descriptorBytes||16,ci=[...cur.trackIds.keys()].sort((a,b)=>(cur.featureScore[b]||0)-(cur.featureScore[a]||0)).slice(0,200),oi=[...old.trackIds.keys()].filter(i=>this.landmarks.has(old.trackIds[i])).sort((a,b)=>(old.featureScore?.[b]||0)-(old.featureScore?.[a]||0)).slice(0,240),out=[];for(const i of ci){let best=999,second=999,bj=-1,co=i*db;for(const j of oi){let d=0,oo=j*db;for(let k=0;k<db;k++){let v=cur.descriptors[co+k]^old.descriptors[oo+k];while(v){v&=v-1;d++;}}if(d<best){second=best;best=d;bj=j;}else if(d<second)second=d;}if(bj>=0&&best<50&&best*100<second*82){const lm=this.landmarks.get(old.trackIds[bj]);if(lm)out.push({world:lm.p,u:cur.featureX[i],v:cur.featureY[i]});}}return out;}
  pinCenter(){const c=this.currentTracks;if(!c?.trackIds?.length)return {ok:false,reason:'no-tracks'};let best=-1,bd=Infinity;for(let i=0;i<c.trackIds.length;i++){const d=Math.hypot(c.xs[i]-c.K.cx,c.ys[i]-c.K.cy);if(d<bd){bd=d;best=i;}}if(best<0)return {ok:false,reason:'no-track'};const id=c.trackIds[best],lm=this.landmarks.get(id);if(!lm)return {ok:false,reason:'track-not-metric',trackId:id};const mark={id:`mark-${crypto.randomUUID()}`,trackId:id,p:[...lm.p],createdAt:Date.now(),views:lm.views,source:lm.source};this.markpoints.push(mark);return {ok:true,mark};}
  diagnostics(){return {frameSeq:this.frameSeq,pose:poseClone(this.pose),landmarks:this.landmarks.size,pendingTriangulation:this.pending.size,keyframes:this.keyframes.length,markpoints:this.markpoints,loopClosures:this.loopClosures,metricCalibration:this.metricCalibration,lastQuality:this.lastQuality};}
}
