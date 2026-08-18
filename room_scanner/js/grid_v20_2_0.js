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
  const requiredPhoto=objectLike ? .72 : .48;const requiredParallax=objectLike ? .55 : .25;
  let status='red';
  if(geometry>=GRID.greenGeometryThreshold&&photoScore>=requiredPhoto&&parallaxScore>=requiredParallax)status='green';
  else if(geometry>=GRID.redGeometryThreshold||photoScore>.20)status='yellow';
  const needDeep=(status!=='green'&&photoScore<requiredPhoto)||(geometry<.56&&photoViews>0&&ageMs>GRID.deepRequestAfterMs);
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
 * 2D compositor for 3D metric grid tiles. It intentionally uses a separate
 * transparent canvas: a rendering failure cannot interfere with WebXR's GL
 * layer, and the overlay can be dropped under load without losing capture.
 */
export class AdaptiveGridOverlay {
  constructor(canvas,{maxVisibleTiles=105}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});this.maxVisibleTiles=maxVisibleTiles;this.tiles=[];this.lastGuidance=null;}
  resize(){const dpr=Math.min(2,globalThis.devicePixelRatio||1),w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);this.canvas.style.width=`${w}px`;this.canvas.style.height=`${h}px`;this.ctx.setTransform(dpr,0,0,dpr,0,0);}return {w,h};}
  setTiles(tiles){this.tiles=Array.isArray(tiles)?tiles:[];}
  clear(){const {w,h}=this.resize();this.ctx.clearRect(0,0,w,h);}
  render({viewMatrix,projectionMatrix,cameraPosition}){
    const {w,h}=this.resize(),ctx=this.ctx;ctx.clearRect(0,0,w,h);if(!viewMatrix||!projectionMatrix)return null;
    const candidates=[];
    for(const tile of this.tiles){const d=dist3(tile.center,cameraPosition);if(d<.18||d>8.5)continue;const p=projectWorldPoint(tile.center,viewMatrix,projectionMatrix,w,h);const priority=tilePriority(tile,d);if(!p)continue;candidates.push({tile,p,d,priority});}
    candidates.sort((a,b)=>b.priority-a.priority||a.d-b.d);const visible=candidates.filter(c=>c.p.inside).slice(0,this.maxVisibleTiles);
    for(const c of visible)this._drawTile(c.tile,viewMatrix,projectionMatrix,w,h,c.tile===candidates[0]?.tile);
    const target=candidates.find(c=>c.tile.status!=='green')||null;this.lastGuidance=target?guidanceForTarget(target,w,h):null;return this.lastGuidance;
  }
  _drawTile(tile,viewMatrix,projectionMatrix,w,h,primary){
    const n=norm3(tile.normal||[0,1,0]);let u=Math.abs(n[1])>.88?[1,0,0]:norm3(cross3([0,1,0],n));let v=norm3(cross3(n,u));const hs=(tile.size||GRID.unknownTileM)*.46;
    const corners=[add3(add3(tile.center,scale3(u,-hs)),scale3(v,-hs)),add3(add3(tile.center,scale3(u,hs)),scale3(v,-hs)),add3(add3(tile.center,scale3(u,hs)),scale3(v,hs)),add3(add3(tile.center,scale3(u,-hs)),scale3(v,hs))].map(p=>projectWorldPoint(p,viewMatrix,projectionMatrix,w,h));
    if(corners.some(p=>!p))return;const colors={red:['rgba(255,55,80,.22)','rgba(255,93,115,.92)'],yellow:['rgba(255,193,40,.18)','rgba(255,209,102,.92)'],green:['rgba(44,210,160,.13)','rgba(82,224,182,.72)']};const [fill,stroke]=colors[tile.status]||colors.red;
    const ctx=this.ctx;ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);for(let i=1;i<4;i++)ctx.lineTo(corners[i].x,corners[i].y);ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=primary?3:1.2;ctx.stroke();
    if(tile.needDeep||primary){const c=projectWorldPoint(tile.center,viewMatrix,projectionMatrix,w,h);ctx.fillStyle='rgba(4,12,15,.78)';ctx.fillRect(c.x-20,c.y-9,40,18);ctx.fillStyle=tile.needDeep?'#64b5f6':'#edf7f5';ctx.font='700 9px system-ui';ctx.textAlign='center';ctx.fillText(tile.needDeep?'FOTO':'OK',c.x,c.y+3);}
  }
}
function tilePriority(tile,d){const state=tile.status==='red'?3:tile.status==='yellow'?1.7:.15;const deep=tile.needDeep?1.35:0;const object=(tile.surfaceType==='object'||tile.surfaceType==='edge') ? .85 : 0;return state+deep+object+(1/(.5+d));}
function guidanceForTarget(target,w,h){const dx=target.p.x-w/2,dy=target.p.y-h/2;const angle=Math.atan2(dx,-dy);const inside=target.p.inside;const direction=inside&&Math.hypot(dx,dy)<Math.min(w,h)*.17?'hold':Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down');const title=direction==='hold'?(target.tile.needDeep?'Scatta qui per Deep':'Mantieni e spostati lateralmente'):`Porta il telefono ${direction==='left'?'a sinistra':direction==='right'?'a destra':direction==='up'?'verso l’alto':'verso il basso'}`;const detail=target.tile.surfaceType==='object'?'Superficie di oggetto: servono forma e viste laterali.':target.tile.needDeep?'La geometria è ambigua: acquisisci una fotografia metrica.':'Aggiungi una vista distinta per stabilizzare la cella.';return {angleRad:angle,direction,title,detail,tileId:target.tile.id};}
