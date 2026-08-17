/*
 * Room Scanner V13 geometry core
 * ---------------------------------
 * Pure, dependency-free geometry/state helpers shared by the browser app and
 * deterministic Node tests.  The browser app deliberately keeps ALL room
 * geometry in this compact model; WebXR / RGB / Deep are observations only.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.RoomV13Geometry=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const EPS=1e-9;
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const sq=x=>x*x;
  const v2=(a,b)=>[a[0]+b[0],a[1]+b[1]];
  const s2=(a,b)=>[a[0]-b[0],a[1]-b[1]];
  const m2=(a,s)=>[a[0]*s,a[1]*s];
  const d2=(a,b)=>a[0]*b[0]+a[1]*b[1];
  const c2=(a,b)=>a[0]*b[1]-a[1]*b[0];
  const n2=a=>{const n=Math.hypot(a[0],a[1]);return n>EPS?[a[0]/n,a[1]/n]:[0,0]};
  const len2=a=>Math.hypot(a[0],a[1]);
  const v3=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const s3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const m3=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
  const d3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const x3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const n3=a=>{const n=Math.hypot(a[0],a[1],a[2]);return n>EPS?[a[0]/n,a[1]/n,a[2]/n]:[0,0,0]};
  const len3=a=>Math.hypot(a[0],a[1],a[2]);

  function median(xs){
    if(!xs.length)return NaN;
    const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);
    if(!a.length)return NaN;
    const m=a.length>>1;return a.length&1?a[m]:(a[m-1]+a[m])/2;
  }
  function quantile(xs,q){
    const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;
    const p=clamp(q)*(a.length-1),i=Math.floor(p),f=p-i;return a[i]*(1-f)+a[Math.min(a.length-1,i+1)]*f;
  }
  function mad(xs,center=median(xs)){
    if(!Number.isFinite(center))return NaN;return median(xs.map(x=>Math.abs(x-center)));
  }
  function huber(r,k){const a=Math.abs(r);return a<=k?.5*r*r:k*(a-.5*k)}
  function robustWeightedMedian(samples,valueKey='value',weightKey='weight'){
    const a=samples.filter(s=>Number.isFinite(s[valueKey])&&(s[weightKey]??1)>0).sort((x,y)=>x[valueKey]-y[valueKey]);
    if(!a.length)return NaN;const total=a.reduce((n,s)=>n+(s[weightKey]??1),0);let c=0;
    for(const s of a){c+=(s[weightKey]??1);if(c>=total*.5)return s[valueKey]}return a[a.length-1][valueKey];
  }

  function mat4Point(m,p){
    const x=p[0],y=p[1],z=p[2],w=p[3]??1;
    return [m[0]*x+m[4]*y+m[8]*z+m[12]*w,m[1]*x+m[5]*y+m[9]*z+m[13]*w,m[2]*x+m[6]*y+m[10]*z+m[14]*w,m[3]*x+m[7]*y+m[11]*z+m[15]*w];
  }
  function mat4Mul(a,b){
    const o=new Array(16).fill(0);
    for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];
    return o;
  }
  function mat4Identity(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
  function yawTranslationMatrix(yaw,p){
    const c=Math.cos(yaw),s=Math.sin(yaw);
    return[c,0,-s,0, 0,1,0,0, s,0,c,0, p[0],p[1],p[2],1];
  }
  function rigidInverseYawTranslation(m){
    const yaw=Math.atan2(m[8],m[0]),c=Math.cos(yaw),s=Math.sin(yaw),t=[m[12],m[13],m[14]];
    const r=[c,0,s,0, 0,1,0,0, -s,0,c,0, 0,0,0,1];
    const ti=[-(r[0]*t[0]+r[8]*t[2]),-t[1],-(r[2]*t[0]+r[10]*t[2])];r[12]=ti[0];r[13]=ti[1];r[14]=ti[2];return r;
  }
  function projectPoint(projection,worldToView,p){
    const q=mat4Point(worldToView,[p[0],p[1],p[2],1]);if(q[2]>=-1e-4)return null;
    const c=mat4Point(projection,q);if(Math.abs(c[3])<EPS)return null;
    const nx=c[0]/c[3],ny=c[1]/c[3];return{u:(nx+1)/2,v:(1-ny)/2,depth:-q[2],nx,ny};
  }
  function rayFromUV(projection,worldFromView,u,v){
    // Projection matrices produced by WebXR are standard perspective matrices.
    // Convert NDC to a view-space ray without requiring a generic 4x4 inverse.
    const px=projection[0],py=projection[5],ox=projection[8],oy=projection[9];
    if(Math.abs(px)<EPS||Math.abs(py)<EPS)return null;
    const nx=2*u-1,ny=1-2*v;
    const dv=n3([(nx+ox)/px,(ny+oy)/py,-1]);
    const d=n3([
      worldFromView[0]*dv[0]+worldFromView[4]*dv[1]+worldFromView[8]*dv[2],
      worldFromView[1]*dv[0]+worldFromView[5]*dv[1]+worldFromView[9]*dv[2],
      worldFromView[2]*dv[0]+worldFromView[6]*dv[1]+worldFromView[10]*dv[2]
    ]);
    return{o:[worldFromView[12],worldFromView[13],worldFromView[14]],d};
  }

  function signedArea(poly){let a=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p[0]*q[1]-q[0]*p[1]}return a/2}
  function pointInPolygon(p,poly){
    let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j],hit=((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]+EPS)+a[0]);if(hit)inside=!inside;
    }return inside;
  }
  function segCross(a,b,c,d){
    const r=s2(b,a),s=s2(d,c),den=c2(r,s);if(Math.abs(den)<1e-8)return false;
    const ca=s2(c,a),t=c2(ca,s)/den,u=c2(ca,r)/den;return t>1e-5&&t<1-1e-5&&u>1e-5&&u<1-1e-5;
  }
  function validateFootprint(poly,minEdge=.18){
    if(!Array.isArray(poly)||poly.length<3)return{ok:false,reason:'servono almeno 3 corner'};
    for(let i=0;i<poly.length;i++)if(len2(s2(poly[(i+1)%poly.length],poly[i]))<minEdge)return{ok:false,reason:`lato ${i+1} troppo corto`};
    for(let i=0;i<poly.length;i++)for(let j=i+1;j<poly.length;j++){
      if(j===i||j===(i+1)%poly.length||i===(j+1)%poly.length)continue;
      if(segCross(poly[i],poly[(i+1)%poly.length],poly[j],poly[(j+1)%poly.length]))return{ok:false,reason:'perimetro auto-intersecante'};
    }
    if(Math.abs(signedArea(poly))<.08)return{ok:false,reason:'area quasi nulla'};
    return{ok:true,area:Math.abs(signedArea(poly))};
  }
  function lineFromPoints(a,b,interiorSign=1){
    const t=n2(s2(b,a));let n=[-t[1],t[0]];n=m2(n,interiorSign);return{a:[...a],b:[...b],t,n,c:d2(n,a)};
  }
  function polygonCentroid(poly){
    const a=signedArea(poly);if(Math.abs(a)<EPS)return poly.reduce((q,p)=>v2(q,p),[0,0]).map(x=>x/poly.length);
    let cx=0,cy=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],k=p[0]*q[1]-q[0]*p[1];cx+=(p[0]+q[0])*k;cy+=(p[1]+q[1])*k}return[cx/(6*a),cy/(6*a)];
  }
  function wallLinesFromFootprint(poly){
    const ctr=polygonCentroid(poly),lines=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],raw=lineFromPoints(a,b,1);if(d2(raw.n,s2(ctr,a))<0){raw.n=m2(raw.n,-1);raw.c=-raw.c}raw.index=i;raw.length=len2(s2(b,a));lines.push(raw);
    }return lines;
  }
  function lineIntersection(l1,l2){
    const det=l1.n[0]*l2.n[1]-l1.n[1]*l2.n[0];if(Math.abs(det)<1e-7)return null;
    return[(l1.c*l2.n[1]-l1.n[1]*l2.c)/det,(l1.n[0]*l2.c-l1.c*l2.n[0])/det];
  }
  function shiftWallLines(lines,offsets){return lines.map((l,i)=>({...l,c:l.c+(offsets[i]||0)}))}
  function footprintFromLines(lines){
    const p=[];for(let i=0;i<lines.length;i++){const prev=lines[(i-1+lines.length)%lines.length],cur=lines[i],q=lineIntersection(prev,cur);if(!q)return null;p.push(q)}return p;
  }

  function observationLevelWeight(level){return level==='base'?3.4:level==='top'?3.0:2.0}
  function rayXZEquation(obs){
    const dx=obs.d[0],dz=obs.d[2],L=Math.hypot(dx,dz);if(L<1e-5)return null;
    const n=[-dz/L,dx/L],b=n[0]*obs.o[0]+n[1]*obs.o[2];return{n,b};
  }
  function intersectRayY(obs,y){
    const dy=obs.d[1];if(Math.abs(dy)<1e-5)return null;const t=(y-obs.o[1])/dy;if(t<=0)return null;return[obs.o[0]+obs.d[0]*t,obs.o[2]+obs.d[2]*t,t];
  }
  function solve2x2(A00,A01,A11,b0,b1){const det=A00*A11-A01*A01;if(Math.abs(det)<1e-9)return null;return[(b0*A11-b1*A01)/det,(A00*b1-A01*b0)/det]}
  function solveCornerXZ(observations,ceilingHeight,prior=null,opts={}){
    const floorY=opts.floorY??0,priorWeight=opts.priorWeight??.55,maxIters=opts.maxIters??5;
    if(!observations?.length)return prior?{xz:[...prior],residual:Infinity,used:0,baseline:0}:null;
    let x=prior?[...prior]:null;
    const seed=[];
    for(const o of observations){
      if(o.level==='base'){const q=intersectRayY(o,floorY);if(q)seed.push([q[0],q[1]])}
      else if(o.level==='top'&&Number.isFinite(ceilingHeight)){const q=intersectRayY(o,floorY+ceilingHeight);if(q)seed.push([q[0],q[1]])}
    }
    if(!x&&seed.length)x=[median(seed.map(q=>q[0])),median(seed.map(q=>q[1]))];
    if(!x){const e=observations.map(rayXZEquation).filter(Boolean);if(e.length>=2){let A00=0,A01=0,A11=0,b0=0,b1=0;for(const q of e){A00+=q.n[0]*q.n[0];A01+=q.n[0]*q.n[1];A11+=q.n[1]*q.n[1];b0+=q.n[0]*q.b;b1+=q.n[1]*q.b}x=solve2x2(A00,A01,A11,b0,b1)}}
    if(!x)return null;
    for(let it=0;it<maxIters;it++){
      const residuals=[];
      for(const o of observations){
        const eq=rayXZEquation(o);if(eq)residuals.push(Math.abs(d2(eq.n,x)-eq.b));
        if(o.level==='base'){const q=intersectRayY(o,floorY);if(q)residuals.push(len2(s2(x,q)))}
        if(o.level==='top'&&Number.isFinite(ceilingHeight)){const q=intersectRayY(o,floorY+ceilingHeight);if(q)residuals.push(len2(s2(x,q)))}
      }
      const scale=Math.max(.015,1.4826*(mad(residuals)||.02)),cut=2.8*scale;
      let A00=0,A01=0,A11=0,b0=0,b1=0;
      const addLine=(n,b,w)=>{A00+=w*n[0]*n[0];A01+=w*n[0]*n[1];A11+=w*n[1]*n[1];b0+=w*n[0]*b;b1+=w*n[1]*b};
      const addPoint=(p,w)=>{A00+=w;A11+=w;b0+=w*p[0];b1+=w*p[1]};
      for(const o of observations){
        const baseW=(o.weight??1)*observationLevelWeight(o.level),eq=rayXZEquation(o);
        if(eq){const r=Math.abs(d2(eq.n,x)-eq.b),w=baseW*(r<=cut?1:cut/Math.max(r,EPS));addLine(eq.n,eq.b,w)}
        if(o.level==='base'){const q=intersectRayY(o,floorY);if(q){const r=len2(s2(x,q)),w=2.2*baseW*(r<=cut?1:cut/Math.max(r,EPS));addPoint(q,w)}}
        if(o.level==='top'&&Number.isFinite(ceilingHeight)){const q=intersectRayY(o,floorY+ceilingHeight);if(q){const r=len2(s2(x,q)),w=1.4*baseW*(r<=cut?1:cut/Math.max(r,EPS));addPoint(q,w)}}
      }
      if(prior){addPoint(prior,priorWeight)}
      const next=solve2x2(A00,A01,A11,b0,b1);if(!next)break;if(len2(s2(next,x))<1e-5){x=next;break}x=next;
    }
    const rs=[];for(const o of observations){const eq=rayXZEquation(o);if(eq)rs.push(Math.abs(d2(eq.n,x)-eq.b))}
    const dirs=observations.map(o=>n2([o.o[0]-x[0],o.o[2]-x[1]])).filter(q=>len2(q)>.5);let maxAngle=0;
    for(let i=0;i<dirs.length;i++)for(let j=i+1;j<dirs.length;j++){const a=Math.acos(clamp(d2(dirs[i],dirs[j]),-1,1));maxAngle=Math.max(maxAngle,a)}
    return{xz:x,residual:median(rs),p90:quantile(rs,.9),used:observations.length,baseline:maxAngle};
  }
  function estimateCeilingHeight(corners,defaultHeight=2.7,opts={}){
    const floorY=opts.floorY??0,minH=opts.minH??1.8,maxH=opts.maxH??5.2,ys=[];
    for(const c of corners){if(!c?.solution?.xz)continue;for(const o of c.observations||[]){if(o.level!=='top')continue;const dx=o.d[0],dz=o.d[2],den=dx*dx+dz*dz;if(den<1e-6)continue;const vx=c.solution.xz[0]-o.o[0],vz=c.solution.xz[1]-o.o[2],t=(vx*dx+vz*dz)/den;if(t<=0)continue;const lateral=Math.hypot(o.o[0]+t*dx-c.solution.xz[0],o.o[2]+t*dz-c.solution.xz[1]);if(lateral>.12)continue;const y=o.o[1]+t*o.d[1],h=y-floorY;if(h>=minH&&h<=maxH)ys.push(h)}}
    if(!ys.length)return{height:defaultHeight,confidence:0,samples:0,spread:Infinity};const h=median(ys),spread=1.4826*(mad(ys,h)||0);return{height:h,confidence:clamp(ys.length/6)*clamp(1-spread/.18),samples:ys.length,spread};
  }
  function solveAllCorners(corners,initialHeight=2.7,opts={}){
    let h=initialHeight;const out=corners.map(c=>({...c,solution:c.solution?{...c.solution}:null}));
    for(let pass=0;pass<5;pass++){
      for(const c of out)c.solution=solveCornerXZ(c.observations||[],h,c.prior,opts)||c.solution;
      const ce=estimateCeilingHeight(out,h,opts);if(ce.samples)h=.55*h+.45*ce.height;
    }
    const ce=estimateCeilingHeight(out,h,opts);return{corners:out,height:ce.samples?ce.height:h,ceiling:ce};
  }
  function cornerQuality(corner){
    const s=corner?.solution;if(!s)return{level:'bad',score:0,reason:'nessuna soluzione'};
    const levels=new Set((corner.observations||[]).map(o=>o.level)),views=new Set((corner.observations||[]).map(o=>o.viewId??o.t));
    const resid=Number.isFinite(s.residual)?s.residual:.3,baseline=s.baseline||0;
    let score=.28*clamp(views.size/3)+.28*clamp(levels.size/2)+.24*clamp(1-resid/.09)+.20*clamp(baseline/(25*Math.PI/180));
    if(views.size<2)score*=.55;if(levels.size<2&&views.size<3)score*=.72;
    const level=score>.72&&resid<.055?'good':score>.43&&resid<.11?'mid':'bad';
    return{level,score,residual:resid,baseline,views:views.size,levels:[...levels]};
  }

  function buildRoomModel(footprint,height,floorY=0){
    const valid=validateFootprint(footprint);if(!valid.ok)throw new Error(valid.reason);
    const poly=signedArea(footprint)>0?footprint.map(p=>[...p]):[...footprint].reverse().map(p=>[...p]);
    const walls=wallLinesFromFootprint(poly).map((l,i)=>({...l,index:i,height,floorY,ceilY:floorY+height}));
    return{footprint:poly,height,floorY,ceilY:floorY+height,walls,area:Math.abs(signedArea(poly)),centroid:polygonCentroid(poly)};
  }
  function rayWallHit(ray,wall,floorY=0,ceilY=2.7){
    const den=wall.n[0]*ray.d[0]+wall.n[1]*ray.d[2];if(Math.abs(den)<1e-7)return null;
    const t=(wall.c-wall.n[0]*ray.o[0]-wall.n[1]*ray.o[2])/den;if(t<=0)return null;
    const p=v3(ray.o,m3(ray.d,t));if(p[1]<floorY-.03||p[1]>ceilY+.03)return null;
    const rel=[p[0]-wall.a[0],p[2]-wall.a[1]],s=d2(rel,wall.t);if(s<-.03||s>wall.length+.03)return null;
    return{t,p,s,h:p[1]-floorY,wallIndex:wall.index};
  }
  function rayRoomHit(ray,model){
    let best=null;
    for(const w of model.walls){const q=rayWallHit(ray,w,model.floorY,model.ceilY);if(q&&(!best||q.t<best.t))best={...q,kind:'wall'}}
    if(ray.d[1]<-1e-6){const t=(model.floorY-ray.o[1])/ray.d[1];if(t>0){const p=v3(ray.o,m3(ray.d,t));if(pointInPolygon([p[0],p[2]],model.footprint)&&(!best||t<best.t))best={t,p,kind:'floor'}}}
    if(ray.d[1]>1e-6){const t=(model.ceilY-ray.o[1])/ray.d[1];if(t>0){const p=v3(ray.o,m3(ray.d,t));if(pointInPolygon([p[0],p[2]],model.footprint)&&(!best||t<best.t))best={t,p,kind:'ceiling'}}}
    return best;
  }
  function nearestShellSurface(p,model){
    let best={distance:Infinity,kind:null,index:-1,projected:null,signed:0};
    const xz=[p[0],p[2]];
    if(pointInPolygon(xz,model.footprint)){
      const df=p[1]-model.floorY;if(Math.abs(df)<best.distance)best={distance:Math.abs(df),kind:'floor',index:-1,projected:[p[0],model.floorY,p[2]],signed:df};
      const dc=p[1]-model.ceilY;if(Math.abs(dc)<best.distance)best={distance:Math.abs(dc),kind:'ceiling',index:-1,projected:[p[0],model.ceilY,p[2]],signed:-dc};
    }
    for(const w of model.walls){
      const signed=w.c-d2(w.n,xz); // With inward wall normal, positive is outside and negative is inside.
      const rel=[p[0]-w.a[0],p[2]-w.a[1]],along=d2(rel,w.t);
      if(along<-.05||along>w.length+.05||p[1]<model.floorY-.05||p[1]>model.ceilY+.05)continue;
      const dist=Math.abs(signed);if(dist<best.distance){const qxz=v2(xz,m2(w.n,signed));best={distance:dist,kind:'wall',index:w.index,projected:[qxz[0],p[1],qxz[1]],signed}}
    }
    return best;
  }
  function pointInsideRoom3D(p,model,margin=.02){return p[1]>=model.floorY-margin&&p[1]<=model.ceilY+margin&&pointInPolygon([p[0],p[2]],model.footprint)}

  function weightedLineOffsets(model,wallSamples,limits=[]){
    const offsets=new Array(model.walls.length).fill(0),stats=[];
    for(const w of model.walls){
      const a=(wallSamples[w.index]||[]).filter(s=>Number.isFinite(s.offset)&&Math.abs(s.offset)<.45&&(s.weight??1)>0);
      if(!a.length){stats.push({count:0,offset:0,spread:Infinity});continue}
      const m=robustWeightedMedian(a,'offset','weight'),dev=a.map(s=>Math.abs(s.offset-m)),spread=1.4826*(median(dev)||0),trim=a.filter(s=>Math.abs(s.offset-m)<Math.max(.035,2.8*spread));
      const off=robustWeightedMedian(trim,'offset','weight'),lim=limits[w.index]??.12;offsets[w.index]=clamp(off,-lim,lim);stats.push({count:a.length,used:trim.length,offset:offsets[w.index],raw:off,spread});
    }
    return{offsets,stats};
  }
  function applyParallelWallRefinement(model,wallSamples,limits=[]){
    const fit=weightedLineOffsets(model,wallSamples,limits),shifted=shiftWallLines(model.walls,fit.offsets),poly=footprintFromLines(shifted);
    if(!poly)return{ok:false,reason:'intersezioni degeneri',fit};const valid=validateFootprint(poly);if(!valid.ok)return{ok:false,reason:valid.reason,fit};
    const next=buildRoomModel(poly,model.height,model.floorY);
    // Preserve the original wall normal/direction exactly.  Rebuilding from the
    // line intersections should already do this numerically, but forcing the
    // authoritative line equation makes the invariant explicit/testable.
    next.walls=shifted.map((l,i)=>({...l,a:poly[i],b:poly[(i+1)%poly.length],length:len2(s2(poly[(i+1)%poly.length],poly[i])),height:model.height,floorY:model.floorY,ceilY:model.ceilY,index:i}));
    return{ok:true,model:next,fit};
  }

  function coverageGrid(cols=24,rows=12){return{cols,rows,xr:new Float32Array(cols*rows),photo:new Float32Array(cols*rows),deep:new Float32Array(cols*rows)}}
  function coverageIndex(grid,u,v){const x=clamp(Math.floor(u*grid.cols),0,grid.cols-1),y=clamp(Math.floor(v*grid.rows),0,grid.rows-1);return y*grid.cols+x}
  function updateCoverage(grid,layer,u,v,value=1){if(!grid||!grid[layer])return;const i=coverageIndex(grid,u,v);grid[layer][i]=Math.max(grid[layer][i],clamp(value))}
  function coverageFraction(grid,layer,threshold=.55){const a=grid?.[layer];if(!a?.length)return 0;let n=0;for(const v of a)if(v>=threshold)n++;return n/a.length}
  function wallUV(wall,p,model){return{u:clamp(d2([p[0]-wall.a[0],p[2]-wall.a[1]],wall.t)/Math.max(wall.length,EPS)),v:clamp((p[1]-model.floorY)/Math.max(model.height,EPS))}}
  function wallPoint(wall,u,v,model){return[wall.a[0]+wall.t[0]*wall.length*u,model.floorY+model.height*v,wall.a[1]+wall.t[1]*wall.length*u]}

  function regressionLinear(samples,transform){
    if(samples.length<6)return null;let active=samples.map(s=>({...s,x:transform(s.r)})).filter(s=>Number.isFinite(s.x)&&Number.isFinite(s.d));if(active.length<6)return null;
    let m=1,b=0;
    for(let it=0;it<5;it++){
      let sw=0,sx=0,sy=0,sxx=0,sxy=0;for(const s of active){const w=s.weight??1;sw+=w;sx+=w*s.x;sy+=w*s.d;sxx+=w*s.x*s.x;sxy+=w*s.x*s.d}const den=sw*sxx-sx*sx;if(Math.abs(den)<1e-9)return null;m=(sw*sxy-sx*sy)/den;b=(sy-m*sx)/sw;
      const rs=active.map(s=>Math.abs(m*s.x+b-s.d)),med=median(rs),scale=Math.max(.02,1.4826*(mad(rs,med)||med||.02)),cut=Math.max(.055,2.8*scale);active=active.filter(s=>Math.abs(m*s.x+b-s.d)<=cut);if(active.length<6)return null;
    }
    const rs=active.map(s=>Math.abs(m*s.x+b-s.d));return{m,b,n:active.length,med:median(rs),p90:quantile(rs,.9)};
  }
  function fitRelativeDepth(samples){
    const direct=regressionLinear(samples,r=>r),inv=regressionLinear(samples,r=>1/Math.max(Math.abs(r),1e-6));
    const score=f=>f?f.med+.25*f.p90+1/Math.sqrt(Math.max(1,f.n)):Infinity,best=score(inv)<score(direct)?{...inv,mode:'inverse'}:{...direct,mode:'direct'};return Number.isFinite(best.med)?best:null;
  }
  function metricDepth(fit,r){if(!fit||!Number.isFinite(r))return NaN;const x=fit.mode==='inverse'?1/Math.max(Math.abs(r),1e-6):r;return fit.m*x+fit.b}

  function voxelKey(p,size){const e=1e-7;return`${Math.floor(p[0]/size+e)},${Math.floor(p[1]/size+e)},${Math.floor(p[2]/size+e)}`}
  function parseVoxelKey(k){return k.split(',').map(Number)}
  function mergeVoxel(map,p,obs,size=.05){
    const k=voxelKey(p,size),w=Math.max(.02,obs.weight??obs.confidence??1),old=map.get(k);
    if(!old){map.set(k,{key:k,p:[...p],color:[...(obs.color||[180,190,200])],weight:w,xr:obs.source==='XR'?1:0,deep:obs.source==='Deep'?1:0,frames:new Set(obs.frameId!=null?[obs.frameId]:[]),count:1});return map.get(k)}
    const nw=old.weight+w;old.p=[0,1,2].map(i=>(old.p[i]*old.weight+p[i]*w)/nw);old.color=[0,1,2].map(i=>Math.round((old.color[i]*old.weight+(obs.color?.[i]??old.color[i])*w)/nw));old.weight=nw;old.count++;if(obs.source==='XR')old.xr++;if(obs.source==='Deep')old.deep++;if(obs.frameId!=null)old.frames.add(obs.frameId);return old;
  }
  function objectVoxelEligible(v){return v.frames.size>=2}
  function connectedVoxelComponents(map,size=.05,minCells=5){
    const keep=new Map([...map].filter(([,v])=>objectVoxelEligible(v))),seen=new Set(),out=[],neigh=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)if(dx||dy||dz)neigh.push([dx,dy,dz]);
    for(const [key,start] of keep){if(seen.has(key))continue;const q=[key],cells=[];seen.add(key);while(q.length){const k=q.pop(),v=keep.get(k);cells.push(v);const ijk=parseVoxelKey(k);for(const d of neigh){const nk=`${ijk[0]+d[0]},${ijk[1]+d[1]},${ijk[2]+d[2]}`;if(keep.has(nk)&&!seen.has(nk)){seen.add(nk);q.push(nk)}}}if(cells.length>=minCells)out.push(cells)}return out;
  }
  function pcaYaw(points){
    if(points.length<2)return 0;const mx=points.reduce((n,p)=>n+p[0],0)/points.length,mz=points.reduce((n,p)=>n+p[2],0)/points.length;let xx=0,xz=0,zz=0;for(const p of points){const x=p[0]-mx,z=p[2]-mz;xx+=x*x;xz+=x*z;zz+=z*z}return .5*Math.atan2(2*xz,xx-zz);
  }
  function objectFromCells(cells,id,size=.05){
    const pts=cells.map(v=>v.p),yaw=pcaYaw(pts),c=Math.cos(yaw),s=Math.sin(yaw),loc=pts.map(p=>[c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]]),mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];for(const p of loc)for(let i=0;i<3;i++){mins[i]=Math.min(mins[i],p[i]);maxs[i]=Math.max(maxs[i],p[i])}const lc=mins.map((x,i)=>(x+maxs[i])/2),wc=[c*lc[0]-s*lc[2],lc[1],s*lc[0]+c*lc[2]],ext=maxs.map((x,i)=>Math.max(size,x-mins[i]+size));
    return{id,name:`Oggetto ${id}`,cells,points:cells.map(v=>({p:v.p,color:v.color,xr:v.xr,deep:v.deep,frames:v.frames.size})),obb:{center:wc,extent:ext,yaw},confidence:clamp(cells.reduce((n,v)=>n+(v.xr?1:.35)+(v.deep>=2?.45:0),0)/(cells.length*1.4)),sources:{xr:cells.reduce((n,v)=>n+(v.xr>0),0),deep:cells.reduce((n,v)=>n+(v.deep>0),0)},status:'active'};
  }
  function voxelSurfaceMesh(cells,size=.05){
    const set=new Set(cells.map(v=>v.key)),verts=[],indices=[],colors=[];
    const faces=[
      [[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]],
      [[-1,0,0],[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]],
      [[0,1,0],[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]],
      [[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],
      [[0,0,1],[[1,0,1],[1,1,1],[0,1,1],[0,0,1]]],
      [[0,0,-1],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]]
    ];
    for(const v of cells){const ijk=parseVoxelKey(v.key),base=[ijk[0]*size,ijk[1]*size,ijk[2]*size];for(const [d,corners] of faces){const nk=`${ijk[0]+d[0]},${ijk[1]+d[1]},${ijk[2]+d[2]}`;if(set.has(nk))continue;const off=verts.length;for(const q of corners){verts.push([base[0]+q[0]*size,base[1]+q[1]*size,base[2]+q[2]*size]);colors.push(v.color)}indices.push(off,off+1,off+2,off,off+2,off+3)}}return{vertices:verts,indices,colors};
  }

  function triangulatePolygon(poly){
    // Ear clipping for simple polygon, outputs indices into the supplied order.
    if(poly.length<3)return[];const ccw=signedArea(poly)>0,idx=[...poly.keys()],out=[];
    const triArea=(a,b,c)=>c2(s2(b,a),s2(c,a));
    const inTri=(p,a,b,c)=>{const s1=triArea(a,b,p),s2v=triArea(b,c,p),s3=triArea(c,a,p),hasN=s1<0||s2v<0||s3<0,hasP=s1>0||s2v>0||s3>0;return!(hasN&&hasP)};
    let guard=0;while(idx.length>3&&guard++<10000){let cut=false;for(let k=0;k<idx.length;k++){const ia=idx[(k-1+idx.length)%idx.length],ib=idx[k],ic=idx[(k+1)%idx.length],a=poly[ia],b=poly[ib],c=poly[ic],ar=triArea(a,b,c);if(ccw?ar<=1e-9:ar>=-1e-9)continue;let inside=false;for(const j of idx){if(j===ia||j===ib||j===ic)continue;if(inTri(poly[j],a,b,c)){inside=true;break}}if(inside)continue;out.push(ia,ib,ic);idx.splice(k,1);cut=true;break}if(!cut)break}if(idx.length===3)out.push(idx[0],idx[1],idx[2]);return out;
  }
  function shellMesh(model){
    const n=model.footprint.length,vertices=[],indices=[],groups=[];
    for(const p of model.footprint)vertices.push([p[0],model.floorY,p[1]]);
    for(const p of model.footprint)vertices.push([p[0],model.ceilY,p[1]]);
    const tri=triangulatePolygon(model.footprint);
    for(let i=0;i<tri.length;i+=3){indices.push(tri[i+2],tri[i+1],tri[i]);groups.push('floor')}
    for(let i=0;i<tri.length;i+=3){indices.push(n+tri[i],n+tri[i+1],n+tri[i+2]);groups.push('ceiling')}
    for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,n+j,i,n+j,n+i);groups.push(`wall:${i}`,`wall:${i}`)}
    return{vertices,indices,groups};
  }
  function edgeUseCounts(mesh){const m=new Map();for(let i=0;i<mesh.indices.length;i+=3){const t=[mesh.indices[i],mesh.indices[i+1],mesh.indices[i+2]];for(let e=0;e<3;e++){const a=Math.min(t[e],t[(e+1)%3]),b=Math.max(t[e],t[(e+1)%3]),k=`${a},${b}`;m.set(k,(m.get(k)||0)+1)}}return m}
  function meshIsClosed(mesh){const c=edgeUseCounts(mesh);return c.size>0&&[...c.values()].every(n=>n===2)}

  function modelLocalTransform(model){
    const p0=model.footprint[0],p1=model.footprint[1],d=n2(s2(p1,p0)),yaw=Math.atan2(d[1],d[0]);
    // Model X follows first wall, model Y is world Y, model Z completes right-handed frame.
    return{origin:[p0[0],model.floorY,p0[1]],yaw,modelToReference:yawTranslationMatrix(-yaw,[p0[0],model.floorY,p0[1]])};
  }

  return{
    EPS,clamp,median,quantile,mad,huber,robustWeightedMedian,
    v2,s2,m2,d2,c2,n2,len2,v3,s3,m3,d3,x3,n3,len3,
    mat4Point,mat4Mul,mat4Identity,yawTranslationMatrix,rigidInverseYawTranslation,projectPoint,rayFromUV,
    signedArea,pointInPolygon,validateFootprint,polygonCentroid,wallLinesFromFootprint,lineIntersection,footprintFromLines,
    intersectRayY,solveCornerXZ,estimateCeilingHeight,solveAllCorners,cornerQuality,
    buildRoomModel,rayWallHit,rayRoomHit,nearestShellSurface,pointInsideRoom3D,weightedLineOffsets,applyParallelWallRefinement,
    coverageGrid,coverageIndex,updateCoverage,coverageFraction,wallUV,wallPoint,
    fitRelativeDepth,metricDepth,voxelKey,mergeVoxel,objectVoxelEligible,connectedVoxelComponents,objectFromCells,voxelSurfaceMesh,
    triangulatePolygon,shellMesh,edgeUseCounts,meshIsClosed,modelLocalTransform
  };
});
