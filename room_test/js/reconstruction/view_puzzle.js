import {matchPhotoFeatures,buildPhotoRegistrationEdge,solvePhotoMosaic,visualAlvaDiagnostics,computeMosaicBounds,detectPhotoFeatures,photoAppearanceSimilarity,canvasPointToPhotoPixel,frameCanvasBounds} from './photo_panorama.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Pure photographic view graph.
 *
 * Nodes are frozen photographs. Edges exist only when image evidence survives
 * BRIEF/ZNCC matching and a rigid calibrated-ray rotation fit. Global camera
 * rotations are averaged and every image is projected onto one common sphere.
 * Alva poses, when present, are metadata only and never enter the stitch.
 */
export class ViewPuzzleGraph{
  constructor(graph,{temporalRadius=8,maxLoopCandidates=6,minEdgeMatches=7,minEdgeProbability=.10,atlasWidth=480,atlasHeight=240}={}){
    this.graph=graph?.format==='ROOMSCAN-PROB-GRAPH-1'?graph:(graph?.exportState?.()||graph||{});Object.assign(this,{temporalRadius,maxLoopCandidates,minEdgeMatches,minEdgeProbability,atlasWidth,atlasHeight});this.frames=(this.graph.frames||[]).map(normalizeFrame).filter(Boolean);this.frameMap=new Map(this.frames.map((f,i)=>[String(f.frameId),i]));this.edges=[];this.adj=new Map();this.components=[];this.loopEdges=[];this.visualSolution=null;this.stats={};
  }
  build(){
    this.edges=[];this.adj=new Map();this.loopEdges=[];for(let i=0;i<this.frames.length;i++)this.adj.set(i,[]);const candidates=new Set();
    for(let i=0;i<this.frames.length;i++)for(let j=Math.max(0,i-this.temporalRadius);j<i;j++)candidates.add(`${j}:${i}`);
    // Like a panorama stitcher, also search the whole set for visually similar
    // non-temporal images so a weak intermediate frame cannot break connectivity.
    for(let i=1;i<this.frames.length;i++){const pool=[];for(let j=0;j<i-this.temporalRadius;j++){const score=photoAppearanceSimilarity(this.frames[j],this.frames[i],{maxFeatures:100,maxHamming:66});pool.push({j,score});}pool.sort((a,b)=>b.score-a.score);for(const x of pool.slice(0,this.maxLoopCandidates))if(x.score>.015)candidates.add(`${x.j}:${i}`);}
    for(const key of candidates){const [i,j]=key.split(':').map(Number),edge=this.matchPair(i,j);if(!edge)continue;this.edges.push(edge);this.adj.get(i).push(edge);this.adj.get(j).push(edge);if(Math.abs(i-j)>this.temporalRadius+1)this.loopEdges.push(edge);}
    this.components=this.connectedComponents();
    // Offline/post-scan recovery can afford a broader component-bridging pass.
    // It never invents placement: it only tests real RGB pairs and admits a
    // bridge when their calibrated rays support a rigid spherical rotation.
    for(let pass=0;pass<2&&this.components.length>1;pass++){
      const root=this.components.find(c=>c.includes(0))||this.components[0],outside=this.frames.map((_,i)=>i).filter(i=>!root.includes(i)),bridge=[];
      for(const j of outside){const ranked=root.map(i=>({i,j,score:photoAppearanceSimilarity(this.frames[i],this.frames[j],{maxFeatures:130,maxHamming:74})})).sort((a,b)=>b.score-a.score).slice(0,10);bridge.push(...ranked);}
      bridge.sort((a,b)=>b.score-a.score);let linked=false;for(const x of bridge.slice(0,36)){const edge=this.matchPair(x.i,x.j,{recovery:true});if(!edge)continue;this.edges.push(edge);this.adj.get(x.i).push(edge);this.adj.get(x.j).push(edge);this.loopEdges.push(edge);linked=true;break;}if(!linked)break;this.components=this.connectedComponents();
    }
    this.visualSolution=solvePhotoMosaic(this.frames,this.edges,{iterations:14,rootIndex:0});this.visualSolution.bounds=computeMosaicBounds(this.frames,this.visualSolution.transforms,{padding:.055});this.frames.forEach((f,i)=>{f.mosaicR=this.visualSolution.transforms[i];f.visualConfidence=this.visualSolution.confidence[i];});
    const largest=this.components[0]||[],meanProb=this.edges.length?this.edges.reduce((sum,e)=>sum+e.meanProbability,0)/this.edges.length:0,diag=visualAlvaDiagnostics(this.frames,this.edges,this.visualSolution);this.stats={frames:this.frames.length,edges:this.edges.length,loops:this.loopEdges.length,components:this.components.length,largestComponent:largest.length,connectedFraction:this.frames.length?largest.length/this.frames.length:0,meanEdgeProbability:meanProb,meanMatches:this.edges.length?this.edges.reduce((sum,e)=>sum+e.matches.length,0)/this.edges.length:0,photoOnlyMosaic:true,projection:'spherical',meanVisualConfidence:this.edges.length?this.edges.reduce((sum,e)=>sum+(e.visualConfidence||0),0)/this.edges.length:0,mosaicResidualDeg:this.visualSolution.medianResidualDeg||0,mosaicP90ResidualDeg:this.visualSolution.p90ResidualDeg||0,...diag};return this;
  }

