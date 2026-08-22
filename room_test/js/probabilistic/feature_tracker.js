import {qConj,qRotate} from '../slam/math.js';

/**
 * Probabilistic feature association for dense mapping.
 *
 * Alva points define excellent candidate locations, but descriptor identity is
 * not assumed. We combine a deterministic binary patch descriptor, epipolar
 * distance from the Alva pose prior, local ZNCC, mutual uniqueness and feature
 * quality into a probability. Nothing becomes an irreversible boolean match;
 * low-confidence hypotheses may be retained for post-scan re-estimation.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const PAIRS=makePairs(128,6);

export function matchProbabilisticFeatures(ref,src,{maxFeatures=420,maxMatches=220,maxEpipolarPx=4.0,maxHamming=54,minProbability=.035,patchRadius=3}={}){
  if(!ref?.K||!src?.K||!ref?.pose||!src?.pose)return [];
  const A=rankFeatures(ref.features,maxFeatures),B=rankFeatures(src.features,maxFeatures);
  // Legacy/synthetic frames can carry descriptors without an image pyramid.
  // Keep those hypotheses probabilistic rather than silently dropping every
  // match; production frames still take the stronger BRIEF+ZNCC path below.
  if(!ref?.gray||!src?.gray)return descriptorOnlyFallback(ref,src,A,B,{maxMatches,maxEpipolarPx,minProbability});
  const ad=A.map(f=>brief(ref.gray,ref.width,ref.height,f.x,f.y)),bd=B.map(f=>brief(src.gray,src.width,src.height,f.x,f.y));
  const bestA=new Array(A.length),bestB=new Array(B.length);
  for(let i=0;i<A.length;i++){
    let best=null,second=null;
    for(let j=0;j<B.length;j++){
      if(!ad[i]||!bd[j])continue;
      const epi=epipolarDistancePx(ref,src,A[i],B[j]);if(!Number.isFinite(epi)||epi>maxEpipolarPx)continue;
      const ham=hamming128(ad[i],bd[j]);if(ham>maxHamming)continue;
      const zn=patchZncc(ref.gray,ref.width,ref.height,A[i].x,A[i].y,src.gray,src.width,src.height,B[j].x,B[j].y,patchRadius);
      const score=ham/128+.13*Math.min(1,epi/maxEpipolarPx)+.20*(1-zn)*.5;
      const item={i,j,ham,epi,zn,score};
      if(!best||score<best.score){second=best;best=item;}else if(!second||score<second.score)second=item;
    }
    if(best){best.ratio=second?best.score/Math.max(1e-6,second.score):0;bestA[i]=best;}
  }
  for(let j=0;j<B.length;j++){
    let best=null;
    for(let i=0;i<A.length;i++){const x=bestA[i];if(!x||x.j!==j)continue;if(!best||x.score<best.score)best=x;}
    if(best)bestB[j]=best;
  }
  const out=[];
  for(let i=0;i<A.length;i++){
    const x=bestA[i];if(!x||bestB[x.j]!==x)continue;
    const descP=sigmoid((46-x.ham)/7),epiP=Math.exp(-.5*(x.epi/1.8)**2),photoP=clamp((x.zn+.15)/1.15,0,1),uniqueP=clamp((.94-x.ratio)/.34,0,1);
    const qA=featureQuality(A[i]),qB=featureQuality(B[x.j]);
    // Geometric mean avoids one strong cue hiding a catastrophic cue.
    const p=Math.pow(Math.max(1e-6,descP*epiP*photoP*uniqueP*qA*qB),1/6);
    if(p<minProbability)continue;
    out.push({i:A[i].index,j:B[x.j].index,probability:p,descriptorProbability:descP,epipolarProbability:epiP,photometricProbability:photoP,uniquenessProbability:uniqueP,epipolarPx:x.epi,hamming:x.ham,zncc:x.zn,ratio:x.ratio});
  }
  return out.sort((a,b)=>b.probability-a.probability).slice(0,maxMatches);
}

export function epipolarDistancePx(ref,src,a,b){
  const x1=[(a.x-ref.K.cx)/ref.K.fx,(a.y-ref.K.cy)/ref.K.fy,1],x2=[(b.x-src.K.cx)/src.K.fx,(b.y-src.K.cy)/src.K.fy,1];
  // Relative transform from reference camera coordinates to source camera:
  // X_s = R_s^T R_r X_r + R_s^T(C_r-C_s).
  const qi=qConj(src.pose.q),r=qRotate(qi,qRotate(ref.pose.q,x1)),cw=[ref.pose.p[0]-src.pose.p[0],ref.pose.p[1]-src.pose.p[1],ref.pose.p[2]-src.pose.p[2]],t=qRotate(qi,cw);
  const l=cross(t,r),den=Math.hypot(l[0],l[1]);if(den<1e-9)return Infinity;
  const dn=Math.abs(x2[0]*l[0]+x2[1]*l[1]+l[2])/den;
  return dn*.5*(Math.abs(src.K.fx)+Math.abs(src.K.fy));
}

export function patchZncc(A,aw,ah,ax,ay,B,bw,bh,bx,by,r=3){
  ax=Math.round(ax);ay=Math.round(ay);bx=Math.round(bx);by=Math.round(by);if(ax-r<0||ay-r<0||ax+r>=aw||ay+r>=ah||bx-r<0||by-r<0||bx+r>=bw||by+r>=bh)return -1;
  let ma=0,mb=0,n=0;for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++){ma+=A[(ay+y)*aw+ax+x];mb+=B[(by+y)*bw+bx+x];n++;}ma/=n;mb/=n;
  let aa=0,bb=0,ab=0;for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++){const da=A[(ay+y)*aw+ax+x]-ma,db=B[(by+y)*bw+bx+x]-mb;aa+=da*da;bb+=db*db;ab+=da*db;}return aa>1&&bb>1?clamp(ab/Math.sqrt(aa*bb),-1,1):-1;
}

export function briefDescriptor(gray,w,h,x,y){return brief(gray,w,h,x,y);}
export function hammingDescriptor(a,b){return hamming128(a,b);}


function descriptorOnlyFallback(ref,src,A,B,{maxMatches,maxEpipolarPx,minProbability}){
  const bestA=new Array(A.length),bestB=new Array(B.length);
  for(let i=0;i<A.length;i++){
    const da=A[i]?.desc;if(!da?.length)continue;let best=null,second=null;
    for(let j=0;j<B.length;j++){
      const db=B[j]?.desc;if(!db?.length)continue;const epi=epipolarDistancePx(ref,src,A[i],B[j]);if(!Number.isFinite(epi)||epi>maxEpipolarPx)continue;
      let d=0,n=Math.min(da.length,db.length);for(let k=0;k<n;k++)d+=Math.abs(Number(da[k]||0)-Number(db[k]||0));d/=Math.max(1,n);
      const score=d+.08*Math.min(1,epi/maxEpipolarPx),item={i,j,d,epi,score};
      if(!best||score<best.score){second=best;best=item;}else if(!second||score<second.score)second=item;
    }
    if(best){best.ratio=second?best.score/Math.max(1e-6,second.score):0;bestA[i]=best;}
  }
  for(let j=0;j<B.length;j++){let best=null;for(let i=0;i<A.length;i++){const x=bestA[i];if(!x||x.j!==j)continue;if(!best||x.score<best.score)best=x;}if(best)bestB[j]=best;}
  const out=[];
  for(let i=0;i<A.length;i++){
    const x=bestA[i];if(!x||bestB[x.j]!==x)continue;
    const descP=Math.exp(-Math.max(0,x.d)/Math.max(1,18)),epiP=Math.exp(-.5*(x.epi/1.8)**2),uniqueP=clamp((.94-x.ratio)/.34,0,1),qA=featureQuality(A[i]),qB=featureQuality(B[x.j]);
    const p=Math.pow(Math.max(1e-6,descP*epiP*uniqueP*qA*qB*.60),1/6);if(p<minProbability)continue;
    out.push({i:A[i].index,j:B[x.j].index,probability:p,descriptorProbability:descP,epipolarProbability:epiP,photometricProbability:.60,uniquenessProbability:uniqueP,epipolarPx:x.epi,hamming:null,zncc:null,ratio:x.ratio,legacyDescriptorOnly:true});
  }
  return out.sort((a,b)=>b.probability-a.probability).slice(0,maxMatches);
}

function rankFeatures(fs,max){return (fs||[]).map((f,index)=>({...f,index})).filter(f=>Number.isFinite(f.x)&&Number.isFinite(f.y)).sort((a,b)=>(b.source==='alva-track')-(a.source==='alva-track')||(+b.score||0)-(+a.score||0)).slice(0,max);}
function featureQuality(f){const s=+f.score||0;return clamp(.58+.30*Math.tanh(s/20)+(f.source==='alva-track'?.12:0),.25,1);}
function brief(gray,w,h,x,y){x=Math.round(x);y=Math.round(y);if(x<7||y<7||x>=w-7||y>=h-7)return null;const out=new Uint32Array(4);for(let k=0;k<128;k++){const p=PAIRS[k],a=gray[(y+p[1])*w+x+p[0]],b=gray[(y+p[3])*w+x+p[2]];if(a<b)out[k>>>5]|=(1<<(k&31))>>>0;}return out;}
function hamming128(a,b){let n=0;for(let i=0;i<4;i++)n+=popcnt((a[i]^b[i])>>>0);return n;}
function popcnt(x){x=x-((x>>>1)&0x55555555);x=(x&0x33333333)+((x>>>2)&0x33333333);return (((x+(x>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
function makePairs(n,r){let s=0x6d2b79f5>>>0,out=[];const rnd=()=>{s=(Math.imul(s^s>>>15,1|s)+(s^Math.imul(s^s>>>7,61|s)))^s;s^=s>>>14;return (s>>>0)/4294967296;};for(let i=0;i<n;i++){let a,b,c,d;do{a=Math.round((rnd()*2-1)*r);b=Math.round((rnd()*2-1)*r);c=Math.round((rnd()*2-1)*r);d=Math.round((rnd()*2-1)*r);}while(a===c&&b===d);out.push([a,b,c,d]);}return out;}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function sigmoid(x){return 1/(1+Math.exp(-x));}
