import {GRID} from './config_v20_2_0.js';
import {clamp,dist3,dot3,norm3,cross3,add3,scale3,projectWorldPoint} from './math_v20_2_0.js';

/** Pure quality function used both by the worker and regression tests. */
export function scoreObservationCell(cell,now=Date.now()){
  const n=Math.max(1,cell.count||0);const normalSum=cell.normalSum||[0,0,0];const normalResultant=Math.hypot(...normalSum)/n;
  const independentViews=cell.viewCount??cell.viewKeys?.length??0;const baseline=cell.maxBaselineM||0;const photoViews=cell.photoViewCount??cell.frameRefs?.length??0;
  const posStdM=Number.isFinite(cell.positionStdM)?cell.positionStdM:.25;const depthSupport=(cell.xrDepthCount||0)+.55*(cell.deepDepthCount||0)+.30*(cell.hitTestCount||0);
  const supportScore=1-Math.exp(-depthSupport/5.2);const viewScore=clamp((independentViews-1)/2.4,0,1);const baselineScore=clamp((baseline-GRID.minIndependentBaselineM)/(GRID.strongIndependentBaselineM-GRID.minIndependentBaselineM),0,1);
  const normalScore=clamp((normalResultant-.45)/(.95-.45),0,1);const varianceScore=clamp(1-posStdM/.095,0,1);
  const geometry=clamp(.30*supportScore+.19*viewScore+.16*baselineScore+.20*normalScore+.15*varianceScore,0,1);
  const sharpness=clamp(cell.meanSharpness??0,0,1);const exposure=clamp(cell.meanExposureScore??0,0,1);const photoScore=clamp((1-Math.exp(-photoViews/1.3))*(.58+.24*sharpness+.18*exposure),0,1);
  const parallaxDeg=cell.maxParallaxDeg||0;const parallaxScore=clamp((parallaxDeg-GRID.minParallaxDeg)/(GRID.strongParallaxDeg-GRID.minParallaxDeg),0,1);
  const ageMs=Math.max(0,now-(cell.lastSeen||now));const stalePenalty=clamp((ageMs-GRID.staleAfterMs)/(GRID.staleAfterMs*3),0,.24);
  const objectLike=(cell.surfaceType==='object'||cell.surfaceType==='edge');
  const requiredPhoto=objectLike ? .50 : .30;const requiredParallax=objectLike ? .30 : .10;
  let status='red';
  if(geometry>=GRID.greenGeometryThreshold&&photoScore>=requiredPhoto&&parallaxScore>=requiredParallax)status='green';
  else if(geometry>=GRID.redGeometryThreshold||photoScore>.20)status='yellow';
  const observedSupport=depthSupport;const needDeep=status!=='green'&&observedSupport>=2&&((photoViews===0&&geometry>.22)||(photoViews>0&&geometry<.52&&photoScore<requiredPhoto&&ageMs>GRID.deepRequestAfterMs));
  const overall=clamp(.58*geometry+.27*photoScore+.15*parallaxScore-stalePenalty,0,1);
  return {geometry,photoScore,parallaxScore,normalResultant,positionStdM:posStdM,status,needDeep,overall,independentViews,photoViews,maxBaselineM:baseline,maxParallaxDeg:parallaxDeg};
}

export function chooseAdaptiveTileSize(cell,quality=scoreObservationCell(cell)){
  if(cell.markpointId||cell.surfaceType==='edge')return GRID.edgeTileM;
  if(cell.surfaceType==='object'||(cell.curvature??0)>GRID.objectCurvatureThreshold)return GRID.objectTileM;
  if(['wall','floor','ceiling'].includes(cell.surfaceType)&&quality.normalResultant>GRID.normalStableResultant&&quality.geometry>.62)return GRID.flatTileM;
  return GRID.unknownTileM;
}

export function summarizeCoverage(tiles){const out={red:0,yellow:0,green:0,deep:0,total:tiles.length,score:0};for(const t of tiles){out[t.status]=(out[t.status]||0)+1;if(t.needDeep)out.deep++;out.score+=t.overall||0;}out.score=tiles.length?out.score/tiles.length:0;return out;}

