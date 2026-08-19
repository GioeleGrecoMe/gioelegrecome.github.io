/* Room Scanner V30.10.2 manual WebXR pin placement UI.
 * This layer never owns a pin position. It visualizes the live hit-test preview
 * and the live projections reported by XRMetricCalibrator/XRAnchor.
 */
import {CONFIG} from '../config.js';

const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let latest=null;

function activeCalibrator(){return window.__ROOMSCAN_ACTIVE_CALIBRATOR||null;}
function normFromEvent(e,el){const r=el.getBoundingClientRect();return [clamp((e.clientX-r.left)/Math.max(1,r.width),.02,.98),clamp((e.clientY-r.top)/Math.max(1,r.height),.02,.90)];}

function install(){
  const screen=$('calibration'),panel=screen?.querySelector('.calibPanel');if(!screen||!panel)return;
  screen.style.position=screen.style.position||'relative';
  let canvas=$('calibManualGuide');
  if(!canvas){canvas=document.createElement('canvas');canvas.id='calibManualGuide';canvas.setAttribute('aria-hidden','true');Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'4'});screen.insertBefore(canvas,panel);}
  panel.style.zIndex='6';panel.style.position='relative';

  let controls=$('manualPinControls');
  if(!controls){
    controls=document.createElement('div');controls.id='manualPinControls';controls.className='card compact';controls.style.marginTop='.6rem';
    controls.innerHTML='<div><b>Posizionamento manuale WebXR</b></div><div id="manualPinReadout" class="hint">Tocca una superficie: il reticolo mostrerà profondità, XYZ e stabilità prima di creare il pin.</div><div class="actions inline"><button id="calibConfirmManualPinBtn" class="primary" disabled>Conferma pin</button><button id="calibMoveAimBtn">Sposta reticolo</button></div><div id="roiCoverageReadout" class="hint">Dopo il pin, gira attorno alla zona: acquisisco automaticamente ROI multi-scala da più prospettive.</div>';
    panel.appendChild(controls);
  }

  const confirm=$('calibConfirmManualPinBtn');
  confirm?.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();const c=activeCalibrator();if(!c)return;confirm.disabled=true;await c.confirmManualPin?.();});
  $('calibMoveAimBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const c=activeCalibrator();c?.clearManualAim?.();});

  const aim=e=>{
    if(e.target?.closest?.('button,input,label,a,.calibPanel'))return;
    const c=activeCalibrator();if(!c)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();
    c.setManualAim?.(normFromEvent(e,screen));
  };
  // Capture phase prevents the legacy V30 canvas handler from directly pinning
  // a 2-D click. V30.10 requires an explicit preview + confirmation.
  screen.addEventListener('pointerdown',aim,true);
  screen.addEventListener('click',e=>{if(e.target?.closest?.('button,input,label,a,.calibPanel'))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();},true);

  const onProgress=e=>{latest=e.detail;updateText(latest);draw(canvas,latest);};
  window.addEventListener('roomscan:xr-progress',onProgress);
  window.addEventListener('resize',()=>draw(canvas,latest));
  window.addEventListener('roomscan:xr-calibrator-ready',()=>{const c=activeCalibrator();c?.addEventListener?.('pin-rejected',e=>{const r=$('manualPinReadout');if(r)r.textContent=`Non posizionato: ${e.detail?.message||'hit-test non valido'}`;});});
}

function updateText(q){
  if(!q)return;const a=q.manualAim||{},readout=$('manualPinReadout'),confirm=$('calibConfirmManualPinBtn'),roi=$('roiCoverageReadout'),coach=$('calibCoach');
  if(confirm)confirm.disabled=!(a.valid&&a.stable);
  if(readout){
    if(!a.valid)readout.textContent='Tocca la zona esatta. Muovi lentamente il telefono finché ARCore trova una superficie stabile.';
    else {const p=a.point||[0,0,0],r=Number(a.rmsM||0);readout.textContent=`profondità ${Number(a.depthM||0).toFixed(3)} m · XYZ [${p.map(v=>Number(v).toFixed(3)).join(', ')}] m · stabilità ${a.stable?'OK':'attendi'} (σ ${r.toFixed(3)} m)`;}
  }
  const ts=q.targets||[],parts=ts.map((t,i)=>`P${i+1}: ${t.roiViews||0}/${CONFIG.xrRoiMinViewsPerTarget} viste · ${t.roiSectors||0}/${CONFIG.xrRoiMinAzimuthSectors} settori`);
  if(roi)roi.textContent=parts.length?`Copertura ROI — ${parts.join(' · ')}`:'Dopo la conferma, spostati lateralmente e in altezza attorno a ciascun pin: acquisisco ROI multi-scala automaticamente.';
  if(coach){const ready=ts.filter(t=>t.ready).length;if(!ts.length)coach.textContent='1) Tocca un dettaglio fisso. 2) Verifica profondità/XYZ. 3) Conferma. Scegli almeno 3 zone lontane tra loro e non allineate.';else if(ready<ts.length)coach.textContent='Ora scansiona le aree dei pin: fai piccoli archi a sinistra/destra e cambia leggermente altezza mantenendo i pin visibili. Evita solo rotazioni sul posto.';else coach.textContent='ROI acquisite. Porta almeno 3 pin insieme nell’inquadratura e completa 3 pose diverse prima di bloccare la vista comune.';}
}

function draw(canvas,q){
  if(!canvas)return;const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,r.width,r.height);if(!q)return;
  const a=q.manualAim||{};if(a.uv){const x=a.uv[0]*r.width,y=a.uv[1]*r.height;g.lineWidth=2.5;g.strokeStyle=a.stable?'#5cff8d':a.valid?'#ffd45c':'#ff6b6b';g.beginPath();g.arc(x,y,22,0,Math.PI*2);g.stroke();g.beginPath();g.moveTo(x-31,y);g.lineTo(x-10,y);g.moveTo(x+10,y);g.lineTo(x+31,y);g.moveTo(x,y-31);g.lineTo(x,y-10);g.moveTo(x,y+10);g.lineTo(x,y+31);g.stroke();if(a.depthM){g.font='600 13px system-ui';g.fillStyle='rgba(0,0,0,.72)';g.fillRect(x+28,y-15,92,24);g.fillStyle='#fff';g.fillText(`${Number(a.depthM).toFixed(2)} m`,x+36,y+2);}}
  for(let i=0;i<(q.targets||[]).length;i++){const t=q.targets[i],uv=t.seedUv;if(!uv||uv[0]<0||uv[1]<0)continue;const x=uv[0]*r.width,y=uv[1]*r.height,coverage=Math.min(1,Math.min((t.roiViews||0)/(CONFIG.xrRoiMinViewsPerTarget||8),(t.roiSectors||0)/(CONFIG.xrRoiMinAzimuthSectors||4)));g.lineWidth=3;g.strokeStyle=t.ready?'#5cff8d':'#56b9ff';g.beginPath();g.arc(x,y,30+coverage*14,0,Math.PI*2);g.stroke();g.font='700 13px system-ui';g.fillStyle='#fff';g.fillText(`P${i+1} ${Math.round(coverage*100)}%`,x+36,y+4);}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
