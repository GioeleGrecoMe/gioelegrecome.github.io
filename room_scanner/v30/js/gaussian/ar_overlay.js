import {projectPoint} from '../slam/math.js';
import {analysisPixelToSource,sourcePixelToViewport} from '../camera.js';

/** Live reconstruction overlay registered to the same camera pose used by MVS. */
export class LiveReconstructionOverlay{
  constructor(canvas,{maxSplats=3200}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.maxSplats=maxSplats;this.gaussians=[];this.mesh=null;this.mode='gs';this.referencePoint=null;this.geometryAnchors=[];this._lastSize='';this.canvas.style.pointerEvents='none';this.canvas.style.zIndex='2';}
  setGaussians(g){this.gaussians=Array.isArray(g)?g:[];}
  setMesh(m){this.mesh=m||null;}
  setReferencePoint(p){this.referencePoint=Array.isArray(p)&&p.length>=3?p.slice(0,3).map(Number):null;return this.referencePoint;}
  setGeometryAnchors(xs){this.geometryAnchors=(xs||[]).filter(x=>Array.isArray(x?.p)&&x.p.length>=3).slice(0,120);}
  setMode(mode){this.mode=['gs','mesh','both','off'].includes(mode)?mode:'gs';this.canvas.style.display=this.mode==='off'?'none':'block';return this.mode;}
  cycleMode(){const seq=['gs','both','mesh','off'];return this.setMode(seq[(seq.indexOf(this.mode)+1)%seq.length]);}
  draw({pose,K,geometry,video,framePoints=[]}={}){
    if(this.mode==='off'||!pose||!K||!geometry||!video)return;const rect=video.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),dpr=Math.min(2,devicePixelRatio||1),key=`${Math.round(w)}x${Math.round(h)}@${dpr}`;
    if(key!==this._lastSize){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);this.canvas.style.width=`${w}px`;this.canvas.style.height=`${h}px`;this.ctx.setTransform(dpr,0,0,dpr,0,0);this._lastSize=key;}
    const g=this.ctx;g.clearRect(0,0,w,h);this._drawAlvaPoints(g,{framePoints,geometry,w,h});this._drawGeometryAnchors(g,{pose,K,geometry,w,h});if(this.mode==='gs'||this.mode==='both')this._drawGaussians(g,{pose,K,geometry,w,h});if((this.mode==='mesh'||this.mode==='both')&&this.mesh)this._drawMesh(g,{pose,K,geometry,w,h});this._drawReference(g,{pose,K,geometry,w,h});
  }
  _project(p,pose,K,geometry,w,h){const pr=projectPoint(pose,K,p);if(!pr)return null;const src=analysisPixelToSource(geometry,pr.u,pr.v),vp=sourcePixelToViewport(geometry,src.x,src.y,w,h);if(vp.x< -40||vp.y< -40||vp.x>w+40||vp.y>h+40)return null;return {...vp,z:pr.z};}

  _drawAlvaPoints(g,{framePoints,geometry,w,h}){
    if(!framePoints?.length)return;g.save();g.fillStyle='rgba(92,255,141,.72)';const step=Math.max(1,Math.ceil(framePoints.length/450));
    for(let i=0;i<framePoints.length;i+=step){const p=framePoints[i];if(!Number.isFinite(+p?.x)||!Number.isFinite(+p?.y))continue;const src=analysisPixelToSource(geometry,+p.x,+p.y),vp=sourcePixelToViewport(geometry,src.x,src.y,w,h);if(vp.x<0||vp.y<0||vp.x>w||vp.y>h)continue;g.fillRect(vp.x-1,vp.y-1,3,3);}g.restore();
  }

  _drawGeometryAnchors(g,{pose,K,geometry,w,h}){
    if(!this.geometryAnchors?.length)return;g.save();g.fillStyle='rgba(70,235,255,.92)';g.strokeStyle='rgba(5,35,45,.85)';g.lineWidth=1;
    for(const a of this.geometryAnchors){const pr=this._project(a.p,pose,K,geometry,w,h);if(!pr)continue;const r=2.2+2*Math.max(0,Math.min(1,Number(a.confidence||.5)));g.beginPath();g.arc(pr.x,pr.y,r,0,Math.PI*2);g.fill();g.stroke();}
    g.restore();
  }
  _drawReference(g,{pose,K,geometry,w,h}){
    if(!this.referencePoint)return;const pr=this._project(this.referencePoint,pose,K,geometry,w,h);if(!pr)return;g.save();g.strokeStyle='rgba(255,224,82,.96)';g.fillStyle='rgba(8,12,18,.78)';g.lineWidth=2;g.beginPath();g.arc(pr.x,pr.y,12,0,Math.PI*2);g.fill();g.stroke();g.beginPath();g.moveTo(pr.x-18,pr.y);g.lineTo(pr.x+18,pr.y);g.moveTo(pr.x,pr.y-18);g.lineTo(pr.x,pr.y+18);g.stroke();g.font='700 12px system-ui';g.fillStyle='#ffe052';g.fillText('REPERE',pr.x+16,pr.y-14);g.restore();
  }
  _drawGaussians(g,{pose,K,geometry,w,h}){
    if(!this.gaussians.length)return;const ranked=this.gaussians.length>this.maxSplats?[...this.gaussians].sort((a,b)=>(b.confidence||0)+(b.support||0)*.15-(a.confidence||0)-(a.support||0)*.15).slice(0,this.maxSplats):this.gaussians,pts=[];
    for(const s of ranked){
      const p=s.position||s.p;if(!p)continue;const pr=this._project(p,pose,K,geometry,w,h);if(!pr||pr.z<.12||pr.z>12)continue;
      // True 3DGS projection: project the full world covariance through the
      // current camera Jacobian. Rotated/oblique surface splats therefore appear
      // as rotated ellipses instead of axis-aligned disks based on scale[0:2].
      const e=projectGaussianEllipse(s,pose,K,geometry,pr);
      const sc=s.scale||[.02,.02,.02],fallbackX=Math.max(.65,K.fx*Math.max(.003,Number(sc[0])||.02)/pr.z*(geometry.sw/geometry.targetWidth)*pr.scale),fallbackY=Math.max(.65,K.fy*Math.max(.003,Number(sc[1])||.02)/pr.z*(geometry.sh/geometry.targetHeight)*pr.scale);
      const rx=Math.min(28,e?.rx??fallbackX),ry=Math.min(28,e?.ry??fallbackY),angle=e?.angle??0;pts.push({x:pr.x,y:pr.y,z:pr.z,rx,ry,angle,c:s.color||[100,210,255],a:Number(s.opacity??.55),q:Number(s.confidence??.5)});
    }
    pts.sort((a,b)=>b.z-a.z);g.save();g.globalCompositeOperation='source-over';for(const p of pts){g.globalAlpha=Math.max(.05,Math.min(.82,p.a*(.52+.48*p.q)));g.fillStyle=`rgb(${p.c[0]|0},${p.c[1]|0},${p.c[2]|0})`;g.beginPath();g.ellipse(p.x,p.y,p.rx,p.ry,p.angle,0,Math.PI*2);g.fill();}g.restore();
  }
  _drawMesh(g,{pose,K,geometry,w,h}){const m=this.mesh,V=m?.vertices,F=m?.faces;if(!V?.length||!F?.length)return;g.save();g.strokeStyle='rgba(92,255,141,.38)';g.lineWidth=1;const maxFaces=2600,step=Math.max(1,Math.ceil((F.length/3)/maxFaces));for(let fi=0;fi<F.length/3;fi+=step){const a=F[fi*3]*3,b=F[fi*3+1]*3,c=F[fi*3+2]*3,pa=this._project([V[a],V[a+1],V[a+2]],pose,K,geometry,w,h),pb=this._project([V[b],V[b+1],V[b+2]],pose,K,geometry,w,h),pc=this._project([V[c],V[c+1],V[c+2]],pose,K,geometry,w,h);if(!pa||!pb||!pc)continue;g.beginPath();g.moveTo(pa.x,pa.y);g.lineTo(pb.x,pb.y);g.lineTo(pc.x,pc.y);g.closePath();g.stroke();}g.restore();}
}


