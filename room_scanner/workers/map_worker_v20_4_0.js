/*
 * Room Scanner V20.4 - dense point-Gaussian / ray evidence map worker.
 *
 * Design goal:
 *   Keep the metric information produced by WebXR instead of prematurely
 *   collapsing it into walls. Every voxel is an anisotropic Gaussian surfel
 *   whose mean/covariance/color/normal are updated as the user walks.
 *
 * Input depthBatch layout (10 float32 values per observation):
 *   x y z, nx ny nz, r g b, confidence
 *
 * Compatibility:
 *   This worker accepts the V20.2 messages (depthBatch, photoEvidence,
 *   markpoint, snapshot, finalize) and the plane messages introduced by the
 *   live V20.2.4 branch. Existing UI code can therefore keep consuming the
 *   returned `tiles`, while post-processing can additionally consume the
 *   `gaussian` payload attached to every observed tile.
 */
const CFG={
  voxel:.020,
  flatTile:.20,
  objectTile:.065,
  unknownTile:.105,
  edgeTile:.052,
  maxFrameRefs:8,
  maxViews:10,
  budget:125000,
  minConfirmViews:2,
  minConfirmSpanMs:650,
  deepWeight:.62,
  hitWeight:.28
};

let cells=new Map();
let planeCells=new Map();
let sessionId=null,totalPoints=0,rawRayCount=0,droppedPoints=0,batches=0,lastPrune=0;

self.onmessage=e=>{
  const m=e.data||{};
  try{
    if(m.type==='init')init(m);
    else if(m.type==='depthBatch')ingest(m);
    else if(m.type==='photoEvidence')photoEvidence(m);
    else if(m.type==='markpoint')markpoint(m);
    else if(m.type==='planes'||m.type==='planeBatch'||m.type==='planeEstimates')ingestPlanes(m);
    else if(m.type==='snapshot')snapshot(m);
    else if(m.type==='finalize')finalize(m);
    else if(m.type==='reset')reset();
  }catch(error){postMessage({type:'error',message:error.message,stack:error.stack});}
};

function init(m){
  sessionId=m.sessionId;
  // V20.2 profiles used smaller budgets. A modest multiplier preserves the
  // user's device selection while allowing a substantially denser map.
  const requested=Number(m.budget)||CFG.budget;
  CFG.budget=Math.max(60000,Math.min(260000,Math.round(requested)));
  cells=new Map();planeCells=new Map();totalPoints=0;rawRayCount=0;droppedPoints=0;batches=0;
  postMessage({type:'ready',sessionId,pointGaussians:true,rawRayEvidence:true,voxelM:CFG.voxel,budget:CFG.budget});
}

function key3(x,y,z,s=CFG.voxel){return `${Math.floor(x/s)},${Math.floor(y/s)},${Math.floor(z/s)}`;}

function makeCell(key,time){
  return {
    key,count:0,w:0,
    // Weighted first and second moments. Six cross terms are enough because
    // covariance matrices are symmetric.
    pos:[0,0,0],m2:[0,0,0,0,0,0],
    normal:[0,0,0],normal2:[0,0,0],
    rgb:[0,0,0],rgb2:[0,0,0],
    views:new Map(),frameRefs:new Map(),
    xrDepth:0,deepDepth:0,hitTest:0,planeSupport:0,
    firstSeen:time,lastSeen:time,curvature:0,markpointId:null
  };
}

