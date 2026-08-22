/**
 * V30.52 global surface consensus.
 *
 * Local submaps are intentionally allowed to create multiple nearby hypotheses.
 * Before REVIEW/TSDF, however, those hypotheses must agree in world space.
 * This stage merges only spatially-near, normal-compatible splats and promotes
 * a representative only when it carries independent multi-view evidence.
 * Raw/local splats are never mutated and remain available in diagnostics.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function buildGlobalSurfaceConsensus(splats,{voxel=.035,max=90000,minConfidence=.26,normalAngleDeg=32,distanceFactor=1.75,axialFactor=1.10}={}){
  const input=(Array.isArray(splats)?splats:[]).filter(g=>finite3(g?.position)&&finite3(g?.normal));
  const cell=Math.max(.006,Number(voxel)||.035),minDot=Math.cos(clamp(Number(normalAngleDeg)||32,8,75)*Math.PI/180),maxDist=cell*Math.max(1.1,Number(distanceFactor)||1.75),maxAxial=cell*Math.max(.55,Number(axialFactor)||1.10);
  const rows=input.map((g,i)=>({g,i,c:confidence(g),rank:rank(g)})).sort((a,b)=>b.rank-a.rank),clusters=[],hash=new Map();
  let rejectedInvalidConfidence=0,rejectedLowConfidence=0;
  for(const row of rows){
    const g=row.g,c=row.c;if(c==null){rejectedInvalidConfidence++;continue;}if(c<.06){rejectedLowConfidence++;continue;}
    const p=vec3(g.position),n0=normalised(g.normal),sigma=positionSigma(g,cell),cellId=cellOf(p,cell);let best=-1,bestScore=Infinity,bestSign=1;
    for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const ids=hash.get(key(cellId[0]+dx,cellId[1]+dy,cellId[2]+dz));if(!ids)continue;
      for(const ci of ids){const cl=clusters[ci],dp=sub(p,cl.p),d=Math.hypot(...dp);if(d>Math.max(maxDist,2.4*(sigma+cl.sigma)))continue;const nd=dot(n0,cl.n),ad=Math.abs(nd);if(ad<minDot)continue;const sign=nd<0?-1:1,axial=Math.abs(dot(dp,cl.n));if(axial>Math.max(maxAxial,2.0*(sigma+cl.sigma)))continue;const lateral=Math.sqrt(Math.max(0,d*d-axial*axial));if(lateral>maxDist*1.15)continue;const score=d/(maxDist+1e-9)+.8*(1-ad)+.45*axial/(maxAxial+1e-9);if(score<bestScore){bestScore=score;best=ci;bestSign=sign;}}
    }
    const weight=Math.max(.02,c)*(.7+.3*Math.min(1,(Number(g.support)||1)/3))*(g.finalPoseValidated?1.15:1);
    if(best<0){const ci=clusters.length,cl=newCluster(g,p,n0,c,sigma,weight);clusters.push(cl);const k=key(...cellId),a=hash.get(k)||[];a.push(ci);hash.set(k,a);}else updateCluster(clusters[best],g,p,n0.map(x=>x*bestSign),c,sigma,weight);
  }
  const representatives=[],authoritative=[];let rejectedSupport=0,rejectedConfidence=0,verifiedClusters=0,crossSubmapClusters=0,strongClusters=0;
  for(const cl of clusters){
    const rep=representative(cl,cell),intrinsic=cl.maxIndependent>=2||cl.maxSupport>=3||cl.maxAnchor>=1.5&&cl.maxIndependent>=1||cl.strongMembers>0,cross=cl.submaps.size>=2&&cl.members>=2&&cl.maxIndependent>=1,verified=cl.finalPoseValidated&&(intrinsic||cross);
    rep.globalConsensusMembers=cl.members;rep.globalConsensusSubmaps=cl.submaps.size;rep.globalConsensusIndependent=cl.maxIndependent;rep.globalConsensusVerified=verified;rep.globalConsensusScore=consensusScore(cl);
    representatives.push(rep);if(cross)crossSubmapClusters++;if(intrinsic)strongClusters++;
    if(!verified){rejectedSupport++;continue;}verifiedClusters++;if(rep.confidence<minConfidence){rejectedConfidence++;continue;}authoritative.push(rep);
  }
  authoritative.sort((a,b)=>rank(b)-rank(a));if(Number.isFinite(max)&&authoritative.length>max)authoritative.length=Math.max(0,max|0);
  const cs=authoritative.map(confidence).filter(Number.isFinite),occupiedCells=new Set(authoritative.map(g=>key(...cellOf(g.position,cell)))).size;
  return {splats:authoritative,candidates:representatives,stats:{input:input.length,clusters:clusters.length,representatives:representatives.length,authoritative:authoritative.length,authoritativeFraction:input.length?authoritative.length/input.length:0,clusterCompression:input.length?clusters.length/input.length:0,verifiedClusters,crossSubmapClusters,strongClusters,rejectedInvalidConfidence,rejectedLowConfidence,rejectedSupport,rejectedConfidence,minConfidence,medianConfidence:quantile(cs,.5),p10Confidence:quantile(cs,.1),occupiedCells,voxel:cell}};
}

function newCluster(g,p,n,c,sigma,w){return {p:p.slice(),n:n.slice(),color:color(g),cov:covariance(g),scale:Array.isArray(g.scale)?g.scale.slice(0,3):null,weight:w,confSum:c*w,sigma, members:1,submaps:new Set(g.submapId?[String(g.submapId)]:[]),maxSupport:Number(g.support)||0,maxIndependent:Number(g.independentSupport)||0,maxAnchor:Number(g.anchorSupport)||0,sourceMask:Number(g.sourceMask)||0,finalPoseValidated:!!g.finalPoseValidated,mixedEvidence:!!g.mixedEvidence,strongMembers:g.evidenceClass==='strong'?1:0,maxBaseline:Number(g.maxBaseline)||0,viewOrigin:finite3(g.viewOrigin)?vec3(g.viewOrigin):null,normalReliable:!!g.normalReliable,prototype:g};}
function updateCluster(cl,g,p,n,c,sigma,w){const nw=cl.weight+w,t=w/nw;for(let k=0;k<3;k++){cl.p[k]+=t*(p[k]-cl.p[k]);cl.n[k]+=t*(n[k]-cl.n[k]);cl.color[k]+=t*(color(g)[k]-cl.color[k]);}cl.n=normalised(cl.n);cl.weight=nw;cl.confSum+=c*w;cl.sigma=Math.min(cl.sigma,sigma);cl.members++;if(g.submapId)cl.submaps.add(String(g.submapId));cl.maxSupport=Math.max(cl.maxSupport,Number(g.support)||0);cl.maxIndependent=Math.max(cl.maxIndependent,Number(g.independentSupport)||0);cl.maxAnchor=Math.max(cl.maxAnchor,Number(g.anchorSupport)||0);cl.sourceMask|=Number(g.sourceMask)||0;cl.finalPoseValidated=cl.finalPoseValidated||!!g.finalPoseValidated;cl.mixedEvidence=cl.mixedEvidence||!!g.mixedEvidence;if(g.evidenceClass==='strong')cl.strongMembers++;cl.maxBaseline=Math.max(cl.maxBaseline,Number(g.maxBaseline)||0);cl.normalReliable=cl.normalReliable||!!g.normalReliable;if(!cl.viewOrigin&&finite3(g.viewOrigin))cl.viewOrigin=vec3(g.viewOrigin);}
function representative(cl,voxel){const proto=cl.prototype,mean=cl.confSum/Math.max(1e-9,cl.weight),strength=consensusScore(cl),conf=clamp(mean*(.82+.18*strength),.01,.995),support=Math.max(cl.maxSupport,Math.min(8,cl.members)),independent=Math.max(cl.maxIndependent,Math.min(4,Math.max(0,cl.submaps.size-1))),strong=cl.maxIndependent>=2||cl.maxSupport>=3||cl.strongMembers>0||cl.submaps.size>=2;return {...proto,position:cl.p.slice(),normal:cl.n.slice(),color:cl.color.map(x=>Math.round(clamp(x,0,255))),confidence:conf,posteriorConfidence:conf,support,independentSupport:independent,anchorSupport:cl.maxAnchor,sourceMask:cl.sourceMask,finalPoseValidated:cl.finalPoseValidated,mixedEvidence:cl.mixedEvidence,evidenceClass:strong?'strong':'confirmed',maxBaseline:cl.maxBaseline,viewOrigin:cl.viewOrigin?cl.viewOrigin.slice():proto.viewOrigin,normalReliable:cl.normalReliable,positionSigma:Math.max(voxel*.05,cl.sigma),globalConsensus:true};}
function consensusScore(cl){const views=Math.min(4,cl.maxIndependent),subs=Math.min(3,cl.submaps.size),members=Math.min(5,cl.members);return clamp(.18*members+.24*views+.12*subs+.16*(cl.finalPoseValidated?1:0)+.12*(cl.mixedEvidence?1:0),0,1);}
function confidence(g){for(const v of [g?.confidence,g?.probability,g?.posteriorConfidence]){const x=Number(v);if(Number.isFinite(x))return clamp(x,0,1);}return null;}
function rank(g){const c=confidence(g)??0,s=Math.min(8,Math.max(0,Number(g?.support)||0)),i=Math.min(6,Math.max(0,Number(g?.independentSupport)||0)),v=g?.finalPoseValidated?1:0,a=Math.min(4,Math.max(0,Number(g?.anchorSupport)||0));return 3*c+.20*s+.32*i+.45*v+.12*a;}
function positionSigma(g,voxel){const x=Number(g?.positionSigma);if(Number.isFinite(x)&&x>0)return x;const c=covariance(g);if(c)return Math.sqrt(Math.max(1e-12,(c[0]+c[3]+c[5])/3));return voxel*.45;}
function covariance(g){const c=g?.positionCovariance||g?.covariance;return Array.isArray(c)&&c.length>=6&&c.slice(0,6).every(Number.isFinite)?c.slice(0,6):null;}
function color(g){const c=Array.isArray(g?.color)?g.color:[180,195,215];return [Number(c[0])||0,Number(c[1])||0,Number(c[2])||0];}
function cellOf(p,v){return [Math.floor(p[0]/v),Math.floor(p[1]/v),Math.floor(p[2]/v)];}function key(x,y,z){return `${x},${y},${z}`;}function vec3(p){return [Number(p[0]),Number(p[1]),Number(p[2])];}function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function normalised(v){const n=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/n,v[1]/n,v[2]/n];}
function quantile(a,q){if(!a.length)return null;const b=a.slice().sort((x,y)=>x-y),t=clamp(q,0,1)*(b.length-1),i=Math.floor(t),u=t-i;return b[i]*(1-u)+b[Math.min(b.length-1,i+1)]*u;}
