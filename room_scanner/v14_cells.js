/*
 * Room Scanner V14.1.0 - Room Cells geometry core
 * -------------------------------------------------
 * Pure geometry helpers for the deliberately simple V14 architecture:
 *   CaptureStation -> RoomCell -> Portal -> rigid cell registration.
 *
 * No TSDF, no free wall rotations, no global point-cloud reconstruction.
 * The footprint selected by the user is authoritative inside each cell.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.RoomV14Cells=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EPS=1e-9;
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const v2=(a,b)=>[a[0]+b[0],a[1]+b[1]];
  const s2=(a,b)=>[a[0]-b[0],a[1]-b[1]];
  const m2=(a,s)=>[a[0]*s,a[1]*s];
  const d2=(a,b)=>a[0]*b[0]+a[1]*b[1];
  const c2=(a,b)=>a[0]*b[1]-a[1]*b[0];
  const len2=a=>Math.hypot(a[0],a[1]);
  const n2=a=>{const l=len2(a);return l>EPS?[a[0]/l,a[1]/l]:[0,0]};
  const v3=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const s3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const m3=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
  const d3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const len3=a=>Math.hypot(a[0],a[1],a[2]);
  const n3=a=>{const l=len3(a);return l>EPS?[a[0]/l,a[1]/l,a[2]/l]:[0,0,0]};
  const angleWrap=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a};
  const angleDiff=(a,b)=>Math.abs(angleWrap(a-b));
  function median(xs){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;const m=a.length>>1;return a.length&1?a[m]:(a[m-1]+a[m])/2}
  function quantile(xs,q){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;const p=clamp(q)*(a.length-1),i=Math.floor(p),f=p-i;return a[i]*(1-f)+a[Math.min(a.length-1,i+1)]*f}
  function mad(xs,c=median(xs)){return Number.isFinite(c)?median(xs.map(x=>Math.abs(x-c))):NaN}

  function mat4Point(m,p){const x=p[0],y=p[1],z=p[2],w=p[3]??1;return[m[0]*x+m[4]*y+m[8]*z+m[12]*w,m[1]*x+m[5]*y+m[9]*z+m[13]*w,m[2]*x+m[6]*y+m[10]*z+m[14]*w,m[3]*x+m[7]*y+m[11]*z+m[15]*w]}
  function projectPoint(projection,worldToView,p){const q=mat4Point(worldToView,[p[0],p[1],p[2],1]);if(q[2]>=-1e-4)return null;const c=mat4Point(projection,q);if(Math.abs(c[3])<EPS)return null;const nx=c[0]/c[3],ny=c[1]/c[3];return{u:(nx+1)/2,v:(1-ny)/2,depth:-q[2],nx,ny}}
  function rayFromUV(projection,worldFromView,u,v){const px=projection[0],py=projection[5],ox=projection[8],oy=projection[9];if(Math.abs(px)<EPS||Math.abs(py)<EPS)return null;const nx=2*u-1,ny=1-2*v,dv=n3([(nx+ox)/px,(ny+oy)/py,-1]),d=n3([worldFromView[0]*dv[0]+worldFromView[4]*dv[1]+worldFromView[8]*dv[2],worldFromView[1]*dv[0]+worldFromView[5]*dv[1]+worldFromView[9]*dv[2],worldFromView[2]*dv[0]+worldFromView[6]*dv[1]+worldFromView[10]*dv[2]]);return{o:[worldFromView[12],worldFromView[13],worldFromView[14]],d}}
  function viewYaw(worldFromView){const f=[-worldFromView[8],-worldFromView[10]];return Math.atan2(f[1],f[0])}
  function horizontalFov(projection){return 2*Math.atan(1/Math.max(EPS,Math.abs(projection[0])))}

  function transform2(p,t){const c=Math.cos(t.yaw||0),s=Math.sin(t.yaw||0);return[(t.x||0)+c*p[0]-s*p[1],(t.z||0)+s*p[0]+c*p[1]]}
  function inverseTransform2(p,t){const x=p[0]-(t.x||0),z=p[1]-(t.z||0),c=Math.cos(t.yaw||0),s=Math.sin(t.yaw||0);return[c*x+s*z,-s*x+c*z]}
  function rotate2(v,yaw){const c=Math.cos(yaw),s=Math.sin(yaw);return[c*v[0]-s*v[1],s*v[0]+c*v[1]]}
  function transform3(p,t){const q=transform2([p[0],p[2]],t);return[q[0],p[1]+(t.y||0),q[1]]}
  function inverseTransform3(p,t){const q=inverseTransform2([p[0],p[2]],t);return[q[0],p[1]-(t.y||0),q[1]]}

  function signedArea(poly){let a=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p[0]*q[1]-q[0]*p[1]}return a/2}
  function pointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j],hit=((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]+EPS)+a[0]);if(hit)inside=!inside}return inside}
  function segCross(a,b,c,d){const r=s2(b,a),s=s2(d,c),den=c2(r,s);if(Math.abs(den)<1e-8)return false;const ca=s2(c,a),t=c2(ca,s)/den,u=c2(ca,r)/den;return t>1e-5&&t<1-1e-5&&u>1e-5&&u<1-1e-5}
  function validateFootprint(poly,minEdge=.18){if(!Array.isArray(poly)||poly.length<3)return{ok:false,reason:'servono almeno 3 punti'};for(let i=0;i<poly.length;i++)if(len2(s2(poly[(i+1)%poly.length],poly[i]))<minEdge)return{ok:false,reason:`lato ${i+1} troppo corto`};for(let i=0;i<poly.length;i++)for(let j=i+1;j<poly.length;j++){if(j===i||j===(i+1)%poly.length||i===(j+1)%poly.length)continue;if(segCross(poly[i],poly[(i+1)%poly.length],poly[j],poly[(j+1)%poly.length]))return{ok:false,reason:'perimetro auto-intersecante'}}const area=Math.abs(signedArea(poly));return area>.08?{ok:true,area}:{ok:false,reason:'area quasi nulla'}}
  function polygonCentroid(poly){const a=signedArea(poly);if(Math.abs(a)<EPS)return poly.reduce((q,p)=>v2(q,p),[0,0]).map(x=>x/poly.length);let cx=0,cz=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],k=p[0]*q[1]-q[0]*p[1];cx+=(p[0]+q[0])*k;cz+=(p[1]+q[1])*k}return[cx/(6*a),cz/(6*a)]}
  function buildWalls(poly,height){const ctr=polygonCentroid(poly),walls=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],t=n2(s2(b,a));let n=[-t[1],t[0]];if(d2(n,s2(ctr,a))<0)n=m2(n,-1);walls.push({index:i,a:[...a],b:[...b],t,n,length:len2(s2(b,a)),height})}return walls}
  function buildCellModel(footprint,height=2.7,floorY=0){const v=validateFootprint(footprint);if(!v.ok)throw new Error(v.reason);const poly=signedArea(footprint)>0?footprint.map(p=>[...p]):[...footprint].reverse().map(p=>[...p]);return{footprint:poly,height,floorY,ceilY:floorY+height,walls:buildWalls(poly,height),centroid:polygonCentroid(poly),area:Math.abs(signedArea(poly))}}
  function wallPoint(wall,u,v,model){return[wall.a[0]+wall.t[0]*wall.length*u,model.floorY+model.height*v,wall.a[1]+wall.t[1]*wall.length*u]}
  function wallUV(wall,p,model){return{u:clamp(d2([p[0]-wall.a[0],p[2]-wall.a[1]],wall.t)/Math.max(EPS,wall.length)),v:clamp((p[1]-model.floorY)/Math.max(EPS,model.height))}}
  function rayWallHit(ray,wall,model){const den=wall.n[0]*ray.d[0]+wall.n[1]*ray.d[2];if(Math.abs(den)<1e-7)return null;const c=d2(wall.n,wall.a),t=(c-wall.n[0]*ray.o[0]-wall.n[1]*ray.o[2])/den;if(t<=0)return null;const p=v3(ray.o,m3(ray.d,t)),s=d2([p[0]-wall.a[0],p[2]-wall.a[1]],wall.t);if(s<-.03||s>wall.length+.03||p[1]<model.floorY-.03||p[1]>model.ceilY+.03)return null;return{t,p,s,wallIndex:wall.index,kind:'wall'}}
  function rayCellHit(ray,model){let best=null;for(const w of model.walls){const q=rayWallHit(ray,w,model);if(q&&(!best||q.t<best.t))best=q}if(ray.d[1]<-1e-6){const t=(model.floorY-ray.o[1])/ray.d[1];if(t>0){const p=v3(ray.o,m3(ray.d,t));if(pointInPolygon([p[0],p[2]],model.footprint)&&(!best||t<best.t))best={t,p,kind:'floor'}}}if(ray.d[1]>1e-6){const t=(model.ceilY-ray.o[1])/ray.d[1];if(t>0){const p=v3(ray.o,m3(ray.d,t));if(pointInPolygon([p[0],p[2]],model.footprint)&&(!best||t<best.t))best={t,p,kind:'ceiling'}}}return best}
  function nearestWallPoint(p,model){let best=null;for(const w of model.walls){const rel=[p[0]-w.a[0],p[2]-w.a[1]],s=clamp(d2(rel,w.t),0,w.length),q=[w.a[0]+w.t[0]*s,p[1],w.a[1]+w.t[1]*s],dist=Math.hypot(p[0]-q[0],p[2]-q[2]);if(!best||dist<best.distance)best={wallIndex:w.index,s,distance:dist,p:q}}return best}
  function heightFromWallRay(ray,wall,floorY=0,minH=1.7,maxH=5.2){const fake={floorY,ceilY:floorY+maxH};const q=rayWallHit(ray,wall,fake);if(!q)return null;const h=q.p[1]-floorY;return h>=minH&&h<=maxH?{height:h,p:q.p,s:q.s}:null}

  function stationFromPose(worldFromView,id='S1',floorY=0){const yaw=viewYaw(worldFromView),origin=[worldFromView[12],floorY,worldFromView[14]];return{id,origin,yaw,transform:{x:origin[0],z:origin[2],yaw},cameraY:worldFromView[13],createdAt:Date.now()}}
  function worldPointToStationXZ(p,station){return inverseTransform2([p[0],p[2]],station.transform)}
  function stationPointToWorld(p,station,y=0){const q=transform2(p,station.transform);return[q[0],y,q[1]]}

  function coverageGrid(cols=24,rows=12){return{cols,rows,photo:new Float32Array(cols*rows),deep:new Float32Array(cols*rows),xr:new Float32Array(cols*rows)}}
  function coverageIndex(g,u,v){const x=clamp(Math.floor(u*g.cols),0,g.cols-1),y=clamp(Math.floor(v*g.rows),0,g.rows-1);return y*g.cols+x}
  function updateCoverage(g,layer,u,v,value=1){if(!g?.[layer])return;const i=coverageIndex(g,u,v);g[layer][i]=Math.max(g[layer][i],clamp(value))}
  function coverageFraction(g,layer,threshold=.55){const a=g?.[layer];if(!a?.length)return 0;let n=0;for(const v of a)if(v>=threshold)n++;return n/a.length}
  function panoramaCoverage(bins=24){return{bins,photo:new Float32Array(bins),deep:new Float32Array(bins)}}
  function angularBin(g,yaw){const a=(angleWrap(yaw)+Math.PI)/(2*Math.PI);return clamp(Math.floor(a*g.bins),0,g.bins-1)}
  function markPanorama(g,layer,centerYaw,hfov,quality=1){if(!g?.[layer])return;const half=Math.max(.08,hfov*.48);for(let i=0;i<g.bins;i++){const y=-Math.PI+(i+.5)*2*Math.PI/g.bins,d=angleDiff(y,centerYaw);if(d<=half){const edge=1-d/half,v=clamp((.55+.45*edge)*quality);g[layer][i]=Math.max(g[layer][i],v)}}}
  function panoramaFraction(g,layer,threshold=.5){const a=g?.[layer];if(!a?.length)return 0;let n=0;for(const v of a)if(v>=threshold)n++;return n/a.length}
  function weakestPanoramaYaw(g,layer='photo'){const a=g?.[layer];if(!a?.length)return 0;let k=0;for(let i=1;i<a.length;i++)if(a[i]<a[k])k=i;return -Math.PI+(k+.5)*2*Math.PI/g.bins}

  function createPortal(cellId,wallIndex,s0,s1,height=null,id='P1'){const a=Math.min(s0,s1),b=Math.max(s0,s1);return{id,cellId,wallIndex,s0:a,s1:b,width:b-a,top:height,linkedCellId:null,linkedWallIndex:null,status:'open'}}
  function portalLocalSegment(cell,portal){const w=cell.model.walls[portal.wallIndex],a=[w.a[0]+w.t[0]*portal.s0,w.a[1]+w.t[1]*portal.s0],b=[w.a[0]+w.t[0]*portal.s1,w.a[1]+w.t[1]*portal.s1];return{a,b,mid:m2(v2(a,b),.5),t:w.t,n:w.n,width:portal.s1-portal.s0}}
  function portalGlobalSegment(cell,portal){const l=portalLocalSegment(cell,portal),t=cell.transform;return{a:transform2(l.a,t),b:transform2(l.b,t),mid:transform2(l.mid,t),t:rotate2(l.t,t.yaw),n:rotate2(l.n,t.yaw),width:l.width}}
  function segmentLineDistance(p,a,b){const t=n2(s2(b,a)),L=len2(s2(b,a)),s=clamp(d2(s2(p,a),t),0,L),q=v2(a,m2(t,s));return{distance:len2(s2(p,q)),s,q}}
  function pathWallCrossing(a,b,wallA,wallB){const r=s2(b,a),s=s2(wallB,wallA),den=c2(r,s);if(Math.abs(den)<1e-8)return null;const ca=s2(wallA,a),t=c2(ca,s)/den,u=c2(ca,r)/den;if(t<-.1||t>1.1||u<-.1||u>1.1)return null;return v2(a,m2(r,t))}
  function wallGlobal(cell,wallIndex,transform=cell.transform){const w=cell.model.walls[wallIndex],a=transform2(w.a,transform),b=transform2(w.b,transform),t=n2(s2(b,a));return{index:wallIndex,a,b,t,n:rotate2(w.n,transform.yaw),length:len2(s2(b,a))}}
  function matchPortalWall(targetCell,sourceCell,portal,priorTransform,targetStationGlobal=null,sourceStationGlobal=null){
    const src=portalGlobalSegment(sourceCell,portal),cross=sourceStationGlobal&&targetStationGlobal?pathWallCrossing(sourceStationGlobal,targetStationGlobal,src.a,src.b):src.mid;
    const candidates=[];
    for(const w of targetCell.model.walls){const gw=wallGlobal(targetCell,w.index,priorTransform),ang=Math.min(angleDiff(Math.atan2(gw.t[1],gw.t[0]),Math.atan2(src.t[1],src.t[0])),angleDiff(Math.atan2(gw.t[1],gw.t[0]),Math.atan2(-src.t[1],-src.t[0]))),dist=segmentLineDistance(cross||src.mid,gw.a,gw.b).distance,widthPenalty=Math.max(0,portal.width-gw.length),side=targetStationGlobal?d2(src.n,s2(targetStationGlobal,src.mid)):0,sidePenalty=side<.05?0:Math.min(1,side)/2,score=3.1*ang+2.2*dist+2.5*widthPenalty+sidePenalty;candidates.push({wallIndex:w.index,score,angle:ang,distance:dist,wall:gw})}
    candidates.sort((a,b)=>a.score-b.score);return{best:candidates[0]||null,candidates,cross:cross||src.mid,source:src};
  }
  function registerCellToPortal(targetCell,sourceCell,portal,priorTransform,targetStationGlobal=null,sourceStationGlobal=null){
    const m=matchPortalWall(targetCell,sourceCell,portal,priorTransform,targetStationGlobal,sourceStationGlobal);if(!m.best)return{ok:false,reason:'nessuna parete candidata'};
    const w=targetCell.model.walls[m.best.wallIndex],desiredN=m2(m.source.n,-1),yaw=angleWrap(Math.atan2(desiredN[1],desiredN[0])-Math.atan2(w.n[1],w.n[0]));
    const crossLocal=inverseTransform2(m.cross,priorTransform),near=segmentLineDistance(crossLocal,w.a,w.b),localAnchor=near.q,rot=rotate2(localAnchor,yaw),translation=[m.source.mid[0]-rot[0],m.source.mid[1]-rot[1]],transform={x:translation[0],z:translation[1],yaw};
    const gw=wallGlobal(targetCell,w.index,transform),angle=angleDiff(Math.atan2(gw.n[1],gw.n[0]),Math.atan2(desiredN[1],desiredN[0])),distance=segmentLineDistance(m.source.mid,gw.a,gw.b).distance,priorPos=Math.hypot(transform.x-priorTransform.x,transform.z-priorTransform.z),priorYaw=angleDiff(transform.yaw,priorTransform.yaw),score=distance+angle+.12*priorPos+.08*priorYaw;
    return{ok:score<1.2,transform,wallIndex:w.index,score,diagnostics:{match:m.best,angle,distance,priorPos,priorYaw,cross:m.cross}};
  }

  function regressionLinear(samples,fn){if(samples.length<6)return null;let a=samples.map(s=>({...s,x:fn(s.r)})).filter(s=>Number.isFinite(s.x)&&Number.isFinite(s.d));if(a.length<6)return null;let m=1,b=0;for(let it=0;it<5;it++){let sw=0,sx=0,sy=0,sxx=0,sxy=0;for(const s of a){const w=s.weight??1;sw+=w;sx+=w*s.x;sy+=w*s.d;sxx+=w*s.x*s.x;sxy+=w*s.x*s.d}const den=sw*sxx-sx*sx;if(Math.abs(den)<1e-9)return null;m=(sw*sxy-sx*sy)/den;b=(sy-m*sx)/sw;const rs=a.map(s=>Math.abs(m*s.x+b-s.d)),med=median(rs),cut=Math.max(.055,2.8*Math.max(.02,1.4826*(mad(rs,med)||med||.02)));a=a.filter(s=>Math.abs(m*s.x+b-s.d)<=cut);if(a.length<6)return null}const rs=a.map(s=>Math.abs(m*s.x+b-s.d));return{m,b,n:a.length,med:median(rs),p90:quantile(rs,.9)}}
  function fitRelativeDepth(samples){const direct=regressionLinear(samples,r=>r),inv=regressionLinear(samples,r=>1/Math.max(Math.abs(r),1e-6)),score=f=>f?f.med+.25*f.p90+1/Math.sqrt(Math.max(1,f.n)):Infinity,best=score(inv)<score(direct)?{...inv,mode:'inverse'}:{...direct,mode:'direct'};return Number.isFinite(best.med)?best:null}
  function metricDepth(fit,r){if(!fit||!Number.isFinite(r))return NaN;const x=fit.mode==='inverse'?1/Math.max(Math.abs(r),1e-6):r;return fit.m*x+fit.b}

  function voxelKey(p,size){return`${Math.floor(p[0]/size+1e-7)},${Math.floor(p[1]/size+1e-7)},${Math.floor(p[2]/size+1e-7)}`}
  function parseVoxelKey(k){return k.split(',').map(Number)}
  function mergeVoxel(map,p,obs,size=.055){const k=voxelKey(p,size),w=Math.max(.02,obs.weight??1),old=map.get(k);if(!old){map.set(k,{key:k,p:[...p],color:[...(obs.color||[180,190,200])],weight:w,xr:obs.source==='XR'?1:0,deep:obs.source==='Deep'?1:0,frames:new Set(obs.frameId!=null?[obs.frameId]:[]),cells:new Set(obs.cellId!=null?[obs.cellId]:[])});return map.get(k)}const nw=old.weight+w;old.p=[0,1,2].map(i=>(old.p[i]*old.weight+p[i]*w)/nw);old.color=[0,1,2].map(i=>Math.round((old.color[i]*old.weight+(obs.color?.[i]??old.color[i])*w)/nw));old.weight=nw;if(obs.source==='XR')old.xr++;if(obs.source==='Deep')old.deep++;if(obs.frameId!=null)old.frames.add(obs.frameId);if(obs.cellId!=null)old.cells.add(obs.cellId);return old}
  function connectedVoxelComponents(map,size=.055,minCells=6){const keep=new Map([...map].filter(([,v])=>v.frames.size>=2||(v.xr>0&&v.deep>0))),seen=new Set(),out=[],neigh=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)if(dx||dy||dz)neigh.push([dx,dy,dz]);for(const [key] of keep){if(seen.has(key))continue;const q=[key],cells=[];seen.add(key);while(q.length){const k=q.pop(),v=keep.get(k);cells.push(v);const ijk=parseVoxelKey(k);for(const d of neigh){const nk=`${ijk[0]+d[0]},${ijk[1]+d[1]},${ijk[2]+d[2]}`;if(keep.has(nk)&&!seen.has(nk)){seen.add(nk);q.push(nk)}}}if(cells.length>=minCells)out.push(cells)}return out}
  function pcaYaw(points){if(points.length<2)return 0;const mx=points.reduce((n,p)=>n+p[0],0)/points.length,mz=points.reduce((n,p)=>n+p[2],0)/points.length;let xx=0,xz=0,zz=0;for(const p of points){const x=p[0]-mx,z=p[2]-mz;xx+=x*x;xz+=x*z;zz+=z*z}return .5*Math.atan2(2*xz,xx-zz)}
  function objectFromCells(cells,id,size=.055){const pts=cells.map(v=>v.p),yaw=pcaYaw(pts),c=Math.cos(yaw),s=Math.sin(yaw),loc=pts.map(p=>[c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]]),mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];for(const p of loc)for(let i=0;i<3;i++){mins[i]=Math.min(mins[i],p[i]);maxs[i]=Math.max(maxs[i],p[i])}const lc=mins.map((x,i)=>(x+maxs[i])/2),wc=[c*lc[0]-s*lc[2],lc[1],s*lc[0]+c*lc[2]],extent=maxs.map((x,i)=>Math.max(size,x-mins[i]+size));return{id,name:`Oggetto ${id}`,cells,points:cells.map(v=>({p:v.p,color:v.color,xr:v.xr,deep:v.deep})),obb:{center:wc,extent,yaw},confidence:clamp(cells.reduce((n,v)=>n+(v.xr?1:.3)+(v.deep?.45:0),0)/(cells.length*1.35)),status:'active'}}
  function voxelSurfaceMesh(cells,size=.055){const set=new Set(cells.map(v=>v.key)),vertices=[],indices=[],faces=[[[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]],[[-1,0,0],[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]],[[0,1,0],[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]],[[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],[[0,0,1],[[1,0,1],[1,1,1],[0,1,1],[0,0,1]]],[[0,0,-1],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]]];for(const v of cells){const ijk=parseVoxelKey(v.key),base=[ijk[0]*size,ijk[1]*size,ijk[2]*size];for(const [d,corners] of faces){const nk=`${ijk[0]+d[0]},${ijk[1]+d[1]},${ijk[2]+d[2]}`;if(set.has(nk))continue;const o=vertices.length;for(const q of corners)vertices.push([base[0]+q[0]*size,base[1]+q[1]*size,base[2]+q[2]*size]);indices.push(o,o+1,o+2,o,o+2,o+3)}}return{vertices,indices}}

  function triangulatePolygon(poly){if(poly.length<3)return[];const ccw=signedArea(poly)>0,idx=[...poly.keys()],out=[],area=(a,b,c)=>c2(s2(b,a),s2(c,a)),inside=(p,a,b,c)=>{const x=area(a,b,p),y=area(b,c,p),z=area(c,a,p),n=x<0||y<0||z<0,q=x>0||y>0||z>0;return!(n&&q)};let guard=0;while(idx.length>3&&guard++<10000){let cut=false;for(let k=0;k<idx.length;k++){const ia=idx[(k-1+idx.length)%idx.length],ib=idx[k],ic=idx[(k+1)%idx.length],a=poly[ia],b=poly[ib],c=poly[ic],ar=area(a,b,c);if(ccw?ar<=1e-9:ar>=-1e-9)continue;let bad=false;for(const j of idx)if(j!==ia&&j!==ib&&j!==ic&&inside(poly[j],a,b,c)){bad=true;break}if(bad)continue;out.push(ia,ib,ic);idx.splice(k,1);cut=true;break}if(!cut)break}if(idx.length===3)out.push(idx[0],idx[1],idx[2]);return out}
  function addQuad(mesh,a,b,c,d,group){const o=mesh.vertices.length;mesh.vertices.push(a,b,c,d);mesh.indices.push(o,o+1,o+2,o,o+2,o+3);mesh.groups.push(group,group)}
  function cellShellMesh(cell,portals=[],skipWallIndices=[]){const m=cell.model,T=cell.transform,mesh={vertices:[],indices:[],groups:[]},tri=triangulatePolygon(m.footprint),n=m.footprint.length,base=[],top=[];for(const p of m.footprint){base.push(transform3([p[0],m.floorY,p[1]],T));top.push(transform3([p[0],m.ceilY,p[1]],T))}for(let i=0;i<tri.length;i+=3){const o=mesh.vertices.length;mesh.vertices.push(base[tri[i+2]],base[tri[i+1]],base[tri[i]]);mesh.indices.push(o,o+1,o+2);mesh.groups.push(`cell:${cell.id}:floor`);const q=mesh.vertices.length;mesh.vertices.push(top[tri[i]],top[tri[i+1]],top[tri[i+2]]);mesh.indices.push(q,q+1,q+2);mesh.groups.push(`cell:${cell.id}:ceiling`)}
    for(const w of m.walls){if(skipWallIndices.includes(w.index))continue;const ps=portals.filter(p=>p.cellId===cell.id&&p.wallIndex===w.index&&p.status!=='closed').sort((a,b)=>a.s0-b.s0);let cursor=0;const pieces=[];for(const p of ps){if(p.s0>cursor+.01)pieces.push({s0:cursor,s1:p.s0,y0:m.floorY,y1:m.ceilY});const pt=Number.isFinite(p.top)?clamp(p.top,m.floorY+.4,m.ceilY):m.ceilY;if(pt<m.ceilY-.02)pieces.push({s0:p.s0,s1:p.s1,y0:pt,y1:m.ceilY});cursor=Math.max(cursor,p.s1)}if(cursor<w.length-.01)pieces.push({s0:cursor,s1:w.length,y0:m.floorY,y1:m.ceilY});if(!ps.length)pieces.push({s0:0,s1:w.length,y0:m.floorY,y1:m.ceilY});for(const r of pieces){const A=[w.a[0]+w.t[0]*r.s0,r.y0,w.a[1]+w.t[1]*r.s0],B=[w.a[0]+w.t[0]*r.s1,r.y0,w.a[1]+w.t[1]*r.s1],C=[w.a[0]+w.t[0]*r.s1,r.y1,w.a[1]+w.t[1]*r.s1],D=[w.a[0]+w.t[0]*r.s0,r.y1,w.a[1]+w.t[1]*r.s0];addQuad(mesh,transform3(A,T),transform3(B,T),transform3(C,T),transform3(D,T),`cell:${cell.id}:wall:${w.index}`)}}return mesh}
  function sceneBounds(cells,objects=[]){const pts=[];for(const c of cells){for(const p of c.model.footprint){pts.push(transform3([p[0],c.model.floorY,p[1]],c.transform),transform3([p[0],c.model.ceilY,p[1]],c.transform))}}for(const o of objects)for(const q of o.points||[])pts.push(q.p);if(!pts.length)return{min:[-1,0,-1],max:[1,2,1]};const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of pts)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i])}return{min,max}}

  return{EPS,clamp,v2,s2,m2,d2,c2,len2,n2,v3,s3,m3,d3,len3,n3,angleWrap,angleDiff,median,quantile,mad,mat4Point,projectPoint,rayFromUV,viewYaw,horizontalFov,transform2,inverseTransform2,rotate2,transform3,inverseTransform3,signedArea,pointInPolygon,validateFootprint,polygonCentroid,buildWalls,buildCellModel,wallPoint,wallUV,rayWallHit,rayCellHit,nearestWallPoint,heightFromWallRay,stationFromPose,worldPointToStationXZ,stationPointToWorld,coverageGrid,coverageIndex,updateCoverage,coverageFraction,panoramaCoverage,angularBin,markPanorama,panoramaFraction,weakestPanoramaYaw,createPortal,portalLocalSegment,portalGlobalSegment,pathWallCrossing,wallGlobal,matchPortalWall,registerCellToPortal,fitRelativeDepth,metricDepth,voxelKey,mergeVoxel,connectedVoxelComponents,objectFromCells,voxelSurfaceMesh,triangulatePolygon,cellShellMesh,sceneBounds};
});
