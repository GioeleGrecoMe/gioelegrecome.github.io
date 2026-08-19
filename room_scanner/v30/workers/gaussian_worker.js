/*
 * V30.14 robust surfel/Gaussian accumulator.
 *
 * Important terminology: this worker performs online multi-view fusion of MVS
 * surface samples into anisotropic splats. It is NOT the offline differentiable
 * optimisation used by the original 3D Gaussian Splatting training pipeline.
 * The goal here is a stable real-time map for AR feedback and later meshing.
 */
let cfg={voxel:.022,maxGaussians:260000,maxSnapshot:90000,minSupport:2,maxResidualVoxel:1.8};
const voxels=new Map();let ingestSerial=0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function cell(p){const v=cfg.voxel||.022;return [Math.round(p[0]/v),Math.round(p[1]/v),Math.round(p[2]/v)];}
const cellKey=c=>`${c[0]},${c[1]},${c[2]}`;
function validP(p){return p&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}
function addOne(g,sourceId){
  const p=g?.position||g?.p||g?.mean||g?.xyz;if(!validP(p))return false;
  const c=cell(p),k=cellKey(c),confidence=clamp(Number(g?.confidence??g?.weight??.55)||.55,.04,1),rgb=g?.color||g?.rgb||[180,210,240],opacity=clamp(Number(g?.opacity??g?.alpha??.62)||.62,.05,1),scale=Array.isArray(g?.scale||g?.scales)?(g.scale||g.scales).slice(0,3).map(Number):[cfg.voxel,cfg.voxel,cfg.voxel];
  let a=voxels.get(k);
  if(!a){if(voxels.size>=cfg.maxGaussians)return false;a={cell:c,mean:[+p[0],+p[1],+p[2]],m2:[0,0,0],color:[+rgb[0]||180,+rgb[1]||210,+rgb[2]||240],scale:scale.map(v=>Number.isFinite(v)&&v>0?v:cfg.voxel),weight:confidence,n:1,opacityWeight:opacity*confidence,sources:new Set([sourceId])};voxels.set(k,a);return true;}
  // Reject a sample that is geometrically inconsistent even inside the same
  // quantisation cell. This prevents repeated bad triangulations from dragging
  // a good surfel around over time.
  const residual=Math.hypot(p[0]-a.mean[0],p[1]-a.mean[1],p[2]-a.mean[2]);if(a.n>=3&&residual>cfg.voxel*cfg.maxResidualVoxel)return false;
  const oldW=a.weight,newW=oldW+confidence;
  for(let i=0;i<3;i++){const delta=p[i]-a.mean[i],next=a.mean[i]+confidence/newW*delta;a.m2[i]+=confidence*delta*(p[i]-next);a.mean[i]=next;a.color[i]=(a.color[i]*oldW+(+rgb[i]||a.color[i])*confidence)/newW;a.scale[i]=(a.scale[i]*oldW+(Number(scale[i])||cfg.voxel)*confidence)/newW;}
  a.weight=newW;a.n++;a.opacityWeight+=opacity*confidence;a.sources.add(sourceId);if(a.sources.size>24){const first=a.sources.values().next().value;a.sources.delete(first);}return true;
}
function ingest(data,sourceId){let added=0,rejected=0;if(Array.isArray(data)){for(const g of data)(addOne(g,sourceId)?added++:rejected++);return {added,rejected};}const ps=data?.positions;if(ps&&(Array.isArray(ps)||ArrayBuffer.isView(ps))){const cs=data.colors||data.rgb,op=data.opacities||data.opacity,sc=data.scales||data.scale,cf=data.confidence||data.confidences;for(let i=0;i+2<ps.length;i+=3){const j=i/3,g={position:[+ps[i],+ps[i+1],+ps[i+2]],color:cs&&cs.length>=i+3?[cs[i],cs[i+1],cs[i+2]]:null,opacity:op?op[j]:.62,scale:sc&&sc.length>=i+3?[sc[i],sc[i+1],sc[i+2]]:null,confidence:cf?cf[j]:.55};(addOne(g,sourceId)?added++:rejected++);}}return {added,rejected};}
function neighborCount(a){let n=0;const [x,y,z]=a.cell;for(const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])if(voxels.has(`${x+d[0]},${y+d[1]},${z+d[2]}`))n++;return n;}
function item(a){
  const support=a.sources.size,neighbors=neighborCount(a),var3=a.m2.map(v=>Math.max(0,v/Math.max(.001,a.weight))),sigma=var3.map(Math.sqrt),base=a.scale.map((v,i)=>clamp(Math.max(v*.65,sigma[i]*1.7,cfg.voxel*.38),cfg.voxel*.28,cfg.voxel*2.8));
  const quality=clamp(.20+.14*Math.min(4,support)+.055*Math.min(4,neighbors)+.035*Math.min(5,a.n),.12,1),meanOpacity=a.opacityWeight/Math.max(.001,a.weight),opacity=clamp(meanOpacity*quality,.08,.97);
  return {position:a.mean.map(Number),color:a.color.map(v=>Math.round(clamp(v,0,255))),opacity,scale:base,support,observations:a.n,confidence:quality,neighbors};
}
function snapshot(limit=cfg.maxSnapshot){
  const all=[];for(const a of voxels.values()){const support=a.sources.size,neighbors=neighborCount(a);
    // Never show a completely isolated one-view floater, even during warm-up.
    // A single-view sample may still appear if it is supported by a local
    // surface neighbourhood; otherwise it must be seen again from another view.
    if(support<cfg.minSupport&&a.n<3&&neighbors<2)continue;all.push(item(a));}
  // Prefer repeatedly observed, spatially supported splats when a phone cannot
  // render the whole map at once.
  all.sort((a,b)=>(b.support*2+b.neighbors+b.confidence)-(a.support*2+a.neighbors+a.confidence));const step=Math.max(1,Math.ceil(all.length/Math.max(1,limit)));return all.filter((_,i)=>i%step===0).slice(0,limit);
}
self.onmessage=e=>{const d=e.data||{};try{
  if(d.type==='init'){cfg={...cfg,...(d.config||{})};postMessage({type:'ready',config:cfg});return;}
  if(d.type==='clear'){voxels.clear();postMessage({type:'cleared'});return;}
  if(d.type==='add'||d.type==='points'||d.type==='integrate'){const sourceId=String(d.sourceId??`batch-${ingestSerial++}`),r=ingest(d.gaussians||d.points||d.payload||d,sourceId),snap=snapshot();postMessage({type:'snapshot',count:voxels.size,visibleCount:snap.length,gaussians:snap,added:r.added,rejected:r.rejected});return;}
  if(d.type==='snapshot'||d.type==='flush'){const snap=snapshot(d.maxSnapshot);postMessage({type:'snapshot',count:voxels.size,visibleCount:snap.length,gaussians:snap});return;}
  postMessage({type:'status',count:voxels.size});
}catch(err){postMessage({type:'error',message:err.message,stack:err.stack});}};
