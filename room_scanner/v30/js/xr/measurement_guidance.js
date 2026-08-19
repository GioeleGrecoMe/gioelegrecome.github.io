/* Room Scanner V30.12.0 metric-lock guidance.
 *
 * The measurement preview deliberately uses NO full-screen canvas above the
 * camera video. On several mobile GPU/compositor combinations, a hardware
 * decoded <video> plus transparent full-screen canvases can be composited
 * incorrectly (the camera appears only as a thin strip while the rest stays
 * black). Pin guidance is therefore rendered as lightweight DOM rings.
 *
 * Updates are event-driven from MetricBridge; there is no MutationObserver and
 * no polling loop that can starve touch or paint events.
 */
import {CONFIG,BUILD} from '../config.js';

const $=id=>document.getElementById(id);
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
let installed=false;
let layer=null;
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
  return `Allinea almeno 3 aree P1…P${areas.length} con gli anelli. Parti dalla vista finale della calibrazione e fai piccoli spostamenti laterali. Template ${found}, inlier ${inliers}.`;
}

function renderRings(){
  if(!layer)return;
  layer.replaceChildren();
  for(let i=0;i<areas.length;i++){
    const a=areas[i];
    const ring=document.createElement('div');
    ring.className='bridgePinRing';
    ring.style.left=`${Math.max(0,Math.min(1,a.uv[0]))*100}%`;
    ring.style.top=`${Math.max(0,Math.min(1,a.uv[1]))*100}%`;
    ring.style.setProperty('--pin-radius-n',String(Math.max(.045,Math.min(.18,a.radiusN||.07))));
    ring.dataset.pinId=a.id;

    const core=document.createElement('span');
    core.className='bridgePinCore';
    const label=document.createElement('span');
    label.className='bridgePinLabel';
    label.textContent=`P${i+1} · ${Number(a.depthM||0).toFixed(2)} m · ${a.roiViews} viste`;
    ring.append(core,label);
    layer.appendChild(ring);
  }
}

export function updateMeasurementGuidance(result={}){
  if(!installed)installMeasurementGuidance();
  setInstruction(statusText(result));
  if(layer)layer.dataset.locked=result.locked?'1':'0';
}

export function installMeasurementGuidance(){
  if(installed)return;
  const bridge=$('bridge');
  if(!bridge)return;
  installed=true;

  layer=$('bridgePinGuidance');
  if(!layer){
    layer=document.createElement('div');
    layer.id='bridgePinGuidance';
    layer.setAttribute('aria-hidden','true');
    bridge.insertBefore(layer,bridge.querySelector('.bridgeCard'));
  }

  const card=bridge.querySelector('.bridgeCard');
  if(card){
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
  renderRings();
  setInstruction(statusText({}));
  window.addEventListener('roomscan:metric-bridge-update',e=>updateMeasurementGuidance(e.detail||{}));
  window.addEventListener('resize',renderRings,{passive:true});
  window.visualViewport?.addEventListener('resize',renderRings,{passive:true});
}
