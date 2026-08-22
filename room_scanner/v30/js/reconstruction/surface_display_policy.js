/**
 * Surface evidence policy for rendering and TSDF input.
 *
 * IMPORTANT: this module never deletes evidence from the probabilistic graph.
 * It only decides which already-fused splats are useful to DISPLAY or to feed
 * into the visual mesh. Low-confidence splats remain available to diagnostics
 * and to later optimisation/rebuild passes.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function filterSurfaceSplatsForDisplay(splats,{mode='review',max=Infinity,minConfidence=null}={}){
  const input=Array.isArray(splats)?splats:[],base=minConfidence!=null&&Number.isFinite(Number(minConfidence))?Number(minConfidence):(mode==='candidate'?.30:mode==='live'?.28:.26),ranked=[];let hiddenLowConfidence=0,hiddenWeak=0,unknownConfidence=0;
  for(const g of input){
    if(!g)continue;const c=surfaceConfidence(g);if(c==null){unknownConfidence++;ranked.push({g,c:1,rank:surfaceRank(g,1)});continue;}
    const support=Math.max(0,Number(g.support)||0),independent=Math.max(0,Number(g.independentSupport)||0),strong=g.evidenceClass==='strong'||independent>=3||support>=5,weak=g.evidenceClass==='weak';
    const floor=weak?Math.max(base,.40):base,protectedStrong=strong&&c>=floor*.82;
    if(c<floor&&!protectedStrong){hiddenLowConfidence++;if(weak)hiddenWeak++;continue;}
    ranked.push({g,c,rank:surfaceRank(g,c)});
  }
  ranked.sort((a,b)=>b.rank-a.rank);if(Number.isFinite(max)&&ranked.length>max)ranked.length=Math.max(0,max|0);
  const kept=ranked.map(x=>x.g),known=ranked.map(x=>x.c).filter(Number.isFinite);
  return {splats:kept,stats:{input:input.length,visible:kept.length,hidden:Math.max(0,input.length-kept.length),hiddenLowConfidence,hiddenWeak,unknownConfidence,minConfidence:base,visibleConfidenceMedian:quantile(known,.5),visibleConfidenceP10:quantile(known,.1),mode}};
}

export function filterSurfaceSplatsForMeshing(splats,{minConfidence=.24,max=Infinity}={}){
  const input=Array.isArray(splats)?splats:[],ranked=[];let hiddenLowConfidence=0,hiddenUnverified=0;
  for(const g of input){
    if(!g)continue;const c=surfaceConfidence(g);if(c==null){ranked.push({g,rank:surfaceRank(g,1)});continue;}
    const support=Math.max(0,Number(g.support)||0),independent=Math.max(0,Number(g.independentSupport)||0),weak=g.evidenceClass==='weak',floor=weak?Math.max(.34,minConfidence):minConfidence;
    if(c<floor){hiddenLowConfidence++;continue;}
    // A single weak observation may be useful diagnostically, but should not
    // generate a TSDF island. Strong/mixed evidence is allowed through.
    const verified=!!g.finalPoseValidated||independent>=2||support>=3||g.mixedEvidence||g.evidenceClass==='strong';
    if(!verified){hiddenUnverified++;continue;}
    ranked.push({g,rank:surfaceRank(g,c)});
  }
  ranked.sort((a,b)=>b.rank-a.rank);if(Number.isFinite(max)&&ranked.length>max)ranked.length=Math.max(0,max|0);
  const kept=ranked.map(x=>x.g);
  return {splats:kept,stats:{input:input.length,meshing:kept.length,hidden:Math.max(0,input.length-kept.length),hiddenLowConfidence,hiddenUnverified,minConfidence}};
}

export function surfaceConfidence(g){
  const values=[g?.confidence,g?.probability,g?.posteriorConfidence].map(Number).filter(Number.isFinite);
  if(!values.length)return null;return clamp(values[0],0,1);
}

function surfaceRank(g,c){const support=Math.min(8,Math.max(0,Number(g?.support)||0)),independent=Math.min(6,Math.max(0,Number(g?.independentSupport)||0)),validated=g?.finalPoseValidated?1:0,mixed=g?.mixedEvidence?1:0,strong=g?.evidenceClass==='strong'?1:0;return c*3+.20*support+.30*independent+.45*validated+.30*mixed+.25*strong;}
function quantile(a,q){if(!a.length)return null;const b=a.slice().sort((x,y)=>x-y),x=clamp(q,0,1)*(b.length-1),i=Math.floor(x),t=x-i;return b[i]*(1-t)+b[Math.min(b.length-1,i+1)]*t;}
