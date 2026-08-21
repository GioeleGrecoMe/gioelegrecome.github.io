import {qRotate,qConj,qMul,qNormalize} from '../slam/math.js';
import {matchProbabilisticFeatures} from '../probabilistic/feature_tracker.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Online scan coverage / revisit guide.
 *
 * This is deliberately a direction sphere, not a fake metric surface.  Every
 * accepted Alva keyframe paints the angular footprint of the camera.  Visual
 * connectivity and later geometric support only change the confidence of those
 * cells.  A visually disconnected frame is therefore not discarded; its sector
 * remains visible as weak and the user can revisit it.
 */
export class ViewSphereCoverage{
  constructor({cols=24,rows=12,maxFrames=72,loopMinAge=8,loopMinMatches=10}={}){
    Object.assign(this,{cols,rows,maxFrames,loopMinAge,loopMinMatches});
    this.cells=new Float32Array(cols*rows);this.frames=[];this.frameMap=new Map();this.loopClosures=0;this.lastLoop=null;
  }
  addFrame(frame){
    if(!frame?.pose||!frame?.K)return this.status();
    const f=compactFrame(frame),quality=clamp(.28+.32*Math.tanh((f.features?.length||0)/120),.20,.62);
    const entry={frameId:String(frame.frameId||frame.id),at:+(frame.at||0),pose:clonePose(frame.pose),K:f.K,width:f.width,height:f.height,gray:f.gray,features:f.features,quality,connected:false,geometryQuality:0,loop:false};
    const loop=this.findLoop(entry);if(loop){entry.loop=true;entry.connected=true;entry.quality=Math.max(entry.quality,.82);this.loopClosures++;this.lastLoop={a:entry.frameId,b:loop.frameId,matches:loop.matches,probability:loop.probability};}
    this.frames.push(entry);this.frameMap.set(entry.frameId,entry);while(this.frames.length>this.maxFrames){const x=this.frames.shift();this.frameMap.delete(x.frameId);}
    this.paint(entry,entry.quality);return this.status(entry);
  }
  noteGeometry(frameId,{seedCount=0,meanProbability=0,sourceFrames=[]}={}){
    const e=this.frameMap.get(String(frameId));if(!e)return this.status();
    const q=clamp((seedCount/18)*.55+meanProbability*.55,0,1);e.geometryQuality=q;e.connected=e.connected||seedCount>=4||sourceFrames.length>=2;e.quality=clamp(Math.max(e.quality,.22+.78*q),.05,1);this.paint(e,e.quality,true);return this.status(e);
  }
  status(current=this.frames.at(-1)){
    let sum=0,strong=0,seen=0,min=Infinity,minIndex=-1;for(let i=0;i<this.cells.length;i++){const v=this.cells[i];sum+=v;if(v>.08)seen++;if(v>.58)strong++;if(v<min){min=v;minIndex=i;}}
    const coverage=sum/this.cells.length,strongCoverage=strong/this.cells.length,seenCoverage=seen/this.cells.length,target=this.cellDirection(minIndex);
    const connectedFraction=this.frames.length?this.frames.reduce((n,f)=>n+(f.connected?1:0),0)/this.frames.length:0,loopEvidence=1-Math.exp(-this.loopClosures/1.4),closureConfidence=clamp((.52*strongCoverage+.20*seenCoverage+.18*connectedFraction+.10*loopEvidence)*(this.loopClosures?1:.82),0,1),readyToClose=strongCoverage>=.54&&seenCoverage>=.70&&connectedFraction>=.66&&this.loopClosures>=1;
    const guidance=this.guidance(current,target,{readyToClose,strongCoverage,seenCoverage,connectedFraction});
    return {cols:this.cols,rows:this.rows,coverage:clamp(coverage,0,1),strongCoverage,seenCoverage,connectedFraction,closureConfidence,readyToClose,loopClosures:this.loopClosures,lastLoop:this.lastLoop,currentConnected:current?!!current.connected:true,currentQuality:current?.quality??0,target,guidance,cells:new Float32Array(this.cells)};
  }
  paint(e,w,upgrade=false){
    const forward=qRotate(e.pose.q,[0,0,1]),yaw=Math.atan2(forward[0],forward[2]),pitch=Math.asin(clamp(forward[1],-1,1)),hfov=2*Math.atan((e.K.width||e.width)/(2*e.K.fx)),vfov=2*Math.atan((e.K.height||e.height)/(2*e.K.fy));
    const rx=Math.max(1,Math.ceil(this.cols*hfov/(2*Math.PI)*.65)),ry=Math.max(1,Math.ceil(this.rows*vfov/Math.PI*.65)),cx=wrap(Math.floor((yaw/(2*Math.PI)+.5)*this.cols),this.cols),cy=clamp(Math.floor((pitch/Math.PI+.5)*this.rows),0,this.rows-1);
    for(let dy=-ry;dy<=ry;dy++)for(let dx=-rx;dx<=rx;dx++){const yy=cy+dy;if(yy<0||yy>=this.rows)continue;const xx=wrap(cx+dx,this.cols),r2=(dx/(rx+.25))**2+(dy/(ry+.25))**2;if(r2>1.4)continue;const add=w*Math.exp(-1.15*r2)*(upgrade?.36:.55),i=yy*this.cols+xx;this.cells[i]=clamp(Math.max(this.cells[i],add)+add*.16,0,1);}
  }
  findLoop(entry){
    if(this.frames.length<this.loopMinAge)return null;let best=null;
    const start=Math.max(0,this.frames.length-this.maxFrames);for(let i=start;i<this.frames.length-this.loopMinAge;i++){
      const old=this.frames[i],ang=quatAngle(entry.pose.q,old.pose.q);if(ang>1.0)continue;
      const hd=hashDistance(imageHash(entry.gray,entry.width,entry.height),imageHash(old.gray,old.width,old.height));if(hd>24)continue;
      const ms=matchProbabilisticFeatures(entry,old,{maxFeatures:220,maxMatches:80,maxEpipolarPx:12,maxHamming:66,minProbability:.04,patchRadius:2});
      const good=ms.filter(m=>m.probability>.24),p=good.length?good.reduce((s,m)=>s+m.probability,0)/good.length:0,score=good.length*p;
      if(good.length>=this.loopMinMatches&&(!best||score>best.score))best={frameId:old.frameId,matches:good.length,probability:p,score};
    }return best;
  }
  cellDirection(index){if(index<0)return {yaw:0,pitch:0};const y=Math.floor(index/this.cols),x=index%this.cols;return {yaw:((x+.5)/this.cols-.5)*2*Math.PI,pitch:((y+.5)/this.rows-.5)*Math.PI};}
  guidance(current,target,status={}){if(status.readyToClose)return 'Copertura chiusa: hai overlap, loop fotografico e viste sufficientemente connesse. Puoi terminare o aggiungere dettaglio.';if(!current)return 'Esplora lentamente la stanza mantenendo sovrapposizione con la vista precedente.';if(!current.connected&&this.frames.length>3)return 'Vista poco connessa: torna leggermente indietro e ripassa questa zona più lentamente finché si riaggancia alle foto precedenti.';if(this.frames.length>10&&!this.loopClosures&&status.seenCoverage>.45)return 'Manca una chiusura fotografica: torna verso una zona vista all’inizio mantenendo la camera sulla stessa scena.';const f=qRotate(current.pose.q,[0,0,1]),yaw=Math.atan2(f[0],f[2]),pitch=Math.asin(clamp(f[1],-1,1)),dy=wrapAngle(target.yaw-yaw),dp=target.pitch-pitch;if(Math.abs(dy)<.25&&Math.abs(dp)<.20)return 'Continua in questa direzione: è una delle zone meno osservate.';const h=Math.abs(dy)>.20?(dy>0?'destra':'sinistra'):null,v=Math.abs(dp)>.18?(dp>0?'in basso':'in alto'):null;return `Copertura incompleta: orienta la camera ${[h,v].filter(Boolean).join(' e ')||'verso la zona meno osservata'}.`;}
}