function ingest(m){
  const a=new Float32Array(m.buffer),origin=m.viewOrigin||[0,0,0],viewKey=m.viewKey||key3(...origin,.20),source=m.source||'xr-depth',frameId=m.frameId||null,time=m.time||Date.now();
  batches++;rawRayCount+=Number(m.rayCount)||Math.floor(a.length/10);
  for(let i=0;i+9<a.length;i+=10){
    const x=a[i],y=a[i+1],z=a[i+2],nx=a[i+3],ny=a[i+4],nz=a[i+5],r=a[i+6],g=a[i+7],b=a[i+8],conf=a[i+9];
    if(!Number.isFinite(x+y+z)||!Number.isFinite(conf)||conf<=0)continue;
    const key=key3(x,y,z);let c=cells.get(key);if(!c){c=makeCell(key,time);cells.set(key,c);}
    // Deep data is useful but cannot overrule the metric XR map from a single
    // image. Multi-view Deep confirmations naturally increase its influence.
    const sourceScale=source==='deep'?CFG.deepWeight:(source==='hit-test'?CFG.hitWeight:1);
    const w=Math.max(.035,Math.min(1.6,conf))*sourceScale;
    c.count++;c.w+=w;c.lastSeen=time;c.firstSeen=Math.min(c.firstSeen,time);
    c.pos[0]+=x*w;c.pos[1]+=y*w;c.pos[2]+=z*w;
    c.m2[0]+=x*x*w;c.m2[1]+=x*y*w;c.m2[2]+=x*z*w;c.m2[3]+=y*y*w;c.m2[4]+=y*z*w;c.m2[5]+=z*z*w;
    c.normal[0]+=nx*w;c.normal[1]+=ny*w;c.normal[2]+=nz*w;
    c.normal2[0]+=nx*nx*w;c.normal2[1]+=ny*ny*w;c.normal2[2]+=nz*nz*w;
    c.rgb[0]+=r*w;c.rgb[1]+=g*w;c.rgb[2]+=b*w;
    c.rgb2[0]+=r*r*w;c.rgb2[1]+=g*g*w;c.rgb2[2]+=b*b*w;
    if(source==='xr-depth'||source==='xr-depth-cpu'||source==='xr-depth-gpu')c.xrDepth++;
    else if(source==='deep')c.deepDepth++;
    else c.hitTest++;
    const prev=c.views.get(viewKey);if(!prev)c.views.set(viewKey,{origin:[...origin],count:1,last:time});else{prev.count++;prev.last=time;}
    trimMap(c.views,CFG.maxViews,(a,b)=>b[1].last-a[1].last);
    if(frameId)addFrameRef(c,{id:frameId,count:1,sharpness:m.sharpness||0,exposure:m.exposure||0,uv:m.uv||null});
    totalPoints++;
  }
  if(cells.size>CFG.budget&&Date.now()-lastPrune>550){prune();lastPrune=Date.now();}
  if(batches%5===0)postMessage({type:'stats',cells:cells.size,planeCells:planeCells.size,totalPoints,rawRayCount,droppedPoints,batches,budget:CFG.budget});
}

function addFrameRef(c,f){
  const old=c.frameRefs.get(f.id)||{id:f.id,count:0,sharpness:0,exposure:0,uv:null,rgb:null};
  old.count+=(f.count||1);old.sharpness=Math.max(old.sharpness,f.sharpness||0);old.exposure=Math.max(old.exposure,f.exposure||0);if(f.uv)old.uv=f.uv;if(f.rgb)old.rgb=f.rgb;
  c.frameRefs.set(f.id,old);trimMap(c.frameRefs,CFG.maxFrameRefs,(a,b)=>frameRefScore(b[1])-frameRefScore(a[1]));
}
function frameRefScore(f){return f.count+.8*(f.sharpness||0)+.45*(f.exposure||0);}

function photoEvidence(m){
  for(const hit of m.hits||[]){
    const c=cells.get(hit.key)||cells.get(String(hit.tileId||''));if(!c)continue;
    addFrameRef(c,{id:m.frameId,count:1,sharpness:m.sharpness||0,exposure:m.exposure||0,uv:hit.uv||null,rgb:hit.rgb||null});
    // If capture supplies an RGB patch for the tile, gently recolor the
    // Gaussian without pretending that a 2-D image is new metric geometry.
    if(hit.rgb?.length>=3){const w=.16;for(let k=0;k<3;k++){c.rgb[k]+=hit.rgb[k]*w;c.rgb2[k]+=hit.rgb[k]*hit.rgb[k]*w;}c.w+=w;}
  }
}

