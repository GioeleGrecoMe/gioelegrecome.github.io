const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const EPS=1e-9;

/**
 * Lightweight two-hypothesis Bayesian depth fusion for the live panorama.
 *
 * A single weighted average is unsafe around occlusions: two valid views can
 * observe different surfaces along almost the same spherical ray.  Each atlas
 * pixel therefore keeps at most two Gaussian-like hypotheses. Compatible
 * observations tighten one hypothesis; incompatible observations start or vote
 * for the second one. The displayed depth is the MAP hypothesis, never the
 * arithmetic mean between two separated surfaces.
 */
export function createProbabilisticDepthAtlas(size){
  const n=Math.max(0,size|0);
  return {
    mean0:new Float32Array(n),precision0:new Float32Array(n),mass0:new Float32Array(n),
    mean1:new Float32Array(n),precision1:new Float32Array(n),mass1:new Float32Array(n)
  };
}

export function addDepthObservation(state,index,value,sigma,weight,{gate=2.8}={}){
  if(!state||index<0||index>=state.mean0.length||!Number.isFinite(value)||!(weight>0))return;
  sigma=clamp(Number(sigma)||.06,.004,.40);weight=clamp(Number(weight)||0,1e-5,4);
  const obsPrec=weight/(sigma*sigma+1e-5);
  if(!(state.mass0[index]>0)){setMode(state,0,index,value,obsPrec,weight);return;}
  const z0=modeDistance(state,0,index,value,sigma),z1=state.mass1[index]>0?modeDistance(state,1,index,value,sigma):Infinity;
  let mode=z0<=z1?0:1,z=Math.min(z0,z1);
  if(z<=gate){
    const robust=1/(1+Math.pow(z/2.15,4));
    updateMode(state,mode,index,value,obsPrec*robust,weight*robust);
  }else if(!(state.mass1[index]>0)){
    setMode(state,1,index,value,obsPrec,weight);
  }else{
    const s0=modeEvidence(state,0,index),s1=modeEvidence(state,1,index),weak=s0<=s1?0:1,weakScore=Math.min(s0,s1),newScore=weight/(sigma+.018);
    if(newScore>weakScore*1.12)setMode(state,weak,index,value,obsPrec,weight);
    else{
      // Keep a small amount of negative evidence so a repeatedly contradicted
      // mode eventually loses against a consistently observed surface.
      if(weak===0)state.mass0[index]*=.992;else state.mass1[index]*=.992;
    }
  }
  mergeIfCompatible(state,index);
  if(modeEvidence(state,1,index)>modeEvidence(state,0,index)*1.04)swapModes(state,index);
}

export function resolveProbabilisticDepthAtlas(state){
  const n=state?.mean0?.length||0,depth=new Float32Array(n),score=new Float32Array(n),sigma=new Float32Array(n),ambiguity=new Float32Array(n);
  depth.fill(NaN);sigma.fill(Infinity);
  for(let i=0;i<n;i++){
    if(!(state.mass0[i]>0))continue;
    const e0=modeEvidence(state,0,i),e1=state.mass1[i]>0?modeEvidence(state,1,i):0;
    const use1=e1>e0,mean=use1?state.mean1[i]:state.mean0[i],prec=use1?state.precision1[i]:state.precision0[i],mass=use1?state.mass1[i]:state.mass0[i],other=use1?e0:e1;
    depth[i]=mean;sigma[i]=Math.sqrt(1/Math.max(EPS,prec));
    const dominance=e0+e1>EPS?Math.abs(e0-e1)/(e0+e1):1;
    ambiguity[i]=1-dominance;
    score[i]=clamp((mass/(mass+.45))*(.25+.75*dominance)*Math.min(1,Math.sqrt(Math.max(0,prec))*.08),0,1.5);
    if(other>0&&Math.abs(state.mean0[i]-state.mean1[i])<Math.max(.012,2.0*Math.min(sigma[i],.08)))ambiguity[i]*=.35;
  }
  return {depth,score,sigma,ambiguity};
}

/** Half cosine ramp, zero at a source border and one in the interior. */
export function hann01(t){t=clamp(Number(t)||0,0,1);return .5-.5*Math.cos(Math.PI*t);}

/**
 * A Hann feather is applied only where another RGB-registered source overlaps.
 * Non-overlapped borders keep weight 1, so the window can never erase coverage.
 */
export function overlapHannWeight(u,v,width,height,overlapCount,{feather=.20,floor=.018}={}){
  if(!(overlapCount>1))return 1;
  const fw=Math.max(2,width*Math.max(.04,feather)),fh=Math.max(2,height*Math.max(.04,feather));
  const tx=Math.min(u,Math.max(0,width-1-u))/fw,ty=Math.min(v,Math.max(0,height-1-v))/fh;
  return Math.max(floor,hann01(tx)*hann01(ty));
}

function setMode(s,m,i,value,precision,mass){
  if(m===0){s.mean0[i]=value;s.precision0[i]=precision;s.mass0[i]=mass;}
  else{s.mean1[i]=value;s.precision1[i]=precision;s.mass1[i]=mass;}
}
function updateMode(s,m,i,value,precision,mass){
  if(!(precision>0))return;
  if(m===0){const p=s.precision0[i],np=p+precision;s.mean0[i]=(s.mean0[i]*p+value*precision)/Math.max(EPS,np);s.precision0[i]=Math.min(1e6,np);s.mass0[i]=Math.min(16,s.mass0[i]+mass);}
  else{const p=s.precision1[i],np=p+precision;s.mean1[i]=(s.mean1[i]*p+value*precision)/Math.max(EPS,np);s.precision1[i]=Math.min(1e6,np);s.mass1[i]=Math.min(16,s.mass1[i]+mass);}
}
function modeDistance(s,m,i,value,obsSigma){const mean=m===0?s.mean0[i]:s.mean1[i],prec=m===0?s.precision0[i]:s.precision1[i],modeSigma=Math.sqrt(1/Math.max(EPS,prec));return Math.abs(value-mean)/Math.max(.006,Math.hypot(obsSigma,modeSigma));}
function modeEvidence(s,m,i){const mass=m===0?s.mass0[i]:s.mass1[i],prec=m===0?s.precision0[i]:s.precision1[i];return mass>0?mass/(Math.sqrt(1/Math.max(EPS,prec))+.018):0;}
function mergeIfCompatible(s,i){
  if(!(s.mass0[i]>0&&s.mass1[i]>0))return;
  const sig0=Math.sqrt(1/Math.max(EPS,s.precision0[i])),sig1=Math.sqrt(1/Math.max(EPS,s.precision1[i]));
  if(Math.abs(s.mean0[i]-s.mean1[i])>Math.max(.010,1.65*Math.hypot(sig0,sig1)))return;
  const p0=s.precision0[i],p1=s.precision1[i],p=p0+p1;s.mean0[i]=(s.mean0[i]*p0+s.mean1[i]*p1)/Math.max(EPS,p);s.precision0[i]=Math.min(1e6,p);s.mass0[i]=Math.min(16,s.mass0[i]+s.mass1[i]);s.mean1[i]=0;s.precision1[i]=0;s.mass1[i]=0;
}
function swapModes(s,i){for(const [a,b] of [['mean0','mean1'],['precision0','precision1'],['mass0','mass1']]){const t=s[a][i];s[a][i]=s[b][i];s[b][i]=t;}}
