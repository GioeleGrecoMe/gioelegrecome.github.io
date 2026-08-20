/**
 * Sparse surfel + TSDF fusion for room-scale dense depth maps.
 *
 * The surfel map provides a lightweight live overlay. The TSDF map is the
 * geometry authority for meshing; Gaussian-like splats are derived from
 * confirmed surfels only, never directly from sparse SLAM points.
 */
export class SparseDenseFusion{
  constructor({voxel=.035,truncation=null,maxSurfels=180000,maxTsdf=450000,minSupport=2}={}){this.voxel=voxel;this.truncation=truncation||voxel*3;this.maxSurfels=maxSurfels;this.maxTsdf=maxTsdf;this.minSupport=minSupport;this.surfels=new Map();this.tsdf=new Map();this.frames=0;this.samplesIn=0;}
  integrate(samples,{origin=[0,0,0],frameId=`f${this.frames}`}={}){
    this.frames++;let accepted=0;const seen=new Set();
    for(const s of samples||[]){if(!finite3(s?.p)||!(s.confidence>0))continue;accepted++;this.samplesIn++;this._integrateSurfel(s,frameId,seen);this._integrateTsdf(s,origin);}
    return {accepted,frames:this.frames,surfels:this.surfels.size,tsdfVoxels:this.tsdf.size};
  }
  _integrateSurfel(s,frameId,seen){const p=s.p,n=norm(s.normal||[0,0,1]),key=voxelKey(p,this.voxel),old=this.surfels.get(key),w=Math.max(.05,Math.min(1,+s.confidence||.2));if(old){if(dot(old.n,n)<.35)return;const nw=old.weight+w;old.p=mix3(old.p,p,w/nw);old.n=norm(mix3(old.n,n,w/nw));old.color=mix3(old.color,s.color||old.color,w/nw);old.radius=(old.radius*old.weight+(+s.radius||this.voxel*.55)*w)/nw;old.confidence=Math.min(1,(old.confidence*old.weight+w*w)/nw);old.weight=nw;if(!seen.has(key)){old.support++;old.lastFrame=frameId;seen.add(key);}}else if(this.surfels.size<this.maxSurfels){this.surfels.set(key,{p:[...p],n,color:(s.color||[180,200,220]).map(Number),radius:+s.radius||this.voxel*.55,confidence:w,weight:w,support:1,lastFrame:frameId});seen.add(key);}}
  _integrateTsdf(s,origin){if(this.tsdf.size>=this.maxTsdf)return;const p=s.p,ray=sub(p,origin),dist=Math.hypot(...ray);if(dist<1e-5)return;const d=ray.map(v=>v/dist),tr=Math.max(this.truncation,(+s.radius||0)*2),step=this.voxel,baseW=Math.max(.05,Math.min(1,+s.confidence||.2));for(let off=-tr;off<=tr+1e-8;off+=step){const t=dist+off;if(t<=0)continue;const q=[origin[0]+d[0]*t,origin[1]+d[1]*t,origin[2]+d[2]*t],key=voxelKey(q,this.voxel),sd=clamp(-off/tr,-1,1),old=this.tsdf.get(key),w=baseW*(1-.35*Math.abs(sd));if(old){const nw=old.w+w;old.d=(old.d*old.w+sd*w)/nw;old.w=Math.min(255,nw);if(Math.abs(sd)<.45)old.color=mix3(old.color,s.color||old.color,w/nw);}else if(this.tsdf.size<this.maxTsdf)this.tsdf.set(key,{d:sd,w,color:(s.color||[180,200,220]).map(Number)});}}
  confirmedSurfels({max=50000}={}){const arr=[];for(const s of this.surfels.values())if(s.support>=this.minSupport&&s.confidence>=.12)arr.push(s);arr.sort((a,b)=>(b.support+b.confidence)-(a.support+a.confidence));return arr.slice(0,max);}
  splats(opts={}){return this.confirmedSurfels(opts).map(s=>({position:s.p,normal:s.n,color:s.color.map(v=>Math.round(clamp(v,0,255))),scale:[Math.max(.004,s.radius*1.55),Math.max(.004,s.radius*1.55),Math.max(.002,s.radius*.32)],opacity:clamp(.20+.13*s.support+.45*s.confidence,.25,.92),confidence:s.confidence,support:s.support}));}
  mesh({maxTriangles=90000}={}){return extractTsdfMesh(this.tsdf,this.voxel,maxTriangles);}
}

export function extractTsdfMesh(map,voxel,maxTriangles=90000){
  const vertices=[],colors=[],faces=[],vmap=new Map(),get=(x,y,z)=>map.get(`${x},${y},${z}`),keys=[...map.keys()],tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],corner=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  let tri=0;
  for(const k of keys){if(tri>=maxTriangles)break;const [x,y,z]=k.split(',').map(Number),vals=corner.map(c=>get(x+c[0],y+c[1],z+c[2]));if(vals.filter(Boolean).length<6)continue;const d=vals.map(v=>v?.d??1);if(Math.min(...d)>0||Math.max(...d)<0)continue;const pos=corner.map(c=>[(x+c[0]) * voxel,(y+c[1])*voxel,(z+c[2])*voxel]);
    for(const t of tetra){const inside=t.filter(i=>d[i]<0),outside=t.filter(i=>d[i]>=0);if(!inside.length||!outside.length)continue;const pts=[];for(const a of inside)for(const b of outside){const den=d[a]-d[b],u=Math.abs(den)<1e-8?.5:d[a]/den,pp=[pos[a][0]+(pos[b][0]-pos[a][0])*u,pos[a][1]+(pos[b][1]-pos[a][1])*u,pos[a][2]+(pos[b][2]-pos[a][2])*u],ca=vals[a]?.color||[180,200,220],cb=vals[b]?.color||ca,cc=[ca[0]+(cb[0]-ca[0])*u,ca[1]+(cb[1]-ca[1])*u,ca[2]+(cb[2]-ca[2])*u];pts.push({p:pp,c:cc});}
      if(pts.length<3)continue;if(pts.length===3){addTri(pts[0],pts[1],pts[2]);}else{addTri(pts[0],pts[1],pts[2]);if(tri<maxTriangles)addTri(pts[0],pts[2],pts[3]);}if(tri>=maxTriangles)break;
    }
    function addTri(a,b,c){const ia=vid(a),ib=vid(b),ic=vid(c);if(ia===ib||ib===ic||ia===ic)return;faces.push(ia,ib,ic);tri++;}
    function vid(v){const q=.18*voxel,key2=`${Math.round(v.p[0]/q)},${Math.round(v.p[1]/q)},${Math.round(v.p[2]/q)}`;let id=vmap.get(key2);if(id!==undefined)return id;id=vertices.length/3;vertices.push(...v.p);colors.push(...v.c.map(x=>Math.round(clamp(x,0,255))));vmap.set(key2,id);return id;}
  }
  return {voxelM:voxel,occupiedVoxels:map.size,vertices:new Float32Array(vertices),colors:new Uint8Array(colors),faces:new Uint32Array(faces)};
}

function voxelKey(p,v){return `${Math.floor(p[0]/v)},${Math.floor(p[1]/v)},${Math.floor(p[2]/v)}`;}function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}function clamp(v,a,b){return Math.max(a,Math.min(b,v));}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function norm(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}function mix3(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