function markpoint(m){
  const key=m.cellKey||key3(...m.position);let c=cells.get(key);if(!c){c=makeCell(key,Date.now());cells.set(key,c);}
  c.markpointId=m.markpointId;c.curvature=1;c.count=Math.max(1,c.count);if(c.w<1){c.w=1;c.pos=[...m.position];c.m2=[m.position[0]**2,m.position[0]*m.position[1],m.position[0]*m.position[2],m.position[1]**2,m.position[1]*m.position[2],m.position[2]**2];c.normal=[0,1,0];c.normal2=[0,1,0];c.rgb=[255,0,255];c.rgb2=[65025,0,65025];}
}

// Plane detection is useful as a topological/coverage hint but never replaces
// dense observations. We tessellate detected planes into low-authority cells.
function ingestPlanes(m){
  const list=m.planes||m.items||m.estimates||[];const time=m.time||Date.now();
  for(const p of list){
    const normal=normalize(p.normal||p.orientation?.normal||[0,1,0]);
    const polygon=p.polygon||p.vertices||p.boundary||[];
    const kind=p.kind||p.type||classifyNormal(normal);
    if(polygon.length>=3){
      const pts=polygon.map(v=>Array.isArray(v)?v:(v.position||[v.x,v.y,v.z])).filter(v=>v?.length>=3&&v.every(Number.isFinite));
      if(pts.length<3)continue;
      const center=pts.reduce((a,v)=>[a[0]+v[0]/pts.length,a[1]+v[1]/pts.length,a[2]+v[2]/pts.length],[0,0,0]);
      let u=normalize(sub(pts[1],pts[0]));if(Math.hypot(...u)<.5)u=orthogonal(normal);let v=normalize(cross(normal,u));if(Math.hypot(...v)<.5)v=orthogonal(u);
      const uv=pts.map(q=>[dot(sub(q,center),u),dot(sub(q,center),v)]),minU=Math.min(...uv.map(q=>q[0])),maxU=Math.max(...uv.map(q=>q[0])),minV=Math.min(...uv.map(q=>q[1])),maxV=Math.max(...uv.map(q=>q[1]));
      const step=kind==='wall'?0.24:0.28;
      for(let a=minU;a<=maxU;a+=step)for(let b=minV;b<=maxV;b+=step){const q=[center[0]+u[0]*a+v[0]*b,center[1]+u[1]*a+v[1]*b,center[2]+u[2]*a+v[2]*b],k=`plane:${kind}:${key3(...q,step)}`;planeCells.set(k,{id:k,key:k,center:q,normal,rgb:[128,150,165],size:step,surfaceType:kind,status:'yellow',needDeep:true,overall:.24,geometry:.28,photoScore:0,maxParallaxDeg:0,maxBaselineM:0,viewCount:0,frameRefs:[],markpointId:null,lastSeen:time,count:0,positionStdM:null,curvature:0,predicted:true,planeHint:true});}
    }else if(p.center?.length>=3){const k=`plane:${kind}:${key3(...p.center,.26)}`;planeCells.set(k,{id:k,key:k,center:p.center,normal,rgb:[128,150,165],size:.26,surfaceType:kind,status:'yellow',needDeep:true,overall:.2,geometry:.25,photoScore:0,maxParallaxDeg:0,maxBaselineM:0,viewCount:0,frameRefs:[],lastSeen:time,count:0,predicted:true,planeHint:true});}
  }
}

