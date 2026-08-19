/* V30.10 camera-measurement guidance.
 * Shows where the calibrated pin ROIs are expected in the bridge view and
 * exports a metric context for the rest of the reconstruction pipeline.
 */
import {CONFIG,BUILD} from '../config.js';

const $=id=>document.getElementById(id);
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
function loadCalibration(){try{const raw=localStorage.getItem(CONFIG.calibrationStorageKey);if(!raw)return null;const x=JSON.parse(raw);return x?.calibration||x?.value||x;}catch{return null;}}
function targetAreas(cal){
  const groups=new Map();for(const a of cal?.anchors||[]){if(!a?.objectId||!a?.uv)continue;if(!groups.has(a.objectId))groups.set(a.objectId,[]);groups.get(a.objectId).push(a);}
  const objects=new Map((cal?.objects||[]).map(o=>[o.id,o]));const out=[];
  for(const [id,as] of groups){const o=objects.get(id),roi=o?.roiViews||[],last=roi[roi.length-1],uv=[mean(as.map(a=>a.uv[0])),mean(as.map(a=>a.uv[1]))],maxScale=Math.max(.07,...(last?.scales||[]).map(s=>Number(s.fraction)||0));out.push({id,uv,depthM:last?.depthM??mean(as.map(a=>Math.hypot(...a.p))),radiusN:maxScale*.55,roiViews:roi.length,sectors:o?.roiSectors?.length||0});}
  return out;
}
function install(){
  const bridge=$('bridge');if(!bridge)return;bridge.style.position=bridge.style.position||'relative';let canvas=$('bridgePinGuidance');if(!canvas){canvas=document.createElement('canvas');canvas.id='bridgePinGuidance';Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'3'});bridge.insertBefore(canvas,bridge.querySelector('.bridgeCard'));}
  const card=bridge.querySelector('.bridgeCard');if(card){card.style.zIndex='5';card.style.position='relative';let d=$('bridgePinInstructions');if(!d){d=document.createElement('div');d.id='bridgePinInstructions';d.className='hint';d.style.marginTop='.5rem';card.appendChild(d);}}
  let areas=[];
  const refreshContext=()=>{const cal=loadCalibration();areas=targetAreas(cal);window.RoomScanMetricContext={build:BUILD.id,unit:'m',calibration:cal,areas,intrinsicsNorm:cal?.intrinsicsNorm||cal?.commonView?.intrinsicsNorm||null,commonPose:cal?.commonView?.pose||cal?.pose||null,cameraSize:cal?.cameraSize||cal?.commonView?.cameraSize||null};window.dispatchEvent(new CustomEvent('roomscan:metric-context',{detail:window.RoomScanMetricContext}));};
  const update=()=>{refreshContext();draw(canvas,areas);const el=$('bridgePinInstructions'),found=parseInt($('bridgeFound')?.textContent||'0',10)||0,inliers=parseInt($('bridgeInliers')?.textContent||'0',10)||0,rmse=$('bridgeRmse')?.textContent||'—';if(el)el.textContent=!areas.length?'Calibrazione ROI non trovata: salva prima almeno 3 pin WebXR.':inliers>=3?`Aggancio metrico in corso/valido: ${inliers} inlier, RMSE ${rmse}. Mantieni almeno 3 aree visibili e inizia la scansione con traslazioni lente.`:`Allinea almeno 3 aree P1…P${areas.length} con i cerchi. Parti dalla vista comune finale, poi fai una piccola traslazione laterale; evita zoom digitale e rotazioni pure. Template trovati: ${found}, inlier: ${inliers}.`;};
  new MutationObserver(update).observe(bridge,{subtree:true,characterData:true,childList:true,attributes:true,attributeFilter:['class']});window.addEventListener('resize',update);update();
}
function draw(canvas,areas){const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,r.width,r.height);for(let i=0;i<areas.length;i++){const a=areas[i],x=a.uv[0]*r.width,y=a.uv[1]*r.height,rad=Math.max(28,Math.min(r.width,r.height)*a.radiusN);g.strokeStyle='#61d6ff';g.fillStyle='rgba(20,160,255,.08)';g.lineWidth=3;g.beginPath();g.arc(x,y,rad,0,Math.PI*2);g.fill();g.stroke();g.fillStyle='#fff';g.font='700 14px system-ui';g.fillText(`P${i+1}`,x+rad+6,y);g.font='12px system-ui';g.fillText(`${Number(a.depthM||0).toFixed(2)} m · ${a.roiViews} viste`,x+rad+6,y+17);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
