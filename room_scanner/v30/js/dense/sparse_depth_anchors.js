import {triangulateRays,projectPoint,poseDistance} from '../slam/math.js';
import {matchProbabilisticFeatures} from '../probabilistic/feature_tracker.js';
import {addPoseUncertaintyToPointCovariance} from '../probabilistic/pose_uncertainty.js';

/**
 * Multi-view sparse geometry anchored by Alva poses and descriptor tracks.
 *
 * V30.25 no longer treats every pairwise triangulation as an independent depth
 * seed. Matches sharing the same reference feature are grouped into a short
 * multi-view track, triangulated against every useful source pose, robustly
 * fused in world space, and only then exposed to the dense/Deep pipeline.
 *
 * This matters because a track seen in 3-4 nearby views is a much stronger
 * metric statement than 3 unrelated pairwise points. We keep only compact
 * sufficient statistics (mean 3D point, depth uncertainty, view count and
 * reprojection quality); no raw track history is retained after the job.
 */
export function buildSparseDepthAnchors(ref,sources,{maxReprojectionPx=2.8,minAngleRad=.010,maxGapBaselineRatio=.14,maxPerSource=180}={}){
  if(!ref?.features?.length||!ref?.pose||!ref?.K)return {seeds:[],range:null,stats:{reason:'no-reference-features'}};

  const tracks=new Map();
  let matched=0,triangulated=0;
  for(const src of sources||[]){
    if(!src?.features?.length||!src?.pose||!src?.K)continue;
    const ms=matchProbabilisticFeatures(ref,src,{maxMatches:maxPerSource,maxEpipolarPx:4.5,minProbability:.025});matched+=ms.length;
    const baseline=Math.max(1e-7,poseDistance(ref.pose,src.pose));
    for(const m of ms){
      const a=ref.features[m.i],b=src.features[m.j];
      const tr=triangulateRays(
        {pose:ref.pose,K:ref.K,u:a.x,v:a.y},
        {pose:src.pose,K:src.K,u:b.x,v:b.y},
        {minAngleRad:Math.min(.0015,minAngleRad),maxGapM:Math.max(1e-6,baseline*Math.max(.30,maxGapBaselineRatio*2.2))}
      );
      if(!tr.ok||!(tr.depthA>0&&tr.depthB>0))continue;
      const ra=projectPoint(ref.pose,ref.K,tr.p),rb=projectPoint(src.pose,src.K,tr.p);if(!ra||!rb)continue;
      const ea=Math.hypot(ra.u-a.x,ra.v-a.y),eb=Math.hypot(rb.u-b.x,rb.v-b.y);
      if(ea>maxReprojectionPx*3.2||eb>maxReprojectionPx*3.2)continue;
      triangulated++;
      const meanReproj=(ea+eb)/2,geom=1-Math.exp(-Math.pow(tr.angle/.030,2)),reproj=Math.exp(-.5*Math.pow(meanReproj/Math.max(.5,maxReprojectionPx),2)),gapP=Math.exp(-.5*Math.pow(tr.gap/Math.max(1e-5,baseline*maxGapBaselineRatio),2));
      const matchProbability=Math.max(.01,Number(m.probability)||.05),confidence=Math.max(.002,Math.pow(matchProbability*geom*reproj*gapP,.25));
      const obs={
        p:tr.p.slice(0,3),depth:ra.z,confidence,angle:tr.angle,reprojectionPx:(ea+eb)/2,
        sourceId:src.frameId||src.id,baseline,u:a.x,v:a.y,featureSource:a.source||'mvs',matchDistance:m.hamming??m.d,matchProbability,epipolarPx:m.epipolarPx??null,zncc:m.zncc??null,matchDiagnostics:{descriptorProbability:m.descriptorProbability??null,epipolarProbability:m.epipolarProbability??null,photometricProbability:m.photometricProbability??null,uniquenessProbability:m.uniquenessProbability??null},
        // Keep the source observation only while this keyframe job is active.
        // It lets the fused landmark solve one true multi-view reprojection
        // problem instead of averaging pairwise triangulations. None of this
        // per-frame structure is retained in the persistent Gaussian map.
        sourcePose:src.pose,sourcePoseCov:src.poseCov||null,sourceK:src.K,sourceU:b.x,sourceV:b.y
      };
      let track=tracks.get(m.i);if(!track){track={refIndex:m.i,u:a.x,v:a.y,featureSource:a.source||'mvs',desc:a.desc||null,referenceDesc:a.referenceDesc||a.desc||null,obs:[]};tracks.set(m.i,track);}track.obs.push(obs);
    }
  }

  const fused=[];
  for(const track of tracks.values()){
    const seed=fuseTrack(track,ref,maxReprojectionPx);if(seed)fused.push(seed);
  }

  // One robust seed per small image cell. Repeated texture can generate several
  // formally valid tracks at nearly the same pixel; prefer tracks with more
  // independent source views, lower depth variance and better reprojection.
  const byCell=new Map();
  for(const x of fused){
    const key=`${Math.round(x.u/10)}:${Math.round(x.v/10)}`;
    const trackedBonus=x.featureSource==='alva-track'?.10:0;
    const supportBonus=Math.min(.20,.07*Math.max(0,x.viewSupport-1));
    const uncertaintyPenalty=Math.min(.18,(x.sigmaDepth/Math.max(.05,x.depth))*.45);
    const score=x.confidence+trackedBonus+supportBonus-uncertaintyPenalty;
    const old=byCell.get(key);if(!old||score>old.score)byCell.set(key,{seed:x,score});
  }
  const seeds=[...byCell.values()].map(x=>x.seed).sort((a,b)=>b.confidence-a.confidence||b.viewSupport-a.viewSupport);
  const range=robustDepthRange(seeds.map(s=>s.depth));
  const multiViewTracks=seeds.filter(s=>s.viewSupport>=2).length;
  return {seeds,range,stats:{matched,triangulated,tracks:tracks.size,accepted:seeds.length,multiViewTracks,sources:(sources||[]).length}};
}

