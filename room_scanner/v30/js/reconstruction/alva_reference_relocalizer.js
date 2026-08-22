import {refinePosePnP} from '../metric/pnp_pose.js?v=30.54.0';

/*
 * Conservative visual relocalisation sidecar.
 *
 * AlvaAR remains the only trajectory authority.  This module never writes a
 * pose into SlamEngine: it recognises a previously triangulated 3-D landmark
 * set while Alva is lost and can subsequently verify that the official Alva
 * pose returned in the same historical place.  That prevents a blind
 * "persistent feature count" from accepting a numerically plausible but
 * spatially wrong restart.
 */
const finite=v=>Number.isFinite(+v)?+v:0;
const clonePose=p=>p?.p?.length>=3&&p?.q?.length>=4?{p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)}:null;

export class AlvaReferenceRelocalizer{
  constructor({maxLandmarks=900,maxCurrentFeatures=320,minMatches=8,minInliers=6,maxRmsePx=5.5,descriptorThreshold=.42,ratio=.88,intervalMs=520}={}){
    Object.assign(this,{maxLandmarks,maxCurrentFeatures,minMatches,minInliers,maxRmsePx,descriptorThreshold,ratio,intervalMs});this.lastAt=-Infinity;this.last=null;this._graph=null;this._signature='';this._landmarks=[];this._frames=new Map();
  }
  reset(){this.lastAt=-Infinity;this.last=null;this._graph=null;this._signature='';this._landmarks=[];this._frames.clear();}
  status(){return {available:this._landmarks.length,frames:this._frames.size,last:this.last?compact(this.last):null};}
  evaluate({features,K,graph,at=performance.now()}={}){
    if(at-this.lastAt<this.intervalMs&&this.last)return this.last;
    this.lastAt=at;this._refresh(graph);
    const current=(features||[]).filter(validFeature).slice(0,this.maxCurrentFeatures),base={at,ok:false,reason:null,available:this._landmarks.length,currentFeatures:current.length,matches:0,inliers:0,rmsePx:Infinity,candidateFrameId:null,pose:null};
    if(!K||![K.fx,K.fy,K.cx,K.cy].every(Number.isFinite)){return this.last={...base,reason:'invalid-intrinsics'};}
    if(this._landmarks.length<this.minMatches){return this.last={...base,reason:'not-enough-triangulated-landmarks'};}
    if(current.length<this.minMatches){return this.last={...base,reason:'not-enough-current-features'};}
    const matches=mutualDescriptorMatches(current,this._landmarks,{threshold:this.descriptorThreshold,ratio:this.ratio});base.matches=matches.length;
    if(matches.length<this.minMatches)return this.last={...base,reason:'visual-match-support-low'};
    const byFrame=new Map();
    for(const m of matches){const fid=String(m.landmark.refFrameId||'');if(!this._frames.has(fid))continue;const a=byFrame.get(fid)||[];a.push(m);byFrame.set(fid,a);}
    const candidates=[...byFrame.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,4);let best=null;
    for(const [frameId,seedMatches] of candidates){
      if(seedMatches.length<this.minMatches)continue;
      const frame=this._frames.get(frameId),initial=clonePose(frame?.poseEstimate||frame?.posePrior);if(!initial)continue;
      const support=spreadMatches(seedMatches),observations=support.map(m=>({world:m.landmark.point,u:m.feature.x,v:m.feature.y}));if(observations.length<this.minMatches||spatialSpread(observations)<.012)continue;
      let pnp;
      try{pnp=refinePosePnP({initialPose:initial,K,observations,maxIterations:16,huberPx:Math.max(4,this.maxRmsePx*1.35)});}catch{continue;}
      // Preserve the exact landmark correspondence for optional *post-scan*
      // recovery.  The live sidecar still only validates Alva; it never passes
      // this pose to SlamEngine.  Post-processing can add the observations as
      // ordinary robust reprojection factors, with no synthetic Alva edge.
      const candidate={...base,candidateFrameId:frameId,matches:observations.length,inliers:pnp.inliers||0,rmsePx:pnp.rmsePx,pose:clonePose(pnp.pose),pnpReason:pnp.reason||null,referencePose:initial,observations:support.map(m=>({landmarkId:String(m.landmark.id||''),u:+m.feature.x,v:+m.feature.y,probability:Math.max(.05,Math.min(.98,1-m.distance))})).filter(m=>m.landmarkId)};
      candidate.ok=!!pnp.ok&&candidate.inliers>=this.minInliers&&candidate.rmsePx<=this.maxRmsePx;
      if(!best||(candidate.ok&&!best.ok)||(candidate.ok===best.ok&&rank(candidate)>rank(best)))best=candidate;
    }
    return this.last=best||{...base,reason:'pnp-not-observable'};
  }
  _refresh(graph){
    const frames=graph?.frames||[],landmarks=graph?.landmarkFactors||[],signature=`${frames.length}:${landmarks.length}:${landmarks.at(-1)?.id||''}`;if(graph===this._graph&&signature===this._signature)return;
    this._graph=graph;this._signature=signature;this._frames=new Map(frames.map(f=>[String(f?.frameId||''),f]));
    this._landmarks=landmarks.filter(l=>validLandmark(l)&&this._frames.has(String(l.refFrameId||''))).sort((a,b)=>landmarkRank(b)-landmarkRank(a)).slice(0,this.maxLandmarks).map(l=>({id:String(l.id||''),refFrameId:String(l.refFrameId||''),point:l.point.slice(0,3).map(Number),descriptor:Array.from(l.descriptor||[]).slice(0,24).map(Number),probability:finite(l.probability)}));
  }
}

