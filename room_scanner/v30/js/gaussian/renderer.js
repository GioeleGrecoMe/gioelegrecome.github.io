/**
 * V30.13 review renderer.
 *
 * This remains dependency-free but is now intentionally navigable: one finger
 * orbits, two fingers pan + pinch zoom, wheel zooms, double-tap fits, and the
 * view contains a ground grid / XYZ axes so room orientation is immediately
 * understandable. A metric occupancy mesh can be overlaid as a wireframe.
 */
export class GaussianRenderer{
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.items=[];this.mesh=null;this.yaw=.55;this.pitch=-.28;this.distance=4;this.center=[0,0,0];this.pan=[0,0];this.splat=1;this._pointers=new Map();this._gesture=null;this._bind();this.resize();}
  setData(items){this.items=normalize(items);this.fit();this.draw();}
  setMesh(mesh){this.mesh=mesh||null;this.draw();}
  setSplatSize(v){this.splat=Number(v)||1;this.draw();}
  setPreset(name){if(name==='top'){this.yaw=0;this.pitch=-Math.PI/2+.02;}else if(name==='front'){this.yaw=0;this.pitch=0;}else if(name==='side'){this.yaw=Math.PI/2;this.pitch=0;}else{this.yaw=.55;this.pitch=-.28;}this.draw();}
  fit(){
    const pts=this.items.map(x=>x.p);if(this.mesh?.vertices?.length)for(let i=0;i<this.mesh.vertices.length;i+=3)pts.push([this.mesh.vertices[i],this.mesh.vertices[i+1],this.mesh.vertices[i+2]]);
    if(!pts.length){this.center=[0,0,0];this.distance=4;this.pan=[0,0];return;}const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of pts)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}this.center=min.map((v,k)=>(v+max[k])/2);const diag=Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2]);this.distance=Math.max(.45,diag*1.45);this.pan=[0,0];}
  resize(){const r=this.canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);this.canvas.width=Math.max(1,Math.round(r.width*dpr));this.canvas.height=Math.max(1,Math.round(r.height*dpr));this.ctx.setTransform(dpr,0,0,dpr,0,0);this.draw();}
  _view(p,w,h){let x=p[0]-this.center[0],y=p[1]-this.center[1],z=p[2]-this.center[2];const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),x1=cy*x-sy*z,z1=sy*x+cy*z,y1=cp*y-sp*z1,z2=sp*y+cp*z1+this.distance;if(z2<=.03)return null;const f=Math.min(w,h)*.82;return {x:w/2+this.pan[0]+f*x1/z2,y:h/2+this.pan[1]-f*y1/z2,z:z2,f};}
  draw(){
    const r=this.canvas.getBoundingClientRect(),w=r.width,h=r.height,g=this.ctx;if(!w||!h)return;g.clearRect(0,0,w,h);const grd=g.createLinearGradient(0,0,0,h);grd.addColorStop(0,'#07101a');grd.addColorStop(1,'#020407');g.fillStyle=grd;g.fillRect(0,0,w,h);this._drawGrid(g,w,h);this._drawMesh(g,w,h);
    const pts=[];for(const s of this.items){const p=this._view(s.p,w,h);if(!p)continue;const rx=Math.max(.55,Math.min(18,(s.scale[0]||s.r||.02)*p.f/p.z*6.5*this.splat)),ry=Math.max(.55,Math.min(18,(s.scale[1]||s.r||.02)*p.f/p.z*6.5*this.splat));pts.push({...p,rx,ry,c:s.c,a:s.a,q:s.q});}pts.sort((a,b)=>b.z-a.z);
    for(const p of pts){g.globalAlpha=Math.max(.05,Math.min(.9,p.a*(.45+.55*p.q)));g.fillStyle=`rgb(${p.c[0]},${p.c[1]},${p.c[2]})`;g.beginPath();g.ellipse(p.x,p.y,p.rx,p.ry,0,0,Math.PI*2);g.fill();}g.globalAlpha=1;this._drawAxes(g,w,h);
  }
  _drawGrid(g,w,h){g.save();g.lineWidth=1;for(let i=-10;i<=10;i++){const a=this._view([this.center[0]+i*.25,this.center[1]-.02,this.center[2]-2.5],w,h),b=this._view([this.center[0]+i*.25,this.center[1]-.02,this.center[2]+2.5],w,h),c=this._view([this.center[0]-2.5,this.center[1]-.02,this.center[2]+i*.25],w,h),d=this._view([this.center[0]+2.5,this.center[1]-.02,this.center[2]+i*.25],w,h);g.strokeStyle=i===0?'rgba(160,190,220,.28)':'rgba(130,160,190,.10)';if(a&&b){g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();}if(c&&d){g.beginPath();g.moveTo(c.x,c.y);g.lineTo(d.x,d.y);g.stroke();}}g.restore();}
  _drawAxes(g,w,h){const o=this._view(this.center,w,h);if(!o)return;for(const [v,c] of [[[.35,0,0],'#ff6868'],[[0,.35,0],'#64ff92'],[[0,0,.35],'#5aa8ff']]){const p=this._view([this.center[0]+v[0],this.center[1]+v[1],this.center[2]+v[2]],w,h);if(!p)continue;g.strokeStyle=c;g.lineWidth=2;g.beginPath();g.moveTo(o.x,o.y);g.lineTo(p.x,p.y);g.stroke();}g.lineWidth=1;}
  _drawMesh(g,w,h){const V=this.mesh?.vertices,F=this.mesh?.faces;if(!V?.length||!F?.length)return;g.save();g.strokeStyle='rgba(92,255,141,.25)';g.lineWidth=.8;const step=Math.max(1,Math.ceil((F.length/3)/5000));for(let fi=0;fi<F.length/3;fi+=step){const ids=[F[fi*3],F[fi*3+1],F[fi*3+2]],ps=ids.map(id=>this._view([V[id*3],V[id*3+1],V[id*3+2]],w,h));if(ps.some(x=>!x))continue;g.beginPath();g.moveTo(ps[0].x,ps[0].y);g.lineTo(ps[1].x,ps[1].y);g.lineTo(ps[2].x,ps[2].y);g.closePath();g.stroke();}g.restore();}
  _bind(){
    const c=this.canvas;c.style.touchAction='none';c.addEventListener('pointerdown',e=>{c.setPointerCapture?.(e.pointerId);this._pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this._gesture=this._snapshotGesture();});
    c.addEventListener('pointermove',e=>{if(!this._pointers.has(e.pointerId))return;const old=this._pointers.get(e.pointerId);this._pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(this._pointers.size===1){this.yaw+=(e.clientX-old.x)*.008;this.pitch=Math.max(-1.54,Math.min(1.54,this.pitch+(e.clientY-old.y)*.008));}else if(this._pointers.size>=2){const cur=this._snapshotGesture(),prev=this._gesture;if(prev&&cur){if(prev.dist>1)this.distance=Math.max(.12,this.distance*(prev.dist/cur.dist));this.pan[0]+=cur.cx-prev.cx;this.pan[1]+=cur.cy-prev.cy;}this._gesture=cur;}this.draw();});
    const up=e=>{this._pointers.delete(e.pointerId);this._gesture=this._snapshotGesture();};c.addEventListener('pointerup',up);c.addEventListener('pointercancel',up);c.addEventListener('wheel',e=>{e.preventDefault();this.distance=Math.max(.12,this.distance*Math.exp(e.deltaY*.001));this.draw();},{passive:false});c.addEventListener('dblclick',()=>{this.fit();this.draw();});addEventListener('resize',()=>this.resize());
  }
  _snapshotGesture(){const p=[...this._pointers.values()];if(p.length<2)return null;return {cx:(p[0].x+p[1].x)/2,cy:(p[0].y+p[1].y)/2,dist:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)};}
}
function normalize(items){if(!Array.isArray(items))return [];return items.map(g=>{const p=g.position||g.p||g.mean||g.xyz||[0,0,0],c=g.color||g.rgb||[180,210,240],scale=g.scale||g.scales||[g.radius||.02,g.radius||.02,g.radius||.02],S=Array.isArray(scale)?scale.map(Number):[Number(scale),Number(scale),Number(scale)],r=Math.max(...S);return {p:p.map(Number),c:c.map(v=>Math.max(0,Math.min(255,Number(v)||0))),scale:S.map(v=>Number.isFinite(v)&&v>0?v:.02),r:Number.isFinite(r)?r:.02,a:Number(g.opacity??g.alpha??1),q:Number(g.confidence??.6)}}).filter(g=>g.p.every(Number.isFinite));}