  matchPair(i,j,{recovery=false}={}){const a=this.frames[i],b=this.frames[j];if(!a||!b||!a.gray?.length||!b.gray?.length)return null;const far=Math.abs(i-j)>this.temporalRadius+1,loose=recovery||far,raw=matchPhotoFeatures(a,b,{maxFeatures:loose?480:400,maxMatches:loose?270:220,maxHamming:recovery?86:far?80:74,minProbability:recovery?.010:far?.014:.022,patchRadius:loose?3:2}),candidate=raw.filter(m=>m.probability>=(recovery?.015:Math.min(this.minEdgeProbability,far?.065:.085)));if(candidate.length<this.minEdgeMatches)return null;const reg=buildPhotoRegistrationEdge(a,b,candidate,{minMatches:this.minEdgeMatches,angularThresholdDeg:recovery?6.2:far?5.2:3.8,recovery:loose});if(!reg||reg.rotationInliers<Math.max(8,this.minEdgeMatches)||reg.rotationMedianErrorDeg>(recovery?5.4:far?4.8:3.6))return null;const gain=estimateExposureGain(a,b,reg.matches);return {a:i,b:j,aId:String(a.frameId),bId:String(b.frameId),...reg,weight:reg.visualConfidence,loop:far,gainAB:gain,recovery:!!recovery,registration:'photo-spherical-rotation-irls'};}

  connectedComponents(){const seen=new Set(),out=[];for(let s=0;s<this.frames.length;s++){if(seen.has(s))continue;const q=[s],comp=[];seen.add(s);while(q.length){const i=q.pop();comp.push(i);for(const e of this.adj.get(i)||[]){const j=e.a===i?e.b:e.a;if(!seen.has(j)){seen.add(j);q.push(j);}}}out.push(comp);}return out.sort((a,b)=>b.length-a.length||a[0]-b[0]);}
  renderAtlas({width=this.atlasWidth,height=this.atlasHeight,component='largest'}={}){
    if(!this.visualSolution){this.visualSolution=solvePhotoMosaic(this.frames,this.edges,{iterations:12});this.visualSolution.bounds=computeMosaicBounds(this.frames,this.visualSolution.transforms,{padding:.055});}
    const comp=component==='largest'?new Set(this.visualSolution.component||this.components[0]||[]):null,rgba=new Uint8ClampedArray(width*height*4),score=new Float32Array(width*height),bounds=this.visualSolution.bounds;
    for(let fi=0;fi<this.frames.length;fi++){if(comp&&!comp.has(fi))continue;const f=this.frames[fi],R=this.visualSolution.transforms[fi];if(!f.rgb?.length||!R)continue;const regQ=this.visualSolution.confidence[fi]||0,box=frameCanvasBounds(f,R,width,height,bounds,{edgeSamples:10});if(!box)continue;for(let y=box.minY;y<=box.maxY;y++)for(let x=box.minX;x<=box.maxX;x++){const uv=canvasPointToPhotoPixel(f,R,x+.5,y+.5,width,height,bounds);if(!uv)continue;const rgb=sampleRgb(f,uv.u,uv.v);if(!rgb)continue;const un=uv.u/Math.max(1,f.width-1),vn=uv.v/Math.max(1,f.height-1),edge=Math.min(un,1-un,vn,1-vn),q=Math.max(.06,regQ)*(.2+.8*clamp(edge/.18,0,1)),i=y*width+x,j=i*4;if(!rgba[j+3]||q>score[i]*1.015){score[i]=q;rgba[j]=rgb[0];rgba[j+1]=rgb[1];rgba[j+2]=rgb[2];rgba[j+3]=255;}}}
    fillTinyHoles(rgba,width,height);let covered=0;for(let i=0;i<width*height;i++)covered+=rgba[i*4+3]>0?1:0;return {width,height,rgba,coverage:covered/(width*height),photoOnlyMosaic:true,projection:'spherical',bounds};
  }

  exportState(){const rotations=(this.visualSolution?.transforms||[]).map(R=>R?Array.from(R):null);return {format:'ROOMSCAN-VIEW-PUZZLE-3',projection:'spherical',stats:this.stats,edges:this.edges.map(e=>({...e,rotationBToA:Array.from(e.rotationBToA||[]),matches:e.matches.slice(0,180)})),components:this.components,loopEdges:this.loopEdges.map(e=>[e.a,e.b,e.weight]),rootIndex:this.visualSolution?.rootIndex??0,sphericalRotations:rotations,mosaicTransforms:rotations,visualConfidence:Array.from(this.visualSolution?.confidence||[]) };}
}

