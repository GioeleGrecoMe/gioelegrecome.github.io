/*
 * V30.14 camera-only geometric MVS worker.
 *
 * Previous V30 builds initialised this worker but never sent it a keyframe pair;
 * even when called, the worker only forwarded already-3D points. V30.14 accepts
 * two calibrated metric keyframes, matches their feature descriptors off the UI
 * thread and triangulates actual 3-D points from the two camera rays.
 *
 * No monocular depth network is used. If geometry is weak (too little baseline,
 * insufficient parallax, bad ray intersection or depth out of range), the worker
 * rejects the pair instead of fabricating points.
 */
let cfg={near:.3,far:9,maxPoints:5200,minBaselineM:.03,maxBaselineM:1.25,minParallaxPx:2.0,maxRayGapM:.065,maxFeatures:620,ratio:.90,maxDescriptorDistance:900,maxEpipolarPx:2.2,maxReprojectionPx:4.0};

self.onmessage=e=>{
  const d=e.data||{};
  try{
    if(d.type==='init'){
      cfg={...cfg,...(d.config||{})};
      postMessage({type:'ready',config:cfg,mode:'two-view-metric-triangulation'});
      return;
    }
    if(d.type==='pair'){
      const result=processPair(d);
      postMessage(result);
      return;
    }
    // Compatibility path for callers that already own explicit metric 3-D data.
    if(d.type==='densify'||d.type==='process'||d.type==='points'){
      const src=d.points||d.triangulated||d.matches3d||[],out=[];
      for(const x of src){
        const p=x?.p||x?.position||x;
        if(!isPoint(p))continue;
        out.push({position:[+p[0],+p[1],+p[2]],color:x.color||x.rgb||[180,210,240],confidence:Number(x.confidence??1)});
        if(out.length>=cfg.maxPoints)break;
      }
      postMessage({type:'mvs-result',points:out,count:out.length,geometric:true,source:'explicit-3d'});
      return;
    }
    postMessage({type:'status',mode:'two-view-metric-triangulation'});
  }catch(err){
    postMessage({type:'mvs-error',message:err.message,stack:err.stack});
  }
};

function processPair(d){
  const A=d.a||{},B=d.b||{},K=d.K;
  if(!validPose(A.pose)||!validPose(B.pose)||!K)throw new Error('MVS pair missing calibrated pose/K');
  const baseline=distance(A.pose.p,B.pose.p);
  if(baseline<(d.minBaselineM??cfg.minBaselineM))return rejected('baseline-too-small',{baseline});
  if(baseline>(d.maxBaselineM??cfg.maxBaselineM))return rejected('baseline-too-large',{baseline});
  const fa=(A.features||[]).slice(0,cfg.maxFeatures),fb=(B.features||[]).slice(0,cfg.maxFeatures);
  if(fa.length<8||fb.length<8)return rejected('too-few-features',{baseline,featuresA:fa.length,featuresB:fb.length});
  // Camera poses are already available from AlvaAR/metric tracking, so use
  // them *before* triangulation to reject descriptor lookalikes that do not lie
  // on the corresponding epipolar line. This is much more important in rooms
  // with repeated edges (doors, tiles, shelves) than a descriptor ratio alone.
  const matches=matchFeatures(fa,fb,A.pose,B.pose,K);
  const points=[];
  let triangulated=0,rejectedDepth=0,rejectedGeometry=0,rejectedParallax=0;
  for(const m of matches){
    const a=fa[m.a],b=fb[m.b];
    const parallaxPx=Math.hypot(b.x-a.x,b.y-a.y);
    if(parallaxPx<cfg.minParallaxPx){rejectedParallax++;continue;}
    const t=triangulate({pose:A.pose,K,u:a.x,v:a.y},{pose:B.pose,K,u:b.x,v:b.y});
    if(!t.ok){rejectedGeometry++;continue;}
    triangulated++;
    const za=project(A.pose,K,t.p),zb=project(B.pose,K,t.p);
    if(!za||!zb||za.z<cfg.near||za.z>cfg.far||zb.z<cfg.near||zb.z>cfg.far){rejectedDepth++;continue;}
    const reproj=Math.hypot(za.u-a.x,za.v-a.y)+Math.hypot(zb.u-b.x,zb.v-b.y);
    if(reproj>cfg.maxReprojectionPx){rejectedGeometry++;continue;}
    const color=sampleColor(B.rgba,B.width||K.width,B.height||K.height,b.x,b.y);
    const descriptorQ=clamp(1-m.distance/Math.max(1,cfg.maxDescriptorDistance),0,1);
    const epipolarQ=clamp(1-(m.epipolarPx||0)/Math.max(.25,cfg.maxEpipolarPx),0,1);
    const rayQ=clamp(1-t.gap/Math.max(.001,cfg.maxRayGapM),0,1);
    const reprojQ=clamp(1-reproj/Math.max(.5,cfg.maxReprojectionPx),0,1);
    const parallaxQ=clamp((parallaxPx-cfg.minParallaxPx)/10,0,1);
    const confidence=clamp(.24*descriptorQ+.24*epipolarQ+.24*rayQ+.16*reprojQ+.12*parallaxQ,.05,1);
    points.push({position:t.p,color,confidence,epipolarPx:m.epipolarPx,reprojectionPx:reproj,scale:[Math.max(.007,za.z/Math.max(1,K.fx)*1.8),Math.max(.007,za.z/Math.max(1,K.fy)*1.8),Math.max(.009,t.gap+.009)]});
    if(points.length>=cfg.maxPoints)break;
  }
  return {type:'mvs-result',points,count:points.length,geometric:true,source:'two-view-triangulation',baseline,matches:matches.length,triangulated,rejectedDepth,rejectedGeometry,rejectedParallax};
}