/**
 * V20.4.2 capture overlay.
 *
 * The old overlay filled a square for every adaptive cell. That made a good
 * diagnostic structure look like many floating billboards. The map itself is
 * unchanged; only its on-screen representation changes:
 *   - cell centres are rendered as small splats/points;
 *   - neighbouring, similarly oriented cells are linked by a sparse wire mesh;
 *   - only the current target gets a halo and optional FOTO label.
 *
 * This keeps the user informed about coverage without pretending that the
 * adaptive cells are physical rectangular surfaces.
 */
export class AdaptiveGridOverlay {
  constructor(canvas,{maxVisibleTiles=115}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});this.maxVisibleTiles=maxVisibleTiles;this.tiles=[];this.lastGuidance=null;this.meshNeighborLimit=3;}
  resize(){const dpr=Math.min(2,globalThis.devicePixelRatio||1),w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);this.canvas.style.width=`${w}px`;this.canvas.style.height=`${h}px`;this.ctx.setTransform(dpr,0,0,dpr,0,0);}return {w,h};}
  setTiles(tiles){this.tiles=Array.isArray(tiles)?tiles:[];}
  clear(){const {w,h}=this.resize();this.ctx.clearRect(0,0,w,h);}
  render({viewMatrix,projectionMatrix,cameraPosition}){
    const {w,h}=this.resize(),ctx=this.ctx;ctx.clearRect(0,0,w,h);if(!viewMatrix||!projectionMatrix)return null;
    const candidates=[];
    for(const tile of this.tiles){
      const d=dist3(tile.center,cameraPosition);if(d<.16||d>9.0)continue;
      const p=projectWorldPoint(tile.center,viewMatrix,projectionMatrix,w,h);if(!p)continue;
      candidates.push({tile,p,d,priority:tilePriority(tile,d),normal:norm3(tile.normal||[0,1,0])});
    }
    candidates.sort((a,b)=>b.priority-a.priority||a.d-b.d);
    const visible=candidates.filter(c=>c.p.inside).slice(0,this.maxVisibleTiles);
    this._drawSparseMesh(visible);
    const target=candidates.find(c=>c.tile.status!=='green')||null;
    for(const c of visible)this._drawPoint(c,c===target);
    if(target&&target.p.inside)this._drawTarget(target,w,h);
    this.lastGuidance=target?guidanceForTarget(target,w,h):null;
    return this.lastGuidance;
  }
  _drawSparseMesh(visible){
    if(visible.length<2)return;
    const ctx=this.ctx,used=new Set();ctx.save();ctx.lineWidth=.75;
    for(let i=0;i<visible.length;i++){
      const a=visible[i],neighbors=[];
      for(let j=i+1;j<visible.length;j++){
        const b=visible[j],dot=Math.abs(dot3(a.normal,b.normal));if(dot<.88)continue;
        const s=Math.max(a.tile.size||GRID.unknownTileM,b.tile.size||GRID.unknownTileM),d3=dist3(a.tile.center,b.tile.center);if(d3>s*1.95||d3<.015)continue;
        const ds=Math.hypot(a.p.x-b.p.x,a.p.y-b.p.y);if(ds>Math.min(innerWidth,innerHeight)*.22)continue;
        neighbors.push({j,d3});
      }
      neighbors.sort((x,y)=>x.d3-y.d3);
      for(const n of neighbors.slice(0,this.meshNeighborLimit)){
        const key=`${i}:${n.j}`;if(used.has(key))continue;used.add(key);const b=visible[n.j];
        const status=worstStatus(a.tile.status,b.tile.status);ctx.strokeStyle=meshColor(status,Math.min(a.tile.overall??.5,b.tile.overall??.5));
        ctx.beginPath();ctx.moveTo(a.p.x,a.p.y);ctx.lineTo(b.p.x,b.p.y);ctx.stroke();
      }
    }
    ctx.restore();
  }
  _drawPoint(c,primary){
    const ctx=this.ctx,status=c.tile.status||'red',objectLike=c.tile.surfaceType==='object'||c.tile.surfaceType==='edge';
    const base=objectLike?3.3:2.5,depthScale=clamp(1.8/(.55+c.d),.55,1.45),r=base*depthScale*(primary?1.45:1);
    const color=pointColor(status);ctx.save();ctx.globalAlpha=status==='green'?.78:.94;ctx.fillStyle=color.fill;ctx.strokeStyle=color.stroke;
    ctx.lineWidth=primary?2.1:1;
    ctx.beginPath();ctx.arc(c.p.x,c.p.y,r,0,Math.PI*2);
    if(status==='green')ctx.fill();else{ctx.fillStyle='rgba(4,12,15,.34)';ctx.fill();ctx.stroke();}
    if(objectLike){ctx.beginPath();ctx.arc(c.p.x,c.p.y,r+2.2,0,Math.PI*2);ctx.globalAlpha=.45;ctx.stroke();}
    if(c.tile.markpointId){ctx.globalAlpha=.96;ctx.strokeStyle='#ff4dff';ctx.lineWidth=2.1;ctx.beginPath();ctx.arc(c.p.x,c.p.y,r+5.5,0,Math.PI*2);ctx.moveTo(c.p.x-r-8,c.p.y);ctx.lineTo(c.p.x+r+8,c.p.y);ctx.moveTo(c.p.x,c.p.y-r-8);ctx.lineTo(c.p.x,c.p.y+r+8);ctx.stroke();}
    ctx.restore();
  }
  _drawTarget(target,w,h){
    const ctx=this.ctx,p=target.p,t=target.tile,status=t.status||'red',col=pointColor(status);ctx.save();
    const pulse=1+.12*Math.sin(performance.now()*.006),r=(t.surfaceType==='object'?13:11)*pulse;
    ctx.strokeStyle=col.stroke;ctx.lineWidth=2.2;ctx.globalAlpha=.92;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
    // Short tangential strokes communicate local surface orientation without
    // drawing a fake rectangular patch.
    // Draw a short screen-space tangent rather than a rectangular patch.
    ctx.beginPath();ctx.moveTo(p.x-r*1.55,p.y);ctx.lineTo(p.x-r*.85,p.y);ctx.moveTo(p.x+r*.85,p.y);ctx.lineTo(p.x+r*1.55,p.y);ctx.stroke();
    if(t.needDeep){const text='FOTO';ctx.font='800 10px system-ui';ctx.textAlign='center';const tw=ctx.measureText(text).width+12;ctx.fillStyle='rgba(4,12,15,.80)';roundRect(ctx,p.x-tw/2,p.y+r+6,tw,19,7);ctx.fill();ctx.fillStyle='#9dcfff';ctx.fillText(text,p.x,p.y+r+19);}
    ctx.restore();
  }
}
function tilePriority(tile,d){const state=tile.status==='red'?2.6:tile.status==='yellow'?1.7:.60;const deep=tile.needDeep?1.35:0;const object=(tile.surfaceType==='object'||tile.surfaceType==='edge') ? .85 : 0;return state+deep+object+(1/(.5+d));}
function guidanceForTarget(target,w,h){const dx=target.p.x-w/2,dy=target.p.y-h/2;const angle=Math.atan2(dx,-dy);const inside=target.p.inside;const direction=inside&&Math.hypot(dx,dy)<Math.min(w,h)*.17?'hold':Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down');const title=direction==='hold'?(target.tile.needDeep?'Scatta qui per Deep':'Mantieni e spostati lateralmente'):`Porta il telefono ${direction==='left'?'a sinistra':direction==='right'?'a destra':direction==='up'?'verso l’alto':'verso il basso'}`;const detail=target.tile.surfaceType==='object'?'Oggetto visibile: completa forma e viste laterali.':target.tile.needDeep?'La geometria è ambigua: acquisisci una fotografia metrica.':'Aggiungi una vista distinta per stabilizzare questi punti.';return {angleRad:angle,direction,title,detail,tileId:target.tile.id};}
function pointColor(status){if(status==='green')return{fill:'rgba(82,224,182,.88)',stroke:'rgba(125,255,218,.98)'};if(status==='yellow')return{fill:'rgba(255,209,102,.5)',stroke:'rgba(255,221,126,.98)'};return{fill:'rgba(255,93,115,.5)',stroke:'rgba(255,113,133,.98)'};}
function meshColor(status,q){const a=.12+.28*clamp(q||0,0,1);if(status==='green')return`rgba(82,224,182,${a})`;if(status==='yellow')return`rgba(255,209,102,${a})`;return`rgba(255,93,115,${a})`;}
function worstStatus(a,b){if(a==='red'||b==='red')return'red';if(a==='yellow'||b==='yellow')return'yellow';return'green';}
function roundRect(ctx,x,y,w,h,r){if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x,y,w,h,r);return;}ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
