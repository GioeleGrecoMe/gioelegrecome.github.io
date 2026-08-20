import {triangulateRays,projectPoint,poseDistance} from '../slam/math.js';

/**
 * Sparse geometric depth anchors from Alva-selected MVS features.
 *
 * These are NOT the dense reconstruction. They are trusted geometric seeds used
 * to tell plane sweep where real scene depth actually lives. A seed survives
 * descriptor mutual matching, triangulation, cheirality and reprojection in
 * both views. This prevents the dense mapper from selecting an arbitrary
 * photometric sheet merely because it happens to sit in front of the camera.
 */
export function buildSparseDepthAnchors(ref,sources,{maxReprojectionPx=2.8,minAngleRad=.010,maxGapBaselineRatio=.14,maxPerSource=180}={}){
  if(!ref?.features?.length||!ref?.pose||!ref?.K)return {seeds:[],range:null,stats:{reason:'no-reference-features'}};
  const all=[];let matched=0,triangulated=0;
  for(const src of sources||[]){
    if(!src?.features?.length||!src?.pose||!src?.K)continue;
    const ms=mutualDescriptorMatches(ref.features,src.features,maxPerSource);matched+=ms.length;
    const baseline=Math.max(1e-7,poseDistance(ref.pose,src.pose));
    for(const m of ms){
      const a=ref.features[m.i],b=src.features[m.j];
      const tr=triangulateRays(
        {pose:ref.pose,K:ref.K,u:a.x,v:a.y},
        {pose:src.pose,K:src.K,u:b.x,v:b.y},
        {minAngleRad,maxGapM:Math.max(1e-6,baseline*maxGapBaselineRatio)}
      );
      if(!tr.ok||!(tr.depthA>0&&tr.depthB>0))continue;
      const ra=projectPoint(ref.pose,ref.K,tr.p),rb=projectPoint(src.pose,src.K,tr.p);if(!ra||!rb)continue;
      const ea=Math.hypot(ra.u-a.x,ra.v-a.y),eb=Math.hypot(rb.u-b.x,rb.v-b.y);
      if(ea>maxReprojectionPx||eb>maxReprojectionPx)continue;
      triangulated++;
      const geom=Math.min(1,tr.angle/.08),reproj=Math.max(0,1-(ea+eb)/(2*maxReprojectionPx));
      all.push({u:a.x,v:a.y,depth:ra.z,p:tr.p,confidence:.55*geom+.45*reproj,angle:tr.angle,reprojectionPx:(ea+eb)/2,sourceId:src.id,featureSource:a.source||'mvs'});
    }
  }
  // Keep one robust seed per small image cell, preferring confidence and Alva
  // tracked features. This also prevents repeated texture from dominating.
  const byCell=new Map();
  for(const x of all){const key=`${Math.round(x.u/10)}:${Math.round(x.v/10)}`,bonus=x.featureSource==='alva-track'?.12:0,score=x.confidence+bonus,old=byCell.get(key);if(!old||score>old.score)byCell.set(key,{seed:x,score});}
  const seeds=[...byCell.values()].map(x=>x.seed).sort((a,b)=>b.confidence-a.confidence);
  const range=robustDepthRange(seeds.map(s=>s.depth));
  return {seeds,range,stats:{matched,triangulated,accepted:seeds.length,sources:(sources||[]).length}};
}

export function robustDepthRange(depths,{minCount=5,nearExpand=.55,farExpand=1.75}={}){
  const d=(depths||[]).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);if(d.length<minCount)return null;
  const q=(t)=>d[Math.max(0,Math.min(d.length-1,Math.round(t*(d.length-1))))];
  const q10=q(.10),q50=q(.50),q90=q(.90),near=Math.max(1e-5,q10*nearExpand),far=Math.max(near*1.8,q90*farExpand);
  return {near,far,median:q50,q10,q90,count:d.length};
}

export function nearestSeed(seeds,u,v,maxRadiusPx=22){let best=null,bd=maxRadiusPx*maxRadiusPx;for(const s of seeds||[]){const dx=s.u-u,dy=s.v-v,d=dx*dx+dy*dy;if(d<bd){bd=d;best=s;}}return best;}

function mutualDescriptorMatches(A,B,maxN){
  const bestAB=[];for(let i=0;i<A.length;i++){let j=-1,d1=Infinity,d2=Infinity;for(let k=0;k<B.length;k++){const d=descDistance(A[i],B[k]);if(d<d1){d2=d1;d1=d;j=k;}else if(d<d2)d2=d;}if(j>=0&&d1<1250&&(d2===Infinity||d1<d2*.88))bestAB.push({i,j,d:d1});}
  const bestForB=new Map();for(let j=0;j<B.length;j++){let i=-1,d=Infinity;for(let k=0;k<A.length;k++){const x=descDistance(A[k],B[j]);if(x<d){d=x;i=k;}}if(i>=0)bestForB.set(j,i);}
  return bestAB.filter(m=>bestForB.get(m.j)===m.i).sort((a,b)=>a.d-b.d).slice(0,maxN);
}
function descDistance(a,b){const A=a?.desc,B=b?.desc;if(!A?.length||A.length!==B?.length)return Infinity;let s=0;for(let i=0;i<A.length;i++)s+=Math.abs(Number(A[i])-Number(B[i]));const spatial=.035*Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0));return s+spatial;}