function rejected(reason,extra={}){return {type:'mvs-result',points:[],count:0,geometric:true,rejected:true,reason,...extra};}
function isPoint(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}
function validPose(p){return p?.p?.length>=3&&p?.q?.length>=4&&p.p.every(Number.isFinite)&&p.q.every(Number.isFinite);}
function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function descDistance(a,b){
  const A=a||[],B=b||[];if(!A.length||A.length!==B.length)return Infinity;
  // Subtract each descriptor mean so moderate exposure changes do not destroy
  // matches. The descriptor itself remains tiny enough for phone/worker use.
  let ma=0,mb=0;for(let i=0;i<A.length;i++){ma+=Number(A[i]);mb+=Number(B[i]);}ma/=A.length;mb/=B.length;
  let s=0;for(let i=0;i<A.length;i++)s+=Math.abs((Number(A[i])-ma)-(Number(B[i])-mb));return s;
}
function matchFeatures(a,b,poseA,poseB,K){
  const provisional=[];
  for(let i=0;i<a.length;i++){
    let best=-1,bd=Infinity,second=Infinity,bepi=Infinity;
    for(let j=0;j<b.length;j++){
      const epi=epipolarErrorPx(poseA,poseB,K,a[i],b[j]);
      if(!Number.isFinite(epi)||epi>cfg.maxEpipolarPx)continue;
      const d=descDistance(a[i].desc,b[j].desc);
      if(d<bd){second=bd;bd=d;best=j;bepi=epi;}else if(d<second)second=d;
    }
    if(best>=0&&bd<cfg.maxDescriptorDistance&&(second===Infinity||bd<second*cfg.ratio))provisional.push({a:i,b:best,distance:bd,epipolarPx:bepi});
  }
  // Mutual-best check removes many repeated-texture correspondences cheaply.
  const bestAForB=new Map();
  for(const m of provisional){const old=bestAForB.get(m.b);if(!old||m.distance<old.distance)bestAForB.set(m.b,m);}
  return [...bestAForB.values()].sort((x,y)=>(x.distance+.25*x.epipolarPx)-(y.distance+.25*y.epipolarPx));
}
function epipolarErrorPx(poseA,poseB,K,a,b){
  if(!validPose(poseA)||!validPose(poseB))return 0;
  const qi=qConj(qNormalize(poseB.q)),qrel=qMul(qi,qNormalize(poseA.q)),R=qMat3(qrel),t=qRotate(qi,sub(poseA.p,poseB.p));
  if(Math.hypot(...t)<1e-7)return 0;
  const E=skewMulR(t,R),xa=[(a.x-K.cx)/K.fx,(K.cy-a.y)/K.fy,1],xb=[(b.x-K.cx)/K.fx,(K.cy-b.y)/K.fy,1];
  const lb=matVec(E,xa),Et=transpose3(E),la=matVec(Et,xb),num=Math.abs(dot(xb,lb)),db=Math.hypot(lb[0],lb[1]),da=Math.hypot(la[0],la[1]);
  if(db<1e-10||da<1e-10)return Infinity;
  const norm=.5*(num/db+num/da),f=.5*(Math.abs(K.fx)+Math.abs(K.fy));return norm*f;
}
function qMul(a,b){const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;return [aw*bx+ax*bw+ay*bz-az*by,aw*by-ax*bz+ay*bw+az*bx,aw*bz+ax*by-ay*bx+az*bw,aw*bw-ax*bx-ay*by-az*bz];}
function qMat3(q){const [x,y,z,w]=qNormalize(q),xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];}
function skewMulR(t,R){const [x,y,z]=t,S=[0,-z,y,z,0,-x,-y,x,0],E=new Array(9).fill(0);for(let r=0;r<3;r++)for(let c=0;c<3;c++)for(let k=0;k<3;k++)E[r*3+c]+=S[r*3+k]*R[k*3+c];return E;}
function matVec(M,v){return [M[0]*v[0]+M[1]*v[1]+M[2]*v[2],M[3]*v[0]+M[4]*v[1]+M[5]*v[2],M[6]*v[0]+M[7]*v[1]+M[8]*v[2]];}
function transpose3(M){return [M[0],M[3],M[6],M[1],M[4],M[7],M[2],M[5],M[8]];}