function fuseTrack(track,ref,maxReprojectionPx){
  const obs=(track.obs||[]).filter(o=>finite3(o.p)&&o.depth>0&&Number.isFinite(o.confidence));if(!obs.length)return null;
  const med=[median(obs.map(o=>o.p[0])),median(obs.map(o=>o.p[1])),median(obs.map(o=>o.p[2]))];
  const distances=obs.map(o=>Math.hypot(o.p[0]-med[0],o.p[1]-med[1],o.p[2]-med[2]));
  const dMed=median(distances),dMad=median(distances.map(d=>Math.abs(d-dMed))),depthMed=median(obs.map(o=>o.depth));
  const gate=Math.max(depthMed*.012,dMed+2.8*Math.max(dMad,depthMed*.0025));
  let kept=obs.filter((o,i)=>distances[i]<=gate);if(!kept.length)kept=obs.slice(0,1);

  let sw=0,p=[0,0,0],angleW=0,reprojW=0;
  for(const o of kept){
    // Triangulation becomes well conditioned with larger parallax and lower
    // reprojection error. Confidence already combines both; the extra angle
    // factor prevents almost-parallel rays from dominating a multi-view track.
    const w=Math.max(.005,o.confidence)*Math.max(.04,Math.min(1,o.angle/.045))*Math.max(.05,o.matchProbability||.05);
    sw+=w;for(let k=0;k<3;k++)p[k]+=o.p[k]*w;angleW+=o.angle*w;reprojW+=o.reprojectionPx*w;
  }
  if(!(sw>0))return null;p=p.map(v=>v/sw);

  // Pairwise triangulation above is only a robust initializer. Once we know the
  // Alva pose of every observation, the statistically correct landmark is the
  // 3D point that jointly minimises reprojection error over the whole feature
  // track. A tiny Gauss-Newton solve gives both that point and the inverse-Hessian
  // covariance. With 2-5 views this costs very little compared with Deep/MVS.
  const refined=refineMultiViewTrack(p,track,ref,kept,maxReprojectionPx);
  if(refined?.ok)p=refined.p;
  const pr=projectPoint(ref.pose,ref.K,p);if(!pr||!(pr.z>0))return null;
  const reprojRef=Math.hypot(pr.u-track.u,pr.v-track.v);if(reprojRef>maxReprojectionPx*1.25)return null;

  const depths=kept.map(o=>o.depth),sigmaSample=robustSigma(depths),meanAngle=angleW/sw,meanReproj=refined?.meanReprojectionPx??(reprojW/sw);
  // A floor derived from ray geometry avoids claiming millimetre precision from
  // only two nearly parallel monocular views. More independent views reduce the
  // sample term, but never below a conservative sub-percent depth floor.
  const viewSupport=new Set(kept.map(o=>o.sourceId)).size;
  const geomFloor=Math.max(pr.z*.0035,pr.z*Math.min(.045,.0035/Math.max(.015,Math.sin(meanAngle))));
  const sigmaDepthFloor=Math.max(geomFloor,sigmaSample/Math.sqrt(Math.max(1,viewSupport)));
  let covariance=trackCovariance(ref,track.u,track.v,pr.z,sigmaDepthFloor,kept,p,meanReproj,refined?.covariance);
  covariance=addPoseUncertaintyToPointCovariance(covariance,ref.poseCov,p,ref.pose.p);
  for(const o of kept)covariance=addScaledPoseCovariance(covariance,o.sourcePoseCov,p,o.sourcePose?.p,1/Math.max(1,kept.length));
  const ray=referenceRay(ref,track.u,track.v),sigmaDepth=Math.max(sigmaDepthFloor,Math.sqrt(Math.max(1e-14,quadCov(covariance,ray))));
  const consistency=Math.exp(-Math.min(4,sigmaDepth/Math.max(.05,pr.z)*18));
  const supportGain=1-Math.exp(-.55*viewSupport);
  const reprojGain=Math.max(0,1-meanReproj/Math.max(.5,maxReprojectionPx));
  const matchP=geometricMean(kept.map(o=>Math.max(.005,o.matchProbability||.005))),conditionP=Math.exp(-Math.min(6,(sigmaDepth/Math.max(.05,pr.z))/.08));
  const confidence=Math.max(.005,Math.min(.995,Math.pow(Math.max(1e-9,matchP*reprojGain*supportGain*consistency*conditionP),1/5)));
  const relativeDepthSigma=sigmaDepth/Math.max(.05,pr.z),calibrationWeight=confidence/Math.max(.0025,relativeDepthSigma*relativeDepthSigma);

  return {
    u:track.u,v:track.v,depth:pr.z,p,confidence,angle:meanAngle,reprojectionPx:meanReproj,
    sourceId:kept[0]?.sourceId,sourceIds:[...new Set(kept.map(o=>o.sourceId))],viewSupport,
    featureSource:track.featureSource,trackId:`${ref.frameId||ref.id||'ref'}:${track.refIndex}`,
    sigmaDepth,worldSigma:Math.max(sigmaDepth,robustWorldSigma(kept,p)),trackObservations:kept.length,
    // Preserve the compact appearance descriptor and a full 3D covariance.
    // The covariance is aligned with the reference camera ray and augmented by
    // the empirical scatter of the same feature triangulated from other views.
    // This lets the Gaussian mapper consume the feature track as a genuine
    // metric landmark rather than merely a scalar depth hint.
    descriptor:Array.isArray(track.desc)?track.desc.slice(0,24).map(Number):null,
    // This fixed patch descriptor is shared by Alva-tracked and recovery-only
    // features. It is retained with the triangulated landmark solely to verify
    // a later official Alva relocalisation against already observed geometry.
    referenceDesc:Array.isArray(track.referenceDesc)?track.referenceDesc.slice(0,24).map(Number):null,
    covariance,relativeDepthSigma,geometryProbability:confidence,matchProbability:matchP,calibrationWeight,
    measurements:[{frameId:ref.frameId||ref.id,u:track.u,v:track.v,probability:1},...kept.map(o=>({frameId:o.sourceId,u:o.sourceU,v:o.sourceV,probability:o.matchProbability||o.confidence,epipolarPx:o.epipolarPx??null,zncc:o.zncc??null}))],
    evidenceFrames:[ref.frameId||ref.id,...new Set(kept.map(o=>o.sourceId))].filter(Boolean)
  };
}

