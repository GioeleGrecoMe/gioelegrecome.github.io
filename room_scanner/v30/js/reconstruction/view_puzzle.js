import {matchProbabilisticFeatures} from '../probabilistic/feature_tracker.js';
import {pixelRay,qRotate,qNormalize} from '../slam/math.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Photo puzzle / view graph.
 *
 * A casual walking scan is not a classical single-centre panorama: one global
 * homography would be wrong as soon as translation creates parallax.  We use
 * the word "collage" for a graph of locally overlapping photographs.  Edges
 * are supported by real 2D correspondences; the equirectangular atlas is only a
 * diagnostic projection of viewing directions and never becomes 3D evidence.
 */
export class ViewPuzzleGraph{
  constructor(graph,{temporalRadius=4,maxLoopCandidates=3,minEdgeMatches=7,minEdgeProbability=.14,atlasWidth=480,atlasHeight=240}={}){
    this.graph=graph?.format==='ROOMSCAN-PROB-GRAPH-1'?graph:(graph?.exportState?.()||graph||{});Object.assign(this,{temporalRadius,maxLoopCandidates,minEdgeMatches,minEdgeProbability,atlasWidth,atlasHeight});this.frames=(this.graph.frames||[]).map(normalizeFrame).filter(Boolean);this.frameMap=new Map(this.frames.map((f,i)=>[String(f.frameId),i]));this.edges=[];this.adj=new Map();this.components=[];this.loopEdges=[];this.stats={};
  }
  build(){
    this.edges=[];this.adj=new Map();for(let i=0;i<this.frames.length;i++)this.adj.set(i,[]);
    const candidates=new Set();
    for(let i=0;i<this.frames.length;i++)for(let j=Math.max(0,i-this.temporalRadius);j<i;j++)candidates.add(`${j}:${i}`);
    // Loop candidates are prefiltered by orientation and a tiny visual hash;
    // the actual edge still needs BRIEF/ZNCC/epipolar evidence.
    const hashes=this.frames.map(imageHash);
    for(let i=0;i<this.frames.length;i++){
      const c=[];for(let j=0;j<i-this.temporalRadius-2;j++){const ang=quatAngle(this.frames[i].pose.q,this.frames[j].pose.q);if(ang>1.15)continue;const hd=hashDistance(hashes[i],hashes[j]);c.push({j,score:hd+ang*11});}c.sort((a,b)=>a.score-b.score);for(const x of c.slice(0,this.maxLoopCandidates))candidates.add(`${x.j}:${i}`);
    }
    for(const key of candidates){const [i,j]=key.split(':').map(Number),edge=this.matchPair(i,j);if(!edge)continue;this.edges.push(edge);this.adj.get(i).push(edge);this.adj.get(j).push(edge);if(Math.abs(i-j)>this.temporalRadius+1)this.loopEdges.push(edge);}
    this.components=this.connectedComponents();const largest=this.components[0]||[];const meanProb=this.edges.length?this.edges.reduce((s,e)=>s+e.meanProbability,0)/this.edges.length:0;
    this.stats={frames:this.frames.length,edges:this.edges.length,loops:this.loopEdges.length,components:this.components.length,largestComponent:largest.length,connectedFraction:this.frames.length?largest.length/this.frames.length:0,meanEdgeProbability:meanProb,meanMatches:this.edges.length?this.edges.reduce((s,e)=>s+e.matches.length,0)/this.edges.length:0};return this;
  }
  matchPair(i,j){
    const a=this.frames[i],b=this.frames[j];if(!a||!b||!a.gray?.length||!b.gray?.length)return null;
    const matches=matchProbabilisticFeatures(a,b,{maxFeatures:360,maxMatches:180,maxEpipolarPx:Math.abs(i-j)>this.temporalRadius?10:5,maxHamming:64,minProbability:.025,patchRadius:2});
    const kept=matches.filter(m=>m.probability>=this.minEdgeProbability);if(kept.length<this.minEdgeMatches)return null;const mean=kept.reduce((s,m)=>s+m.probability,0)/kept.length,photo=kept.reduce((s,m)=>s+(m.photometricProbability??.5),0)/kept.length,uniq=kept.reduce((s,m)=>s+(m.uniquenessProbability??.5),0)/kept.length,weight=clamp((kept.length/30)*mean*Math.sqrt(photo*uniq),.01,1);
    return {a:i,b:j,aId:String(a.frameId),bId:String(b.frameId),matches:kept.map(m=>{const fa=a.features[m.i],fb=b.features[m.j];return {...m,aU:fa?.originalU??fa?.x,aV:fa?.originalV??fa?.y,bU:fb?.originalU??fb?.x,bV:fb?.originalV??fb?.y};}),meanProbability:mean,photometricProbability:photo,uniquenessProbability:uniq,weight,loop:Math.abs(i-j)>this.temporalRadius+1};
  }
  connectedComponents(){
    const seen=new Set(),out=[];for(let s=0;s<this.frames.length;s++){if(seen.has(s))continue;const q=[s],comp=[];seen.add(s);while(q.length){const i=q.pop();comp.push(i);for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(!seen.has(j)){seen.add(j);q.push(j);}}}out.push(comp);}return out.sort((a,b)=>b.length-a.length);
  }
  /** Diagnostic spherical collage. Translation is intentionally not hidden. */
  renderAtlas({width=this.atlasWidth,height=this.atlasHeight,component='largest'}={}){
    const comp=component==='largest'?new Set(this.components[0]||this.frames.map((_,i)=>i)):null,acc=new Float32Array(width*height*4),weight=new Float32Array(width*height);
    for(let fi=0;fi<this.frames.length;fi++){if(comp&&!comp.has(fi))continue;const f=this.frames[fi];if(!f.rgb?.length)continue;const stride=Math.max(1,Math.floor(Math.max(f.width,f.height)/120));for(let y=0;y<f.height;y+=stride)for(let x=0;x<f.width;x+=stride){const d=qRotate(f.pose.q,pixelRay(f.K,x+.5,y+.5)),yaw=Math.atan2(d[0],d[2]),pitch=Math.asin(clamp(d[1],-1,1)),ax=wrap(Math.floor((yaw/(2*Math.PI)+.5)*width),width),ay=clamp(Math.floor((pitch/Math.PI+.5)*height),0,height-1),si=(y*f.width+x)*3,di=ay*width+ax,centre=1-Math.min(.92,Math.hypot((x-f.K.cx)/Math.max(1,f.width),(y-f.K.cy)/Math.max(1,f.height))),w=Math.max(.05,centre*centre);acc[di*4]+=f.rgb[si]*w;acc[di*4+1]+=f.rgb[si+1]*w;acc[di*4+2]+=f.rgb[si+2]*w;acc[di*4+3]+=w;weight[di]+=w;}}
    // Fill only tiny angular holes. Large holes remain black and are therefore
    // useful scan guidance rather than hallucinated panorama content.
    const rgba=new Uint8ClampedArray(width*height*4);for(let i=0;i<width*height;i++){const w=weight[i];rgba[i*4]=w?acc[i*4]/w:0;rgba[i*4+1]=w?acc[i*4+1]/w:0;rgba[i*4+2]=w?acc[i*4+2]/w:0;rgba[i*4+3]=w?255:0;}
    const tmp=new Uint8ClampedArray(rgba);for(let y=1;y<height-1;y++)for(let x=0;x<width;x++){const i=y*width+x;if(rgba[i*4+3])continue;let r=0,g=0,b=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=wrap(x+dx,width),j=(y+dy)*width+xx;if(rgba[j*4+3]){r+=rgba[j*4];g+=rgba[j*4+1];b+=rgba[j*4+2];n++;}}if(n>=5){tmp[i*4]=r/n;tmp[i*4+1]=g/n;tmp[i*4+2]=b/n;tmp[i*4+3]=180;}}return {width,height,rgba:tmp,coverage:weight.reduce((n,w)=>n+(w>0),0)/weight.length};
  }
  exportState(){return {format:'ROOMSCAN-VIEW-PUZZLE-1',stats:this.stats,edges:this.edges.map(e=>({...e,matches:e.matches.slice(0,160)})),components:this.components,loopEdges:this.loopEdges.map(e=>[e.a,e.b,e.weight])};}
}

