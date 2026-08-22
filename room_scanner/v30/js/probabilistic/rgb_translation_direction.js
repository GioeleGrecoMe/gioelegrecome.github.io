/**
 * RGB-only monocular translation LINE from direct photo correspondences.
 *
 * Essential geometry observes span(t), not an oriented vector t.  Therefore
 * direction and -direction are exactly equivalent until cheirality is resolved
 * from independent geometry.  This module deliberately NEVER chooses the sign
 * from Alva/current pose: doing so makes the visual constraint self-confirm the
 * tracker it is supposed to test.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DEG=Math.PI/180;

export function estimatePhotoTranslationDirection(edge,frameA,frameB,{minMatches=8,minMedianParallaxRad=.30*DEG,minConfidence=.08,maxIrlsIterations=6}={}){
  if(!edge||!frameA?.K||!frameB?.K||!Array.isArray(edge.rotationBToA)||edge.rotationBToA.length!==9)return null;
  const rows=[];
  for(const m of edge.matches||[]){
    if(!Number.isFinite(+m.aU)||!Number.isFinite(+m.aV)||!Number.isFinite(+m.bU)||!Number.isFinite(+m.bV))continue;
    const a=ray(frameA.K,+m.aU,+m.aV),b=matVec(edge.rotationBToA,ray(frameB.K,+m.bU,+m.bV)),c=cross(b,a),cn=Math.hypot(...c);
    if(cn<1e-7)continue;
    const w=clamp(Number(m.probability??.5),.03,1)*clamp(Number(m.photometricProbability??1),.05,1),ang=Math.acos(clamp(dot(a,b),-1,1));
    rows.push({c:c.map(x=>x/cn),baseW:w,ang});
  }
  if(rows.length<minMatches)return null;

  // IRLS on the epipolar-plane residual asin(|n_i . t|).  A plain least-squares
  // nullspace is easily rotated by a minority of wrong direct matches.
  let weights=rows.map(r=>r.baseW),solution=robustInitialDirection(rows)||solveDirection(rows,weights),dir=solution?.dir;
  if(!dir)return null;
  let robustScaleRad=2*DEG,medianEpipolarResidualRad=Infinity,inlierFraction=0;
  for(let it=0;it<Math.max(1,maxIrlsIterations|0);it++){
    const residuals=rows.map(r=>Math.asin(clamp(Math.abs(dot(r.c,dir)),0,1))),med=median(residuals),mad=median(residuals.map(x=>Math.abs(x-med)));
    medianEpipolarResidualRad=med;robustScaleRad=Math.max(.20*DEG,1.4826*(Number.isFinite(mad)?mad:0),med*.45);
    const cutoff=Math.max(1.25*DEG,3.5*robustScaleRad);
    weights=rows.map((r,i)=>{const x=residuals[i]/Math.max(1e-9,cutoff);if(x>=1)return r.baseW*.015;const q=1-x*x;return r.baseW*Math.max(.015,q*q);});
    const next=solveDirection(rows,weights);if(!next?.dir)break;
    // The estimate is a line: align signs only for numerical convergence.
    if(dot(next.dir,dir)<0)next.dir=next.dir.map(x=>-x);
    const change=Math.acos(clamp(Math.abs(dot(next.dir,dir)),-1,1));dir=next.dir;solution=next;if(change<2e-5)break;
  }

  const residuals=rows.map(r=>Math.asin(clamp(Math.abs(dot(r.c,dir)),0,1))),inlierGate=Math.max(1.5*DEG,3.5*robustScaleRad),baseWeight=rows.reduce((s,r)=>s+r.baseW,0)||1,inlierWeight=rows.reduce((s,r,i)=>s+(residuals[i]<=inlierGate?r.baseW:0),0);
  inlierFraction=clamp(inlierWeight/baseWeight,0,1);medianEpipolarResidualRad=median(residuals);
  const medianParallaxRad=median(rows.map(r=>r.ang));
  if(!Number.isFinite(medianParallaxRad)||medianParallaxRad<minMedianParallaxRad)return null;

  const vals=solution?.values||[0,0,0],nullGap=clamp((vals[1]-vals[0])/Math.max(1e-9,Math.abs(vals[1])+Math.abs(vals[0])),0,1),support=clamp((rows.length-minMatches+1)/20,.08,1),parallaxQ=clamp(medianParallaxRad/(1.5*DEG),.05,1),residualQ=Math.exp(-.5*(medianEpipolarResidualRad/(1.35*DEG))**2),confidence=clamp(nullGap*(.25+.75*support)*(.20+.80*parallaxQ)*(.15+.85*inlierFraction)*residualQ,0,1);
  if(confidence<minConfidence)return null;

  // Canonical sign is ONLY for deterministic serialization/debugging. Consumers
  // must use lineAngle/abs(dot), never interpret this sign as physical cheirality.
  dir=canonicalLineSign(dir);
  return {direction:dir,confidence,medianParallaxRad,matchesUsed:rows.length,eigenvalues:vals,nullGap,inlierFraction,medianEpipolarResidualRad,robustScaleRad,unoriented:true};
}

/** Sign-invariant angular distance between two 3-D directions. */
export function translationLineAngle(a,b){
  const na=Math.hypot(...(a||[])),nb=Math.hypot(...(b||[]));if(!(na>1e-9&&nb>1e-9))return Infinity;
  return Math.acos(clamp(Math.abs((a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(na*nb)),0,1));
}

/** Return the representative of the unoriented line closest to reference. */
export function alignTranslationLine(direction,reference){
  const d=normalize(direction||[0,0,0]),r=normalize(reference||[0,0,0]);return dot(d,r)<0?d.map(x=>-x):d;
}

function robustInitialDirection(rows){
  // Deterministic RANSAC-like seed: the translation line is the intersection of
  // two epipolar planes.  Evaluate a bounded set of pair intersections and keep
  // the one supported by the majority before entering IRLS. This prevents a
  // coherent minority of gross matches from rotating the least-squares seed.
  const n=Math.min(16,rows.length),idx=[];for(let k=0;k<n;k++)idx.push(Math.min(rows.length-1,Math.floor(k*(rows.length-1)/Math.max(1,n-1))));let best=null;
  for(let a=0;a<idx.length;a++)for(let b=a+1;b<idx.length;b++){const ca=rows[idx[a]].c,cb=rows[idx[b]].c,cand=normalize(cross(ca,cb));if(Math.hypot(...cand)<.5)continue;const residuals=rows.map(r=>Math.asin(clamp(Math.abs(dot(r.c,cand)),0,1))),gate=1.5*DEG,total=rows.reduce((s,r)=>s+r.baseW,0)||1,inlier=rows.reduce((s,r,i)=>s+(residuals[i]<=gate?r.baseW:0),0)/total,trimmed=rows.reduce((s,r,i)=>s+r.baseW*Math.min(residuals[i],4*DEG),0)/total,score=inlier-.25*trimmed/(4*DEG);if(!best||score>best.score)best={dir:cand,score};}
  if(!best)return null;const seed=best.dir,weights=rows.map(r=>r.baseW*(Math.asin(clamp(Math.abs(dot(r.c,seed)),0,1))<=3*DEG?1:.03)),sol=solveDirection(rows,weights);return sol||{dir:seed,values:[0,1,1]};
}

function solveDirection(rows,weights){
  const M=new Float64Array(9);for(let n=0;n<rows.length;n++){const c=rows[n].c,w=Math.max(1e-8,Number(weights?.[n])||0);for(let i=0;i<3;i++)for(let j=0;j<3;j++)M[i*3+j]+=w*c[i]*c[j];}
  const eig=eigenSymmetric3(M),order=[0,1,2].sort((i,j)=>eig.values[i]-eig.values[j]),i0=order[0],vals=order.map(i=>eig.values[i]),dir=normalize([eig.vectors[0][i0],eig.vectors[1][i0],eig.vectors[2][i0]]);return Math.hypot(...dir)>.5?{dir,values:vals}:null;
}
function canonicalLineSign(v){const d=normalize(v),k=[0,1,2].sort((a,b)=>Math.abs(d[b])-Math.abs(d[a]))[0];return d[k]<0?d.map(x=>-x):d;}
function ray(K,u,v){return normalize([(u-K.cx)/Math.max(1e-9,K.fx),(v-K.cy)/Math.max(1e-9,K.fy),1]);}
function matVec(R,v){return normalize([R[0]*v[0]+R[1]*v[1]+R[2]*v[2],R[3]*v[0]+R[4]*v[1]+R[5]*v[2],R[6]*v[0]+R[7]*v[1]+R[8]*v[2]]);}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}

function eigenSymmetric3(A){
  const a=[[A[0],A[1],A[2]],[A[3],A[4],A[5]],[A[6],A[7],A[8]]],V=[[1,0,0],[0,1,0],[0,0,1]];
  for(let it=0;it<24;it++){let p=0,q=1,m=Math.abs(a[0][1]);for(const [i,j] of [[0,2],[1,2]])if(Math.abs(a[i][j])>m){p=i;q=j;m=Math.abs(a[i][j]);}if(m<1e-13)break;const phi=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(phi),s=Math.sin(phi);for(let k=0;k<3;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-s*aqk;a[q][k]=s*apk+c*aqk;}for(let k=0;k<3;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=c*akp-s*akq;a[k][q]=s*akp+c*akq;}for(let k=0;k<3;k++){const vkp=V[k][p],vkq=V[k][q];V[k][p]=c*vkp-s*vkq;V[k][q]=s*vkp+c*vkq;}}
  return {values:[a[0][0],a[1][1],a[2][2]],vectors:V};
}
