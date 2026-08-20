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
    for(const s of ranked){const p=s.position||s.p;if(!p)continue;const pr=this._project(p,pose,K,geometry,w,h);if(!pr||pr.z<.12||pr.z>12)continue;const sc=s.scale||[.02,.02,.02],rxA=Math.max(.65,(K.fx*Math.max(.004,Number(sc[0])||.02)/pr.z)),ryA=Math.max(.65,(K.fy*Math.max(.004,Number(sc[1])||.02)/pr.z)),displayScale=pr.scale,rx=Math.min(22,rxA*(geometry.sw/geometry.targetWidth)*displayScale),ry=Math.min(22,ryA*(geometry.sh/geometry.targetHeight)*displayScale);pts.push({x:pr.x,y:pr.y,z:pr.z,rx,ry,c:s.color||[100,210,255],a:Number(s.opacity??.55),q:Number(s.confidence??.5)});}
    pts.sort((a,b)=>b.z-a.z);g.save();g.globalCompositeOperation='source-over';for(const p of pts){g.globalAlpha=Math.max(.06,Math.min(.80,p.a*(.55+.45*p.q)));g.fillStyle=`rgb(${p.c[0]|0},${p.c[1]|0},${p.c[2]|0})`;g.beginPath();g.ellipse(p.x,p.y,p.rx,p.ry,0,0,Math.PI*2);g.fill();}g.restore();
  }
  _drawMesh(g,{pose,K,geometry,w,h}){const m=this.mesh,V=m?.vertices,F=m?.faces;if(!V?.length||!F?.length)return;g.save();g.strokeStyle='rgba(92,255,141,.38)';g.lineWidth=1;const maxFaces=2600,step=Math.max(1,Math.ceil((F.length/3)/maxFaces));for(let fi=0;fi<F.length/3;fi+=step){const a=F[fi*3]*3,b=F[fi*3+1]*3,c=F[fi*3+2]*3,pa=this._project([V[a],V[a+1],V[a+2]],pose,K,geometry,w,h),pb=this._project([V[b],V[b+1],V[b+2]],pose,K,geometry,w,h),pc=this._project([V[c],V[c+1],V[c+2]],pose,K,geometry,w,h);if(!pa||!pb||!pc)continue;g.beginPath();g.moveTo(pa.x,pa.y);g.lineTo(pb.x,pb.y);g.lineTo(pc.x,pc.y);g.closePath();g.stroke();}g.restore();}
}