export function normalizeFrame(f){
  if(!f?.posePrior&&!f?.poseEstimate)return null;const pose=clonePose(f.poseEstimate||f.posePrior),sourceW=+f.width||+f.K?.width||1,sourceH=+f.height||+f.K?.height||1;
  if(f.photo?.gray?.length){return {frameId:String(f.frameId),pose,K:{...f.photo.K},width:f.photo.width,height:f.photo.height,gray:f.photo.gray,rgb:f.photo.rgb||grayToRgb(f.photo.gray),features:(f.photo.features||[]).map((x,i)=>({...x,index:i}))};}
  const w=+f.grayWidth||sourceW,h=+f.grayHeight||sourceH,gray=f.gray||new Uint8Array(0),sx=w/sourceW,sy=h/sourceH,K={fx:f.K.fx*sx,fy:f.K.fy*sy,cx:f.K.cx*sx,cy:f.K.cy*sy,width:w,height:h},features=(f.features||[]).map((x,i)=>({...x,index:i,originalU:x.x,originalV:x.y,x:x.x*sx,y:x.y*sy}));return {frameId:String(f.frameId),pose,K,width:w,height:h,gray,rgb:grayToRgb(gray),features};
}
function grayToRgb(g){const out=new Uint8Array(g.length*3);for(let i=0;i<g.length;i++)out.set([g[i],g[i],g[i]],i*3);return out;}
function imageHash(f){if(!f?.gray?.length)return 0n;let bits=0n,k=0n;for(let y=0;y<8;y++){const yy=Math.min(f.height-1,Math.floor((y+.5)*f.height/8));for(let x=0;x<8;x++){const a=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+.35)*f.width/9))],b=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+1.35)*f.width/9))];if(a>b)bits|=1n<<k;k++;}}return bits;}
function hashDistance(a,b){let x=a^b,n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;}
function quatAngle(a,b){a=qNormalize(a);b=qNormalize(b);return 2*Math.acos(Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3])));}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)};}function wrap(x,n){x%=n;return x<0?x+n:x;}
