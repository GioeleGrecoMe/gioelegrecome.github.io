import {qNormalize} from '../slam/math.js';
import {matchPhotoFeatures,buildPhotoRegistrationEdge,solvePhotoOrientations,visualAlvaDiagnostics,buildLocalPanoramaWarp,photoPixelToAtlas} from './photo_panorama.js';

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
    this.graph=graph?.format==='ROOMSCAN-PROB-GRAPH-1'?graph:(graph?.exportState?.()||graph||{});Object.assign(this,{temporalRadius,maxLoopCandidates,minEdgeMatches,minEdgeProbability,atlasWidth,atlasHeight});this.frames=(this.graph.frames||[]).map(normalizeFrame).filter(Boolean);this.frameMap=new Map(this.frames.map((f,i)=>[String(f.frameId),i]));this.edges=[];this.adj=new Map();this.components=[];this.loopEdges=[];this.visualSolution=null;this.stats={};
  }
  build(){
    this.edges=[];this.adj=new Map();this.loopEdges=[];for(let i=0;i<this.frames.length;i++)this.adj.set(i,[]);
    const candidates=new Set();
    for(let i=0;i<this.frames.length;i++)for(let j=Math.max(0,i-this.temporalRadius);j<i;j++)candidates.add(`${j}:${i}`);
    // Loop search is image-led. Alva no longer decides whether two photos are
    // allowed to match; the actual overlap must survive visual RANSAC below.
    const hashes=this.frames.map(imageHash);
    for(let i=0;i<this.frames.length;i++){
      const c=[];for(let j=0;j<i-this.temporalRadius-2;j++)c.push({j,score:hashDistance(hashes[i],hashes[j])});
      c.sort((a,b)=>a.score-b.score);for(const x of c.slice(0,this.maxLoopCandidates))candidates.add(`${x.j}:${i}`);
    }
    for(const key of candidates){const [i,j]=key.split(':').map(Number),edge=this.matchPair(i,j);if(!edge)continue;this.edges.push(edge);this.adj.get(i).push(edge);this.adj.get(j).push(edge);if(Math.abs(i-j)>this.temporalRadius+1)this.loopEdges.push(edge);}
    this.components=this.connectedComponents();this.visualSolution=solvePhotoOrientations(this.frames,this.edges,{iterations:10});this.visualSolution.localWarp=buildLocalPanoramaWarp(this.frames,this.edges,this.visualSolution,{width:this.atlasWidth,height:this.atlasHeight});
    this.frames.forEach((f,i)=>{f.visualQ=this.visualSolution.orientations[i];f.visualConfidence=this.visualSolution.confidence[i];});
    const largest=this.components[0]||[],meanProb=this.edges.length?this.edges.reduce((s,e)=>s+e.meanProbability,0)/this.edges.length:0,diag=visualAlvaDiagnostics(this.frames,this.edges,this.visualSolution.orientations);
    this.stats={frames:this.frames.length,edges:this.edges.length,loops:this.loopEdges.length,components:this.components.length,largestComponent:largest.length,connectedFraction:this.frames.length?largest.length/this.frames.length:0,meanEdgeProbability:meanProb,meanMatches:this.edges.length?this.edges.reduce((s,e)=>s+e.matches.length,0)/this.edges.length:0,photoFirst:true,meanVisualConfidence:this.edges.length?this.edges.reduce((s,e)=>s+(e.visualConfidence||0),0)/this.edges.length:0,localWarpAnchors:this.visualSolution.localWarp?.anchorCount||0,localWarpResidualPx:this.visualSolution.localWarp?.medianBaseResidualPx??0,...diag};return this;
  }
  matchPair(i,j){
    const a=this.frames[i],b=this.frames[j];if(!a||!b||!a.gray?.length||!b.gray?.length)return null;
    const raw=matchPhotoFeatures(a,b,{maxFeatures:360,maxMatches:190,maxHamming:70,minProbability:.025,patchRadius:2});
    const candidate=raw.filter(m=>m.probability>=Math.min(this.minEdgeProbability,.12));if(candidate.length<this.minEdgeMatches)return null;
    const reg=buildPhotoRegistrationEdge(a,b,candidate,{minMatches:this.minEdgeMatches,reprojectionPx:Math.abs(i-j)>this.temporalRadius?5.2:4.0,rotationInlierDeg:3.2});if(!reg)return null;
    const gain=estimateExposureGain(a,b,reg.matches),far=Math.abs(i-j)>this.temporalRadius+1;
    return {a:i,b:j,aId:String(a.frameId),bId:String(b.frameId),...reg,weight:reg.visualConfidence,loop:far,gainAB:gain,registration:'photo-ransac'};
  }
  connectedComponents(){
    const seen=new Set(),out=[];for(let s=0;s<this.frames.length;s++){if(seen.has(s))continue;const q=[s],comp=[];seen.add(s);while(q.length){const i=q.pop();comp.push(i);for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(!seen.has(j)){seen.add(j);q.push(j);}}}out.push(comp);}return out.sort((a,b)=>b.length-a.length);
  }
  /** Sharp diagnostic spherical panorama driven by visual registration. */
  renderAtlas({width=this.atlasWidth,height=this.atlasHeight,component='largest'}={}){
    if(!this.visualSolution){this.visualSolution=solvePhotoOrientations(this.frames,this.edges,{iterations:10});this.visualSolution.localWarp=buildLocalPanoramaWarp(this.frames,this.edges,this.visualSolution,{width,height});}
    const comp=component==='largest'?new Set(this.components[0]||this.frames.map((_,i)=>i)):null,rgba=new Uint8ClampedArray(width*height*4),score=new Float32Array(width*height);
    for(let fi=0;fi<this.frames.length;fi++){
      if(comp&&!comp.has(fi))continue;const f=this.frames[fi];if(!f.rgb?.length)continue;const visualQ=this.visualSolution.orientations[fi]||f.pose.q,regQ=this.visualSolution.confidence[fi]||0,connected=fi===this.visualSolution.rootIndex||regQ>0;if(!connected&&comp)continue;
      const stride=Math.max(1,Math.floor(Math.max(f.width,f.height)/145));
      for(let y=0;y<f.height;y+=stride)for(let x=0;x<f.width;x+=stride){const a=photoPixelToAtlas(f,visualQ,x+.5,y+.5,width,height,this.visualSolution.localWarp,fi),si=(y*f.width+x)*3,centre=1-Math.min(.96,Math.hypot((x-f.K.cx)/Math.max(1,f.width),(y-f.K.cy)/Math.max(1,f.height))),w=Math.max(.025,centre*centre)*Math.max(.18,regQ);splatSharp(rgba,score,width,height,a.x,a.y,[f.rgb[si],f.rgb[si+1],f.rgb[si+2]],w);}
    }
    fillTinyHoles(rgba,width,height);let covered=0;for(let i=0;i<width*height;i++)covered+=rgba[i*4+3]>0?1:0;return {width,height,rgba,coverage:covered/(width*height),photoFirst:true};
  }
  exportState(){return {format:'ROOMSCAN-VIEW-PUZZLE-1',stats:this.stats,edges:this.edges.map(e=>({...e,matches:e.matches.slice(0,160)})),components:this.components,loopEdges:this.loopEdges.map(e=>[e.a,e.b,e.weight]),visualOrientations:(this.visualSolution?.orientations||[]).map(q=>q?Array.from(q):null),visualConfidence:Array.from(this.visualSolution?.confidence||[]),localWarp:this.visualSolution?.localWarp?{anchorCount:this.visualSolution.localWarp.anchorCount,medianBaseResidualPx:this.visualSolution.localWarp.medianBaseResidualPx,p90BaseResidualPx:this.visualSolution.localWarp.p90BaseResidualPx}:null};}
}