export function relocalizationPoseCompatible(alvaPose,reference,{maxTranslation=1.15,maxRotationRad=.95}={}){
  const a=clonePose(alvaPose),b=clonePose(reference?.pose||reference);if(!a||!b)return false;
  const translation=Math.hypot(a.p[0]-b.p[0],a.p[1]-b.p[1],a.p[2]-b.p[2]),dot=Math.abs(a.q[0]*b.q[0]+a.q[1]*b.q[1]+a.q[2]*b.q[2]+a.q[3]*b.q[3]),rotationRad=2*Math.acos(Math.max(-1,Math.min(1,dot)));
  return translation<=maxTranslation&&rotationRad<=maxRotationRad;
}

function validFeature(f){const d=f?.referenceDesc||f?.desc;return Number.isFinite(+f?.x)&&Number.isFinite(+f?.y)&&Array.isArray(d)&&d.length>=12;}
function validLandmark(l){return Array.isArray(l?.point)&&l.point.length>=3&&l.point.every(Number.isFinite)&&Array.isArray(l?.descriptor)&&l.descriptor.length>=12&&finite(l.probability)>=.02;}
function landmarkRank(l){return finite(l.probability)+.06*Math.min(4,(l.measurements||[]).length);}
function rank(x){return (x.ok?100000:0)+(x.inliers||0)*100-(Number.isFinite(x.rmsePx)?x.rmsePx:999);
}
function normDescriptorDistance(a,b){if(!a?.length||a.length!==b.length)return Infinity;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let va=0,vb=0;for(let i=0;i<a.length;i++){va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2;}va=Math.sqrt(va/a.length)||1;vb=Math.sqrt(vb/b.length)||1;let d=0;for(let i=0;i<a.length;i++)d+=Math.abs((a[i]-ma)/va-(b[i]-mb)/vb);return d/(2*a.length);}
function mutualDescriptorMatches(features,landmarks,{threshold,ratio}){
  const forward=[],bestForLandmark=new Map();
  for(let fi=0;fi<features.length;fi++){
    const f=features[fi],d=f.referenceDesc||f.desc;let best=null,second=Infinity;
    for(let li=0;li<landmarks.length;li++){const v=normDescriptorDistance(d,landmarks[li].descriptor);if(v<second){if(!best||v<best.distance){second=best?.distance??Infinity;best={fi,li,distance:v};}else second=v;}}
    if(!best||best.distance>threshold||(Number.isFinite(second)&&best.distance/Math.max(1e-6,second)>ratio))continue;
    forward.push(best);const old=bestForLandmark.get(best.li);if(!old||best.distance<old.distance)bestForLandmark.set(best.li,best);
  }
  return forward.filter(m=>bestForLandmark.get(m.li)===m).map(m=>({feature:features[m.fi],landmark:landmarks[m.li],distance:m.distance}));
}
function spreadMatches(matches){
  const cells=new Map();for(const m of matches){const p=m.landmark.point,key=`${Math.round(p[0]/.08)}:${Math.round(p[1]/.08)}:${Math.round(p[2]/.08)}`,old=cells.get(key);if(!old||m.distance<old.distance)cells.set(key,m);}return [...cells.values()];
}
function spatialSpread(obs){if(obs.length<2)return 0;const p=obs.map(x=>x.world),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const x of p)for(let i=0;i<3;i++){min[i]=Math.min(min[i],x[i]);max[i]=Math.max(max[i],x[i]);}return Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2]);}
function compact(x){return {ok:!!x.ok,reason:x.reason||null,available:x.available||0,matches:x.matches||0,inliers:x.inliers||0,rmsePx:Number.isFinite(x.rmsePx)?x.rmsePx:null,candidateFrameId:x.candidateFrameId||null};}
