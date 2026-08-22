/**
 * Estimate RGB-only translation DIRECTION from pair matches and a visual
 * relative rotation. Magnitude remains unobservable monocularly and is never
 * fabricated here. Direction is expressed in camera-A coordinates.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DEG=Math.PI/180;

export function estimatePhotoTranslationDirection(edge,frameA,frameB,{minMatches=8,minMedianParallaxRad=.18*DEG,minConfidence=.08}={}){
  if(!edge||!frameA?.K||!frameB?.K||!Array.isArray(edge.rotationBToA)||edge.rotationBToA.length!==9)return null;
  const rows=[];for(const m of edge.matches||[]){if(!Number.isFinite(+m.aU)||!Number.isFinite(+m.aV)||!Number.isFinite(+m.bU)||!Number.isFinite(+m.bV))continue;const a=ray(frameA.K,+m.aU,+m.aV),b=matVec(edge.rotationBToA,ray(frameB.K,+m.bU,+m.bV)),c=cross(b,a),cn=Math.hypot(...c);if(cn<1e-6)continue;const w=clamp(Number(m.probability??.5),.03,1)*clamp(Number(m.photometricProbability??1),.05,1),ang=Math.acos(clamp(dot(a,b),-1,1));rows.push({c:c.map(x=>x/cn),w,ang});}
  if(rows.length<minMatches)return null;const M=new Float64Array(9);for(const r of rows){const c=r.c,w=r.w;for(let i=0;i<3;i++)for(let j=0;j<3;j++)M[i*3+j]+=w*c[i]*c[j];}
  const eig=eigenSymmetric3(M),order=[0,1,2].sort((i,j)=>eig.values[i]-eig.values[j]),i0=order[0],i1=order[1],i2=order[2],vals=order.map(i=>eig.values[i]),dir=normalize([eig.vectors[0][i0],eig.vectors[1][i0],eig.vectors[2][i0]]),medianParallaxRad=median(rows.map(r=>r.ang));
  if(!Number.isFinite(medianParallaxRad)||medianParallaxRad<minMedianParallaxRad)return null;
  const nullGap=clamp((vals[1]-vals[0])/Math.max(1e-9,Math.abs(vals[1])+Math.abs(vals[0])),0,1),support=clamp((rows.length-minMatches+1)/18,.08,1),parallaxQ=clamp(medianParallaxRad/(1.2*DEG),.05,1),confidence=clamp(nullGap*(.35+.65*support)*(.25+.75*parallaxQ),0,1);
  if(confidence<minConfidence)return null;
  const prior=relativeTranslation(frameA.poseEstimate||frameA.posePrior,frameB.poseEstimate||frameB.posePrior);if(Math.hypot(...prior)>1e-6&&dot(dir,prior)<0)for(let k=0;k<3;k++)dir[k]*=-1;
  return {direction:dir,confidence,medianParallaxRad,matchesUsed:rows.length,eigenvalues:vals,nullGap};
}

function ray(K,u,v){return normalize([(u-K.cx)/Math.max(1e-9,K.fx),(v-K.cy)/Math.max(1e-9,K.fy),1]);}
function matVec(R,v){return normalize([R[0]*v[0]+R[1]*v[1]+R[2]*v[2],R[3]*v[0]+R[4]*v[1]+R[5]*v[2],R[6]*v[0]+R[7]*v[1]+R[8]*v[2]]);}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
function relativeTranslation(a,b){if(!a?.p||!b?.p||!a?.q)return [0,0,0];return qRotate(qConj(a.q),[b.p[0]-a.p[0],b.p[1]-a.p[1],b.p[2]-a.p[2]]);}
function qConj(q){return [-q[0],-q[1],-q[2],q[3]];}
function qRotate(q,v){const n=Math.hypot(...q)||1,x=q[0]/n,y=q[1]/n,z=q[2]/n,w=q[3]/n,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];}

function eigenSymmetric3(A){
  const a=[[A[0],A[1],A[2]],[A[3],A[4],A[5]],[A[6],A[7],A[8]]],V=[[1,0,0],[0,1,0],[0,0,1]];
  for(let it=0;it<18;it++){let p=0,q=1,m=Math.abs(a[0][1]);for(const [i,j] of [[0,2],[1,2]])if(Math.abs(a[i][j])>m){p=i;q=j;m=Math.abs(a[i][j]);}if(m<1e-12)break;const phi=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(phi),s=Math.sin(phi);for(let k=0;k<3;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-s*aqk;a[q][k]=s*apk+c*aqk;}for(let k=0;k<3;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=c*akp-s*akq;a[k][q]=s*akp+c*akq;}for(let k=0;k<3;k++){const vkp=V[k][p],vkq=V[k][q];V[k][p]=c*vkp-s*vkq;V[k][q]=s*vkp+c*vkq;}}
  return {values:[a[0][0],a[1][1],a[2][2]],vectors:V};
}