function projectGaussianEllipse(s,pose,K,geometry,pr){
  const C=s.covariance;if(!validCov(C)||!pose?.q)return null;const z=pr.z,x=(pr.u-K.cx)*z/K.fx,y=(pr.v-K.cy)*z/K.fy,R=rotationFromQuat(pose.q);
  const ju=[K.fx/z,0,-K.fx*x/(z*z)],jv=[0,K.fy/z,-K.fy*y/(z*z)],wu=cameraJacobianToWorld(ju,R),wv=cameraJacobianToWorld(jv,R);
  const sx=(geometry.sw/geometry.targetWidth)*pr.scale,sy=(geometry.sh/geometry.targetHeight)*pr.scale;
  const a=Math.max(1e-8,quad(C,wu)*sx*sx),b=bilinear(C,wu,wv)*sx*sy,c=Math.max(1e-8,quad(C,wv)*sy*sy),tr=(a+c)*.5,d=Math.sqrt(Math.max(0,((a-c)*.5)**2+b*b)),l1=Math.max(1e-8,tr+d),l2=Math.max(1e-8,tr-d);
  // Two sigma contains ~86% of a 2D Gaussian and is visually stable for the
  // lightweight Canvas2D renderer.
  return {rx:Math.max(.55,2*Math.sqrt(l1)),ry:Math.max(.55,2*Math.sqrt(l2)),angle:.5*Math.atan2(2*b,a-c)};
}
function cameraJacobianToWorld(j,R){return [j[0]*R[0]+j[1]*R[1]+j[2]*R[2],j[0]*R[3]+j[1]*R[4]+j[2]*R[5],j[0]*R[6]+j[1]*R[7]+j[2]*R[8]];}
function quad(C,v){return v[0]*(C[0]*v[0]+C[1]*v[1]+C[2]*v[2])+v[1]*(C[1]*v[0]+C[3]*v[1]+C[4]*v[2])+v[2]*(C[2]*v[0]+C[4]*v[1]+C[5]*v[2]);}
function bilinear(C,a,b){return a[0]*(C[0]*b[0]+C[1]*b[1]+C[2]*b[2])+a[1]*(C[1]*b[0]+C[3]*b[1]+C[4]*b[2])+a[2]*(C[2]*b[0]+C[4]*b[1]+C[5]*b[2]);}
function validCov(C){return Array.isArray(C)&&C.length>=6&&C.slice(0,6).every(Number.isFinite);}
function rotationFromQuat(q){let [x,y,z,w]=(q||[0,0,0,1]).map(Number),n=Math.hypot(x,y,z,w)||1;x/=n;y/=n;z/=n;w/=n;return [1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)];}
