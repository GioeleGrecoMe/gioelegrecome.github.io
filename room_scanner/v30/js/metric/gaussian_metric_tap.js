/* V30.15.0 non-invasive Gaussian worker observer.
 * It does NOT change Gaussian worker messages. It mirrors recognizable Gaussian
 * snapshots in either metric or scale-free Alva world, then derives surface
 * samples/bounds for meshing and diagnostics.
 */
import {gaussianMetricBounds,gaussianSurfaceSamples} from './metric_geometry.js';

const nativeWorker=window.Worker;
const state=window.__ROOMSCAN_METRIC_SURFACE={workerSeen:false,lastType:null,gaussians:null,samples:[],bounds:null,metricLocked:false,updatedAt:0,diagnostic:null};

function metricLocked(){const t=document.getElementById('metricState')?.textContent||'';return !/[—-]|unlocked|init|attesa|non/i.test(t)&&/(scala|metric|m\b|lock|ok)/i.test(t);}
function objectsFrom(data){
  const seen=new Set();
  function walk(v,depth=0){if(!v||depth>3||seen.has(v))return null;if(typeof v==='object')seen.add(v);
    if(Array.isArray(v)&&v.length&&typeof v[0]==='object'){const p=v[0]?.position||v[0]?.p||v[0]?.mean||v[0]?.xyz;if(Array.isArray(p)&&p.length>=3)return v;}
    if(v?.positions&&(ArrayBuffer.isView(v.positions)||Array.isArray(v.positions))){const ps=v.positions,cs=v.colors||v.rgb||null,op=v.opacities||v.opacity||null,sc=v.scales||v.scale||null,out=[];for(let i=0;i+2<ps.length;i+=3){const j=i/3;out.push({position:[Number(ps[i]),Number(ps[i+1]),Number(ps[i+2])],color:cs&&cs.length>=i+3?[cs[i],cs[i+1],cs[i+2]]:null,opacity:op?Number(op[j]??1):1,scale:sc&&sc.length>=i+3?[sc[i],sc[i+1],sc[i+2]]:null});}if(out.length)return out;}
    if(typeof v==='object')for(const k of ['gaussians','snapshot','points','splats','data','payload']){const r=walk(v[k],depth+1);if(r)return r;}return null;}
  return walk(data);
}
function capture(data,url){state.workerSeen=true;state.lastType=data?.type||null;const gs=objectsFrom(data);if(!gs?.length){state.diagnostic={url:String(url),keys:data&&typeof data==='object'?Object.keys(data).slice(0,20):[],reason:'no recognizable Gaussian positions in this message'};return;}
  state.metricLocked=metricLocked();state.gaussians=gs;state.bounds=gaussianMetricBounds(gs);state.samples=gaussianSurfaceSamples(gs,{opacityMin:.12,maxSamples:180000});state.updatedAt=Date.now();state.diagnostic={url:String(url),recognized:gs.length,samples:state.samples.length,metricLocked:state.metricLocked,unit:state.metricLocked?'m':'alva-unit'};window.dispatchEvent(new CustomEvent('roomscan:gaussian-surface',{detail:{...state,gaussians:undefined}}));
}
if(typeof nativeWorker==='function'){
  window.Worker=new Proxy(nativeWorker,{construct(Target,args,newTarget){const w=Reflect.construct(Target,args,newTarget===proxy?Target:newTarget),url=args[0];if(/gaussian_worker/i.test(String(url))){state.workerSeen=true;w.addEventListener('message',e=>{try{capture(e.data,url);}catch(err){state.diagnostic={reason:'capture-error',message:err.message};}});}return w;}});
  // Keep a stable reference because construct trap receives this Proxy as newTarget
  var proxy=window.Worker;
}