function cellSummary(c,now){
  const iw=1/Math.max(c.w,1e-8),p=c.pos.map(v=>v*iw),n=normalize(c.normal),rgb=c.rgb.map(v=>clamp255(Math.round(v*iw)));
  const covariance=covariance6(c,p,iw),eig=principalScales(covariance),std=Math.sqrt(Math.max(0,(covariance[0]+covariance[3]+covariance[5])/3));
  const resultant=Math.hypot(...c.normal)/Math.max(c.w,1e-6),origins=[...c.views.values()].map(v=>v.origin);let baseline=0,parallax=0;
  for(let i=0;i<origins.length;i++)for(let j=i+1;j<origins.length;j++){baseline=Math.max(baseline,dist(origins[i],origins[j]));const a=normalize(sub(origins[i],p)),b=normalize(sub(origins[j],p));parallax=Math.max(parallax,Math.acos(clamp(dot(a,b),-1,1))*180/Math.PI);}
  const ny=n[1],curvature=Math.max(c.curvature,Math.min(1,eig.normalScale/Math.max(.012,eig.tangentScale)));
  let surfaceType=Math.abs(ny)>.78?(ny>0?'floor':'ceiling'):Math.abs(ny)<.32?(curvature>.24?'edge':'wall'):(curvature>.17?'object':'unknown');if(c.markpointId)surfaceType='edge';
  const sourceSupport=c.xrDepth+CFG.deepWeight*c.deepDepth+CFG.hitWeight*c.hitTest+.25*c.planeSupport,support=1-Math.exp(-sourceSupport/5.5),viewScore=clamp((origins.length-1)/2.6,0,1),baseScore=clamp((baseline-.16)/.34,0,1),normalScore=clamp((resultant-.42)/.53,0,1),varScore=clamp(1-std/.085,0,1),temporalScore=clamp((c.lastSeen-c.firstSeen)/2200,0,1);
  const geometry=.27*support+.18*viewScore+.15*baseScore+.18*normalScore+.12*varScore+.10*temporalScore;
  const frames=[...c.frameRefs.values()],photoViews=frames.length,sharp=photoViews?frames.reduce((s,f)=>s+f.sharpness,0)/photoViews:0,expo=photoViews?frames.reduce((s,f)=>s+f.exposure,0)/photoViews:0,photo=(1-Math.exp(-photoViews/1.45))*(.58+.24*sharp+.18*expo),parallaxScore=clamp((parallax-5)/12,0,1),objectLike=surfaceType==='object'||surfaceType==='edge',requiredPhoto=objectLike?.70:.45,requiredParallax=objectLike?.48:.20;
  const confirmed=origins.length>=CFG.minConfirmViews&&(c.lastSeen-c.firstSeen>=CFG.minConfirmSpanMs||c.xrDepth>=5||c.deepDepth>=3);
  let status='red';if(confirmed&&geometry>=.70&&photo>=requiredPhoto&&parallaxScore>=requiredParallax)status='green';else if(geometry>=.30||photo>.18)status='yellow';
  const needDeep=(status!=='green'&&photo<requiredPhoto)||(geometry<.58&&photoViews>0&&now-c.lastSeen>3600),overall=clamp(.57*geometry+.27*photo+.16*parallaxScore,0,1),size=(c.markpointId||surfaceType==='edge')?.052:(surfaceType==='object'?.065:((['wall','floor','ceiling'].includes(surfaceType)&&resultant>.84&&geometry>.68)?.20:.105));
  const rgbStd=rgbStd3(c,rgb,iw);
  return {id:c.key,key:c.key,center:p,normal:n,rgb,size,surfaceType,status,needDeep,overall,geometry,photoScore:photo,maxParallaxDeg:parallax,maxBaselineM:baseline,viewCount:origins.length,frameRefs:frames,markpointId:c.markpointId,lastSeen:c.lastSeen,firstSeen:c.firstSeen,count:c.count,positionStdM:std,curvature,sourceCounts:{xr:c.xrDepth,deep:c.deepDepth,hit:c.hitTest},gaussian:{kind:'point3d',mean:p,covariance6:covariance,scale:[eig.tangentScale,eig.secondScale,eig.normalScale],normal:n,rgbMean:rgb,rgbStd,opacity:clamp(.10+.90*overall,0,1),confidence:overall,confirmed,temporalSpanMs:c.lastSeen-c.firstSeen,viewCount:origins.length,support:c.count,rayTerminated:true,voxelM:CFG.voxel}};
}