function estimateExposureGain(a,b,matches){const ratios=[];for(const m of matches||[]){const va=sampleGray(a,m.aU,m.aV),vb=sampleGray(b,m.bU,m.bV);if(va>18&&vb>18&&va<245&&vb<245)ratios.push(va/vb);}if(ratios.length<3)return 1;ratios.sort((x,y)=>x-y);return clamp(ratios[ratios.length>>1],.65,1.5);}
function sampleGray(f,x,y){const xx=clamp(Math.round(x),0,f.width-1),yy=clamp(Math.round(y),0,f.height-1);return f.gray[yy*f.width+xx]||0;}
function splatSharp(rgba,score,w,h,x,y,color,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<.02)continue;const xx=wrap(xi+dx,w),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,j=i*4,s=q*bw;if(!rgba[j+3]||s>score[i]*1.02){score[i]=s;rgba[j]=color[0];rgba[j+1]=color[1];rgba[j+2]=color[2];rgba[j+3]=clamp(70+s*185,60,255);}}}
function fillTinyHoles(rgba,w,h){const src=new Uint8ClampedArray(rgba);for(let y=1;y<h-1;y++)for(let x=0;x<w;x++){const i=y*w+x;if(src[i*4+3])continue;let r=0,g=0,b=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=wrap(x+dx,w),j=((y+dy)*w+xx)*4;if(src[j+3]>70){r+=src[j];g+=src[j+1];b+=src[j+2];n++;}}if(n>=7){rgba[i*4]=r/n;rgba[i*4+1]=g/n;rgba[i*4+2]=b/n;rgba[i*4+3]=130;}}}

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
