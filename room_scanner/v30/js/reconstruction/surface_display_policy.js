/**
 * V30.53 surface visibility / TSDF admission policy.
 *
 * Low-probability or probability-unknown Gaussian hypotheses are never shown as
 * normal geometry. They remain in the probabilistic evidence state and in TEST
 * diagnostics, but do not visually pollute REVIEW and do not create TSDF islands.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function filterSurfaceSplatsForDisplay(splats,{mode='review',max=Infinity,minConfidence=null,allowUnknown=false}={}){
  const input=Array.isArray(splats)?splats:[],base=minConfidence!=null&&Number.isFinite(Number(minConfidence))?Number(minConfidence):(mode==='candidate'?.60:mode==='live'?.48:.52),ranked=[];let hiddenLowConfidence=0,hiddenWeak=0,hiddenUnknownConfidence=0;
  for(const g of input){
    if(!g)continue;const c=surfaceConfidence(g);if(c==null){if(allowUnknown){ranked.push({g,c:0,rank:surfaceRank(g,0)});}else hiddenUnknownConfidence++;continue;}
    const weak=g.evidenceClass==='weak'||g.evidenceClass==='candidate',floor=weak?Math.max(base,.62):base;
    if(c<floor){hiddenLowConfidence++;if(weak)hiddenWeak++;continue;}
    // Committed/review points should have survived global consensus. Legacy or
    // external PLY data can lack this flag, therefore it is a ranking bonus and
    // not a hard requirement here.
    ranked.push({g,c,rank:surfaceRank(g,c)});
  }
  ranked.sort((a,b)=>b.rank-a.rank);if(Number.isFinite(max)&&ranked.length>max)ranked.length=Math.max(0,max|0);
  const kept=ranked.map(x=>x.g),known=ranked.map(x=>x.c).filter(Number.isFinite),hidden=Math.max(0,input.length-kept.length);
  return {splats:kept,stats:{input:input.length,visible:kept.length,hidden,hiddenLowConfidence,hiddenWeak,hiddenUnknownConfidence,minConfidence:base,visibleConfidenceMedian:quantile(known,.5),visibleConfidenceP10:quantile(known,.1),mode}};
}

export function filterSurfaceSplatsForMeshing(splats,{minConfidence=.30,max=Infinity}={}){
  const input=Array.isArray(splats)?splats:[],ranked=[];let hiddenLowConfidence=0,hiddenUnverified=0,hiddenUnknownConfidence=0;
  for(const g of input){
    if(!g)continue;const c=surfaceConfidence(g);if(c==null){hiddenUnknownConfidence++;continue;}
    const support=Math.max(0,Number(g.support)||0),independent=Math.max(0,Number(g.independentSupport)||0),weak=g.evidenceClass==='weak'||g.evidenceClass==='candidate',floor=weak?Math.max(.56,minConfidence):minConfidence;
    if(c<floor){hiddenLowConfidence++;continue;}
    const verified=!!g.globalConsensusVerified||!!g.finalPoseValidated&&(independent>=2||support>=3||g.mixedEvidence||g.evidenceClass==='strong');
    if(!verified){hiddenUnverified++;continue;}ranked.push({g,rank:surfaceRank(g,c)});
  }
  ranked.sort((a,b)=>b.rank-a.rank);if(Number.isFinite(max)&&ranked.length>max)ranked.length=Math.max(0,max|0);const kept=ranked.map(x=>x.g);
  return {splats:kept,stats:{input:input.length,meshing:kept.length,hidden:Math.max(0,input.length-kept.length),hiddenLowConfidence,hiddenUnverified,hiddenUnknownConfidence,minConfidence}};
}

export function surfaceConfidence(g){for(const v of [g?.confidence,g?.probability,g?.posteriorConfidence]){const x=Number(v);if(Number.isFinite(x))return clamp(x,0,1);}return null;}
function surfaceRank(g,c){const support=Math.min(8,Math.max(0,Number(g?.support)||0)),independent=Math.min(6,Math.max(0,Number(g?.independentSupport)||0)),validated=g?.finalPoseValidated?1:0,mixed=g?.mixedEvidence?1:0,strong=g?.evidenceClass==='strong'?1:0,global=g?.globalConsensusVerified?1:0;return c*3.2+.18*support+.32*independent+.42*validated+.28*mixed+.24*strong+.45*global;}
function quantile(a,q){if(!a.length)return null;const b=a.slice().sort((x,y)=>x-y),x=clamp(q,0,1)*(b.length-1),i=Math.floor(x),t=x-i;return b[i]*(1-t)+b[Math.min(b.length-1,i+1)]*t;}