function covariance6(c,p,iw){const e=[c.m2[0]*iw,c.m2[1]*iw,c.m2[2]*iw,c.m2[3]*iw,c.m2[4]*iw,c.m2[5]*iw];return [Math.max(1e-6,e[0]-p[0]*p[0]),e[1]-p[0]*p[1],e[2]-p[0]*p[2],Math.max(1e-6,e[3]-p[1]*p[1]),e[4]-p[1]*p[2],Math.max(1e-6,e[5]-p[2]*p[2])];}
function principalScales(cov){
  // V20.4 Gaussians are point primitives, not wall patches.  Repeated rays may
  // make them anisotropic, but their rendering/support footprint remains local
  // (millimetres to a few centimetres) and is never inflated to a 20 cm tile.
  const sx=Math.sqrt(Math.max(1e-7,cov[0])),sy=Math.sqrt(Math.max(1e-7,cov[3])),sz=Math.sqrt(Math.max(1e-7,cov[5])),s=[sx,sy,sz].sort((a,b)=>b-a);return {tangentScale:clamp(Math.max(CFG.voxel*.34,s[0]*1.45),.006,.050),secondScale:clamp(Math.max(CFG.voxel*.30,s[1]*1.45),.005,.044),normalScale:clamp(Math.max(CFG.voxel*.20,s[2]*1.30),.0035,.032)};
}
function rgbStd3(c,rgb,iw){return [0,1,2].map(k=>Math.sqrt(Math.max(0,c.rgb2[k]*iw-rgb[k]*rgb[k])));}

function snapshot(m){
  const now=Date.now(),center=m.cameraPosition||[0,1.5,0],radius=m.radius||9,max=m.maxCells||2600;let real=[];
  for(const c of cells.values()){const s=cellSummary(c,now),d=dist(s.center,center);if(d<=radius)real.push({...s,_d:d,_p:priority(s,d)});}
  // Plane hints are included only where no dense cell already describes the
  // region. This avoids the old visual result in which a plane grid replaced
  // rich object geometry.
  const occupied=new Set(real.map(s=>key3(...s.center,.12)));const hints=[];for(const p of planeCells.values()){if(dist(p.center,center)>radius||occupied.has(key3(...p.center,.12)))continue;hints.push({...p,_d:dist(p.center,center),_p:priority(p,dist(p.center,center))-.35});}
  const predicted=propagateTargets(real,center,Math.min(650,Math.floor(max*.28)));let arr=real.concat(hints,predicted);arr.sort((a,b)=>b._p-a._p);arr=arr.slice(0,max).map(({_d,_p,...s})=>s);
  postMessage({type:'snapshot',requestId:m.requestId||null,tiles:arr,stats:{cells:cells.size,planeCells:planeCells.size,predictedTargets:predicted.length,totalPoints,rawRayCount,droppedPoints,batches,confirmedGaussians:real.filter(s=>s.gaussian?.confirmed).length}});
}

function propagateTargets(real,camera,maxPredicted){const out=[],seen=new Set(real.map(s=>`${s.surfaceType}:${key3(...s.center,Math.max(.04,s.size*.72))}`)),seeds=real.filter(s=>s.geometry>.34&&s.surfaceType!=='unknown').sort((a,b)=>b.geometry-a.geometry).slice(0,430);for(const seed of seeds){if(out.length>=maxPredicted)break;const n=normalize(seed.normal),structural=['wall','floor','ceiling'].includes(seed.surfaceType),ring=structural?1:1,size=(seed.surfaceType==='object'||seed.surfaceType==='edge')?.07:Math.max(.10,Math.min(.20,seed.size||.11));let u,v;if(Math.abs(n[1])>.82){u=[1,0,0];v=[0,0,1];}else{u=normalize([-n[2],0,n[0]]);v=normalize(cross(n,u));}for(let a=-ring;a<=ring;a++)for(let b=-ring;b<=ring;b++){if(!a&&!b)continue;const p=[seed.center[0]+u[0]*a*size+v[0]*b*size,seed.center[1]+u[1]*a*size+v[1]*b*size,seed.center[2]+u[2]*a*size+v[2]*b*size];if(dist(p,camera)>9)continue;const key=`${seed.surfaceType}:${key3(...p,Math.max(.04,size*.72))}`;if(seen.has(key))continue;seen.add(key);const d=dist(p,camera),target={id:`target:${key}`,key:`target:${key}`,center:p,normal:n,rgb:seed.rgb,size,surfaceType:seed.surfaceType,status:'red',needDeep:true,overall:0,geometry:0,photoScore:0,maxParallaxDeg:0,maxBaselineM:0,viewCount:0,frameRefs:[],markpointId:null,lastSeen:seed.lastSeen,count:0,positionStdM:null,curvature:seed.curvature,predicted:true,parentId:seed.id,_d:d};target._p=priority(target,d)-.22;out.push(target);if(out.length>=maxPredicted)break;}}return out;}

