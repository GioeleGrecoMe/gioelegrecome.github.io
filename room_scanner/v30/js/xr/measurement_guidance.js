/* Room Scanner V30.11.3 metric-lock guidance.
 *
 * IMPORTANT: this module intentionally does NOT use MutationObserver.
 * V30.11.3 observed the entire bridge subtree and then changed textContent
 * inside its own observer callback. That created a self-triggering microtask
 * loop which could starve video painting and all button/touch events.
 *
 * Guidance is now event-driven: app.js emits roomscan:metric-bridge-update
 * after each matcher update. DOM writes are idempotent and never drive the
 * matcher itself.
 */
import {CONFIG,BUILD} from '../config.js';

const $=id=>document.getElementById(id);
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
let installed=false;
let canvas=null;
let areas=[];
let lastInstruction='';

function loadCalibration(){
  try{
    const raw=localStorage.getItem(CONFIG.calibrationStorageKey);
    if(!raw)return null;
    const x=JSON.parse(raw);
    return x?.calibration||x?.value||x;
  }catch{return null;}
}

function targetAreas(cal){
  const groups=new Map();
  for(const a of cal?.anchors||[]){
    if(!a?.objectId||!Array.isArray(a?.uv))continue;
    if(!groups.has(a.objectId))groups.set(a.objectId,[]);
    groups.get(a.objectId).push(a);
  }
  const objects=new Map((cal?.objects||[]).map(o=>[o.id,o]));
  const out=[];
  for(const [id,as] of groups){
    const o=objects.get(id),roi=o?.roiViews||[],last=roi[roi.length-1];
    const uv=[mean(as.map(a=>a.uv[0])),mean(as.map(a=>a.uv[1]))];
    const maxScale=Math.max(.07,...(last?.scales||[]).map(s=>Number(s.fraction)||0));
    out.push({
      id,uv,
      depthM:last?.depthM??mean(as.map(a=>Math.hypot(...a.p))),
      radiusN:maxScale*.55,
      roiViews:roi.length,
      sectors:o?.roiSectors?.length||0
    });
  }
  return out;
}

function refreshContext(){
  const cal=loadCalibration();
  areas=targetAreas(cal);
  window.RoomScanMetricContext={
    build:BUILD.id,
    unit:'m',
    calibration:cal,
    areas,
    intrinsicsNorm:cal?.intrinsicsNorm||cal?.commonView?.intrinsicsNorm||null,
    commonPose:cal?.commonView?.pose||cal?.pose||null,
    cameraSize:cal?.cameraSize||cal?.commonView?.cameraSize||null
  };
  window.dispatchEvent(new CustomEvent('roomscan:metric-context',{detail:window.RoomScanMetricContext}));
}

function setInstruction(text){
  if(text===lastInstruction)return;
  lastInstruction=text;
  const el=$('bridgePinInstructions');
  if(el)el.textContent=text;
}

function statusText(r={}){
  const found=Number(r.found||0),inliers=Number(r.inliers||0);
  const rmse=Number.isFinite(r.rmse)?r.rmse.toFixed(4):'—';
  if(!areas.length)return 'Calibrazione ROI non trovata: salva prima almeno 3 pin WebXR.';
  if(r.locked||inliers>=3)return `Aggancio metrico valido: ${inliers} inlier, RMSE ${rmse}. Mantieni la camera stabile per l’avvio della scansione.`;
  return `Allinea almeno 3 aree P1…P${areas.length} con i cerchi. Parti dalla vista finale della calibrazione e fai piccoli spostamenti laterali. Template ${found}, inlier ${inliers}.`;
}

export function updateMeasurementGuidance(result={}){
  if(!installed)installMeasurementGuidance();
  draw(canvas,areas);
  setInstruction(statusText(result));
}

export function installMeasurementGuidance(){
  if(installed)return;
  const bridge=$('bridge');
  if(!bridge)return;
  installed=true;
  bridge.style.position=bridge.style.position||'relative';
  canvas=$('bridgePinGuidance');
  if(!canvas){
    canvas=document.createElement('canvas');
    canvas.id='bridgePinGuidance';
    Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'3'});
    bridge.insertBefore(canvas,bridge.querySelector('.bridgeCard'));
  }
  const card=bridge.querySelector('.bridgeCard');
  if(card){
    card.style.zIndex='5';
    card.style.position='absolute';
    let d=$('bridgePinInstructions');
    if(!d){
      d=document.createElement('div');
      d.id='bridgePinInstructions';
      d.className='hint';
      d.style.marginTop='.5rem';
      card.appendChild(d);
    }
  }
  refreshContext();
  draw(canvas,areas);
  setInstruction(statusText({}));
  window.addEventListener('roomscan:metric-bridge-update',e=>updateMeasurementGuidance(e.detail||{}));
  window.addEventListener('resize',()=>draw(canvas,areas),{passive:true});
}

function draw(c,items){
  if(!c)return;
  const r=c.getBoundingClientRect();
  if(r.width<1||r.height<1)return;
  const dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
  if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
  const g=c.getContext('2d');
  g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,r.width,r.height);
  for(let i=0;i<items.length;i++){
    const a=items[i],x=a.uv[0]*r.width,y=a.uv[1]*r.height,rad=Math.max(28,Math.min(r.width,r.height)*a.radiusN);
    g.strokeStyle='#61d6ff';g.fillStyle='rgba(20,160,255,.08)';g.lineWidth=3;
    g.beginPath();g.arc(x,y,rad,0,Math.PI*2);g.fill();g.stroke();
    g.fillStyle='#fff';g.font='700 14px system-ui';g.fillText(`P${i+1}`,x+rad+6,y);
    g.font='12px system-ui';g.fillText(`${Number(a.depthM||0).toFixed(2)} m · ${a.roiViews} viste`,x+rad+6,y+17);
  }
}