function sampleRgb(f,x,y){if(!f?.rgb?.length||x<0||y<0||x>f.width-1||y>f.height-1)return null;const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(f.width-1,x0+1),y1=Math.min(f.height-1,y0+1),tx=x-x0,ty=y-y0,out=[0,0,0];for(let c=0;c<3;c++){const a=f.rgb[(y0*f.width+x0)*3+c],b=f.rgb[(y0*f.width+x1)*3+c],d=f.rgb[(y1*f.width+x0)*3+c],e=f.rgb[(y1*f.width+x1)*3+c];out[c]=a*(1-tx)*(1-ty)+b*tx*(1-ty)+d*(1-tx)*ty+e*tx*ty;}return out;}
function estimateExposureGain(a,b,matches){const ratios=[];for(const m of matches||[]){const va=sampleGray(a,m.aU,m.aV),vb=sampleGray(b,m.bU,m.bV);if(va>18&&vb>18&&va<245&&vb<245)ratios.push(va/vb);}if(ratios.length<3)return 1;ratios.sort((x,y)=>x-y);return clamp(ratios[ratios.length>>1],.65,1.5);}
function sampleGray(f,x,y){const xx=clamp(Math.round(x),0,f.width-1),yy=clamp(Math.round(y),0,f.height-1);return f.gray[yy*f.width+xx]||0;}
function splatSharp(rgba,score,w,h,x,y,color,q){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;for(const [dx,dy,bw] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){if(bw<.02)continue;const xx=clamp(xi+dx,0,w-1),yy=clamp(yi+dy,0,h-1),i=yy*w+xx,j=i*4,s=q*bw;if(!rgba[j+3]||s>score[i]*1.02){score[i]=s;rgba[j]=color[0];rgba[j+1]=color[1];rgba[j+2]=color[2];rgba[j+3]=clamp(70+s*185,60,255);}}}
function fillTinyHoles(rgba,w,h){const src=new Uint8ClampedArray(rgba);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(src[i*4+3])continue;let r=0,g=0,b=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=clamp(x+dx,0,w-1),j=((y+dy)*w+xx)*4;if(src[j+3]>70){r+=src[j];g+=src[j+1];b+=src[j+2];n++;}}if(n>=7){rgba[i*4]=r/n;rgba[i*4+1]=g/n;rgba[i*4+2]=b/n;rgba[i*4+3]=130;}}}

export function normalizeFrame(f){
  if(!f)return null;const pose=clonePoseNullable(f.poseEstimate||f.posePrior||f.pose||f.alvaPose),sourceW=+f.width||+f.K?.width||1,sourceH=+f.height||+f.K?.height||1;
  if(f.photo?.gray?.length){const width=f.photo.width,height=f.photo.height,gray=f.photo.gray,rgb=f.photo.rgb||grayToRgb(gray),features=detectPhotoFeatures(gray,width,height,{maxFeatures:440});return {frameId:String(f.frameId),pose,K:{...(f.photo.K||f.K||{})},width,height,gray,rgb,features};}
  const w=+f.grayWidth||sourceW,h=+f.grayHeight||sourceH,gray=f.gray||new Uint8Array(0),sx=w/sourceW,sy=h/sourceH,K=f.K?{fx:f.K.fx*sx,fy:f.K.fy*sy,cx:f.K.cx*sx,cy:f.K.cy*sy,width:w,height:h}:{fx:w,fy:w,cx:w/2,cy:h/2,width:w,height:h},rgb=f.rgb||grayToRgb(gray),features=gray?.length?detectPhotoFeatures(gray,w,h,{maxFeatures:440}):[];if(!gray?.length)return null;return {frameId:String(f.frameId),pose,K,width:w,height:h,gray,rgb,features};
}
function grayToRgb(g){const out=new Uint8Array(g.length*3);for(let i=0;i<g.length;i++){out[i*3]=out[i*3+1]=out[i*3+2]=g[i];}return out;}
function imageHash(f){if(!f?.gray?.length)return 0n;let bits=0n,k=0n;for(let y=0;y<8;y++){const yy=Math.min(f.height-1,Math.floor((y+.5)*f.height/8));for(let x=0;x<8;x++){const a=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+.35)*f.width/9))],b=f.gray[yy*f.width+Math.min(f.width-1,Math.floor((x+1.35)*f.width/9))];if(a>b)bits|=1n<<k;k++;}}return bits;}
function hashDistance(a,b){let x=a^b,n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;}
function clonePoseNullable(p){return p?.p&&p?.q?{p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)}:null;}