export function drawCoverageSphere(canvas,status){
  if(!canvas||!status?.cells)return;const ctx=canvas.getContext('2d'),cols=status.cols||24,rows=status.rows||12,w=canvas.clientWidth||240,h=canvas.clientHeight||120,dpr=Math.min(2,devicePixelRatio||1);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);const cw=w/cols,ch=h/rows;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const v=status.cells[y*cols+x]||0;ctx.globalAlpha=.14+.78*v;ctx.fillStyle=v>.58?'#7be495':v>.18?'#f7d774':'#4a5568';ctx.fillRect(x*cw+.5,y*ch+.5,Math.max(1,cw-1),Math.max(1,ch-1));}
  ctx.globalAlpha=1;ctx.strokeStyle='rgba(255,255,255,.55)';ctx.strokeRect(.5,.5,w-1,h-1);const tx=(status.target.yaw/(2*Math.PI)+.5)*w,ty=(status.target.pitch/Math.PI+.5)*h;ctx.beginPath();ctx.arc(tx,ty,5,0,2*Math.PI);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
}

function compactFrame(frame,maxSide=120){const sw=frame.width,sh=frame.height,scale=Math.min(1,maxSide/Math.max(sw,sh)),w=Math.max(16,Math.round(sw*scale)),h=Math.max(16,Math.round(sh*scale)),gray=new Uint8Array(w*h),sx=sw/w,sy=sh/h;for(let y=0;y<h;y++){const yy=Math.min(sh-1,Math.floor((y+.5)*sy));for(let x=0;x<w;x++){const xx=Math.min(sw-1,Math.floor((x+.5)*sx));gray[y*w+x]=frame.gray[yy*sw+xx];}}
  const K={fx:frame.K.fx*w/sw,fy:frame.K.fy*h/sh,cx:frame.K.cx*w/sw,cy:frame.K.cy*h/sh,width:w,height:h},features=(frame.features||[]).map(f=>({...f,x:f.x*w/sw,y:f.y*h/sh}));return {width:w,height:h,gray,K,features};}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:p.q.slice(0,4).map(Number)};}
function quatAngle(a,b){a=qNormalize(a);b=qNormalize(b);const d=Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]));return 2*Math.acos(d);}
function imageHash(gray,w,h){let bits=0n,k=0n;for(let y=0;y<8;y++){const yy=Math.min(h-1,Math.floor((y+.5)*h/8));for(let x=0;x<8;x++){const a=gray[yy*w+Math.min(w-1,Math.floor((x+.35)*w/9))],b=gray[yy*w+Math.min(w-1,Math.floor((x+1.35)*w/9))];if(a>b)bits|=1n<<k;k++;}}return bits;}
function hashDistance(a,b){let x=a^b,n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;}
function wrap(x,n){x%=n;return x<0?x+n:x;}function wrapAngle(a){while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;}