function finalize(m){const now=Date.now(),tiles=[];for(const c of cells.values())tiles.push(cellSummary(c,now));postMessage({type:'final',requestId:m.requestId||null,tiles,gaussians:tiles.map(t=>({...t.gaussian,id:t.id,surfaceType:t.surfaceType,frameRefs:t.frameRefs,sourceCounts:t.sourceCounts})),stats:{cells:cells.size,planeCells:planeCells.size,totalPoints,rawRayCount,droppedPoints,batches}});}

function prune(){
  const candidates=[];for(const [key,c] of cells){const s=cellSummary(c,Date.now()),preserve=!!c.markpointId||s.surfaceType==='object'||s.surfaceType==='edge'||s.frameRefs.length>1||(s.gaussian.confirmed&&s.viewCount>=2)||s.sourceCounts.deep>=2;if(!preserve)candidates.push([key,c,s]);}
  const target=Math.max(0,cells.size-Math.floor(CFG.budget*.88));if(!target)return;candidates.sort((a,b)=>a[2].overall-b[2].overall||a[1].lastSeen-b[1].lastSeen);const coarseSeen=new Set();let removed=0;
  for(const [key,c,s] of candidates){if(removed>=target)break;const ck=key3(...s.center,CFG.flatTile);if(!coarseSeen.has(ck)){coarseSeen.add(ck);continue;}cells.delete(key);removed++;droppedPoints+=c.count;}
  if(cells.size>CFG.budget){const rest=[...cells.entries()].filter(([,c])=>!c.markpointId).sort((a,b)=>importance(a[1])-importance(b[1]));for(const [key,c] of rest){if(cells.size<=CFG.budget*.95)break;cells.delete(key);droppedPoints+=c.count;}}
}

function priority(s,d){return (s.status==='red'?3:s.status==='yellow'?1.7:.12)+(s.needDeep?1.25:0)+((s.surfaceType==='object'||s.surfaceType==='edge')?.9:0)+(s.gaussian?.confirmed?.35:0)+1/(.4+d);}
function importance(c){return (c.markpointId?100:0)+Math.min(12,c.count)*.12+c.frameRefs.size*.85+c.views.size*.65+c.curvature*2.4+(Date.now()-c.lastSeen<8000?1:0)+Math.min(3,c.deepDepth*.12);}
function trimMap(map,max,sorter){if(map.size<=max)return;const a=[...map.entries()].sort(sorter);map.clear();for(const [k,v] of a.slice(0,max))map.set(k,v);}
function reset(){cells.clear();planeCells.clear();totalPoints=0;rawRayCount=0;droppedPoints=0;batches=0;}
function classifyNormal(n){return Math.abs(n[1])>.78?(n[1]>0?'floor':'ceiling'):(Math.abs(n[1])<.35?'wall':'unknown');}
function orthogonal(n){const a=Math.abs(n[1])<.8?[0,1,0]:[1,0,0];return normalize(cross(n,a));}
function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function normalize(a){const n=Math.hypot(...a)||1;return a.map(v=>v/n);}
function sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function clamp255(v){return clamp(v,0,255);}