export function robustDepthRange(depths,{minCount=5,nearExpand=.55,farExpand=1.75}={}){
  const d=(depths||[]).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);if(d.length<minCount)return null;
  const q=(t)=>d[Math.max(0,Math.min(d.length-1,Math.round(t*(d.length-1))))];
  const q10=q(.10),q50=q(.50),q90=q(.90),near=Math.max(1e-5,q10*nearExpand),far=Math.max(near*1.8,q90*farExpand);
  return {near,far,median:q50,q10,q90,count:d.length};
}

export function nearestSeed(seeds,u,v,maxRadiusPx=22){let best=null,bd=maxRadiusPx*maxRadiusPx;for(const s of seeds||[]){const dx=s.u-u,dy=s.v-v,d=dx*dx+dy*dy;if(d<bd){bd=d;best=s;}}return best;}

function geometricMean(a){if(!a?.length)return .01;let s=0;for(const x of a)s+=Math.log(Math.max(1e-9,Number(x)||1e-9));return Math.exp(s/a.length);}
function addScaledPoseCovariance(cov,poseCov,p,o,scale=1){if(!poseCov||!p||!o)return cov;const added=addPoseUncertaintyToPointCovariance([0,0,0,0,0,0],poseCov,p,o);return addCov(cov,scaleCov(added,Math.max(0,scale)));}
function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}
function median(a){if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
function robustSigma(a){if(a.length<2)return 0;const m=median(a),mad=median(a.map(x=>Math.abs(x-m)));return 1.4826*mad;}
function robustWorldSigma(obs,p){if(obs.length<2)return 0;const d=obs.map(o=>Math.hypot(o.p[0]-p[0],o.p[1]-p[1],o.p[2]-p[2]));return Math.max(0,1.4826*median(d));}


function trackCovariance(ref,u,v,z,sigmaDepth,obs,p,reprojectionPx,optimCov=null){
  const ray=referenceRay(ref,u,v),f=Math.max(1,Math.min(ref.K.fx,ref.K.fy)),pixelSigma=Math.max(.45,Math.min(2.5,Number(reprojectionPx)||.8));
  const sigmaLat=Math.max(z/f*.45,z/f*pixelSigma*.65),base=rayCovariance(ray,sigmaDepth,sigmaLat),scatter=scatterCovariance(obs,p);
  if(!validCov(optimCov))return addCov(base,scatter);

  // Preserve the covariance orientation inferred from the true multi-view
  // reprojection Hessian, but enforce conservative longitudinal/lateral floors.
  // Adding floors only when needed is less approximate than replacing the full
  // Hessian with a hand-shaped ray ellipsoid. Empirical pairwise scatter then
  // captures residual pose/descriptor mismatch not explained by pixel noise.
  let cov=addCov(optimCov,scatter),rv=quadCov(cov,ray),need=sigmaDepth*sigmaDepth-rv;if(need>0)cov=addCov(cov,scaleCov(outerCov(ray),need));
  const [t1,t2]=tangentBasis(ray);for(const t of [t1,t2]){const tv=quadCov(cov,t),d=sigmaLat*sigmaLat-tv;if(d>0)cov=addCov(cov,scaleCov(outerCov(t),d));}
  return regularizeCov(cov,Math.max(1e-6,z*2e-6));
}

function refineMultiViewTrack(initial,track,ref,kept,maxReprojectionPx){
  const views=[{pose:ref.pose,K:ref.K,u:track.u,v:track.v,weight:1.15},...kept.map(o=>({pose:o.sourcePose,K:o.sourceK,u:o.sourceU,v:o.sourceV,weight:Math.max(.15,o.confidence)}))].filter(v=>v.pose&&v.K&&Number.isFinite(v.u+v.v));
  if(views.length<2)return null;let p=initial.slice(0,3),lastH=null;
  for(let iter=0;iter<5;iter++){
    const acc=normalEquations(p,views);if(!acc||acc.used<2)return null;const trace=acc.H[0]+acc.H[3]+acc.H[5],lambda=Math.max(1e-8,trace*2e-7),H=acc.H.slice();H[0]+=lambda;H[3]+=lambda;H[5]+=lambda;const inv=invertCov(H);if(!inv)return null;
    let delta=mulCovVec(inv,acc.g).map(x=>-x);const pr=projectPoint(ref.pose,ref.K,p),limit=Math.max(.004,(pr?.z||1)*.08),dn=Math.hypot(...delta);if(dn>limit)delta=delta.map(x=>x*limit/dn);
    const next=[p[0]+delta[0],p[1]+delta[1],p[2]+delta[2]],q=projectPoint(ref.pose,ref.K,next);if(!q||!(q.z>0)||!finite3(next))break;p=next;lastH=acc.H;if(dn<Math.max(2e-6,q.z*2e-6))break;
  }
  const final=normalEquations(p,views);if(!final||final.used<2)return null;lastH=final.H;const errors=[];for(const v of views){const q=projectPoint(v.pose,v.K,p);if(q&&q.z>0)errors.push(Math.hypot(q.u-v.u,q.v-v.v));}
  if(errors.length<2)return null;const meanReprojectionPx=errors.reduce((a,b)=>a+b,0)/errors.length;if(meanReprojectionPx>maxReprojectionPx*1.35)return null;
  const inv=invertCov(lastH);if(!inv)return {ok:true,p,meanReprojectionPx,covariance:null,views:errors.length};const residualSigma=Math.max(.45,Math.min(2.5,1.4826*median(errors.map(e=>Math.abs(e-median(errors))))||meanReprojectionPx||.6)),covariance=scaleCov(inv,residualSigma*residualSigma);
  return {ok:true,p,meanReprojectionPx,covariance:regularizeCov(covariance,Math.max(1e-6,(projectPoint(ref.pose,ref.K,p)?.z||1)*1e-6)),views:errors.length};
}
function normalEquations(p,views){
  const H=[0,0,0,0,0,0],g=[0,0,0];let used=0;const eps=Math.max(2e-6,Math.hypot(...p)*2e-6),huber=1.6;
  for(const v of views){const q=projectPoint(v.pose,v.K,p);if(!q||!(q.z>0))continue;const ru=q.u-v.u,rv=q.v-v.v,e=Math.hypot(ru,rv),robust=e<=huber?1:huber/Math.max(huber,e),w=Math.max(.05,v.weight||1)*robust,ju=[0,0,0],jv=[0,0,0];let valid=true;
    for(let k=0;k<3;k++){const pp=p.slice();pp[k]+=eps;const qq=projectPoint(v.pose,v.K,pp);if(!qq||!(qq.z>0)){valid=false;break;}ju[k]=(qq.u-q.u)/eps;jv[k]=(qq.v-q.v)/eps;}if(!valid)continue;used++;
    for(let a=0;a<3;a++){g[a]+=w*(ju[a]*ru+jv[a]*rv);for(let b=a;b<3;b++)addPacked(H,a,b,w*(ju[a]*ju[b]+jv[a]*jv[b]));}
  }return {H,g,used};
}
function addPacked(H,a,b,v){const idx=a===0?(b===0?0:b===1?1:2):a===1?(b===1?3:4):5;H[idx]+=v;}
function invertCov(c){const a=c[0],b=c[1],d=c[2],e=c[3],f=c[4],g=c[5],A=e*g-f*f,B=d*f-b*g,C=b*f-d*e,D=a*g-d*d,E=b*d-a*f,F=a*e-b*b,det=a*A+b*B+d*C;if(!Number.isFinite(det)||Math.abs(det)<1e-24)return null;const s=1/det;return [A*s,B*s,C*s,D*s,E*s,F*s];}
function mulCovVec(c,v){return [c[0]*v[0]+c[1]*v[1]+c[2]*v[2],c[1]*v[0]+c[3]*v[1]+c[4]*v[2],c[2]*v[0]+c[4]*v[1]+c[5]*v[2]];}
function validCov(c){return Array.isArray(c)&&c.length>=6&&c.slice(0,6).every(Number.isFinite)&&c[0]>0&&c[3]>0&&c[5]>0;}
function regularizeCov(c,e){const q=c.slice(0,6);q[0]+=e*e;q[3]+=e*e;q[5]+=e*e;return q;}
function quadCov(c,v){return v[0]*(c[0]*v[0]+c[1]*v[1]+c[2]*v[2])+v[1]*(c[1]*v[0]+c[3]*v[1]+c[4]*v[2])+v[2]*(c[2]*v[0]+c[4]*v[1]+c[5]*v[2]);}
function outerCov(v){return [v[0]*v[0],v[0]*v[1],v[0]*v[2],v[1]*v[1],v[1]*v[2],v[2]*v[2]];}function scaleCov(c,s){return c.map(x=>x*s);}
function tangentBasis(n){const a=Math.abs(n[2])<.85?[0,0,1]:[0,1,0],t1=normalize(cross(a,n)),t2=normalize(cross(n,t1));return [t1,t2];}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function referenceRay(ref,u,v){const R=rotationFromQuat(ref.pose.q),cam=[(u-ref.K.cx)/ref.K.fx,(v-ref.K.cy)/ref.K.fy,1];return normalize(rotate(R,cam));}
function scatterCovariance(obs,p){
  if(!obs?.length||obs.length<2)return [0,0,0,0,0,0];let sw=0,c=[0,0,0,0,0,0];
  for(const o of obs){const w=Math.max(.05,Number(o.confidence)||.2),d=[o.p[0]-p[0],o.p[1]-p[1],o.p[2]-p[2]];sw+=w;c[0]+=w*d[0]*d[0];c[1]+=w*d[0]*d[1];c[2]+=w*d[0]*d[2];c[3]+=w*d[1]*d[1];c[4]+=w*d[1]*d[2];c[5]+=w*d[2]*d[2];}
  // The scatter describes the uncertainty of the fused track mean, hence /N.
  const n=Math.max(1,obs.length),den=Math.max(1e-9,sw*n);return c.map(x=>x/den);
}
function rayCovariance(ray,sd,sl){const r=normalize(ray),a=Math.max(1e-12,sl*sl),d=Math.max(a,sd*sd)-a;return [a+d*r[0]*r[0],d*r[0]*r[1],d*r[0]*r[2],a+d*r[1]*r[1],d*r[1]*r[2],a+d*r[2]*r[2]];}
function addCov(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2],a[3]+b[3],a[4]+b[4],a[5]+b[5]];}
function rotationFromQuat(q){let [x,y,z,w]=(q||[0,0,0,1]).map(Number),n=Math.hypot(x,y,z,w)||1;x/=n;y/=n;z/=n;w/=n;return [1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)];}
function rotate(R,v){return [R[0]*v[0]+R[1]*v[1]+R[2]*v[2],R[3]*v[0]+R[4]*v[1]+R[5]*v[2],R[6]*v[0]+R[7]*v[1]+R[8]*v[2]];}
function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