function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(v=>v/n);}
function qConj(q){return [-q[0],-q[1],-q[2],q[3]];}
function qRotate(q,v){const [x,y,z,w]=qNormalize(q),[vx,vy,vz]=v,tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function mul(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
function pixelRay(K,u,v){const d=[(u-K.cx)/K.fx,(K.cy-v)/K.fy,1],n=Math.hypot(...d)||1;return d.map(x=>x/n);}
function worldRay(obs){return {o:[...obs.pose.p],d:qRotate(obs.pose.q,pixelRay(obs.K,obs.u,obs.v))};}
function triangulate(a,b){
  const A=worldRay(a),B=worldRay(b),r=sub(A.o,B.o),aa=dot(A.d,A.d),bb=dot(A.d,B.d),cc=dot(B.d,B.d),dd=dot(A.d,r),ee=dot(B.d,r),den=aa*cc-bb*bb;
  if(Math.abs(den)<1e-9)return {ok:false};
  const s=(bb*ee-cc*dd)/den,t=(aa*ee-bb*dd)/den;
  if(s<=0||t<=0)return {ok:false};
  const pa=add(A.o,mul(A.d,s)),pb=add(B.o,mul(B.d,t)),gap=distance(pa,pb);
  if(gap>cfg.maxRayGapM)return {ok:false,gap};
  const ca=clamp(dot(A.d,B.d),-1,1),angle=Math.acos(ca);
  return {ok:true,p:mul(add(pa,pb),.5),gap,angle};
}
function project(pose,K,p){
  const qi=qConj(qNormalize(pose.q)),rel=[p[0]-pose.p[0],p[1]-pose.p[1],p[2]-pose.p[2]],c=qRotate(qi,rel);
  if(c[2]<=1e-6)return null;
  return {u:K.fx*c[0]/c[2]+K.cx,v:K.cy-K.fy*c[1]/c[2],z:c[2]};
}
function sampleColor(rgba,w,h,x,y){
  if(!rgba||rgba.length<w*h*4)return [180,210,240];
  const cx=clamp(Math.round(x),0,w-1),cy=clamp(Math.round(y),0,h-1);let r=0,g=0,b=0,n=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=clamp(cx+dx,0,w-1),yy=clamp(cy+dy,0,h-1),i=(yy*w+xx)*4;r+=Number(rgba[i]??180);g+=Number(rgba[i+1]??210);b+=Number(rgba[i+2]??240);n++;}
  return [Math.round(r/n),Math.round(g/n),Math.round(b/n)];
}
