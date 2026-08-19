/*
 * V30.13 metric GS/mesh diagnostics UI.
 *
 * The scan HUD reports the live metric surface produced from Gaussian worker
 * snapshots. Review automatically builds a conservative occupancy mesh in a
 * worker so a successful scan always has an explicit geometric deliverable,
 * not just splat counters. The generated mesh stays in memory and can be
 * downloaded as PLY without recomputing it.
 */
const $=id=>document.getElementById(id);
const meshState=window.__ROOMSCAN_METRIC_MESH_STATE||{busy:false,lastError:null,sourceSamples:0,mesh:null,worker:null,lastLiveAt:0};
window.__ROOMSCAN_METRIC_MESH_STATE=meshState;

export function installMetricMeshUi(){
  const scan=$('scan'),review=$('review');
  if(scan&&!$('metricPipelineHud')){
    const d=document.createElement('div');d.id='metricPipelineHud';d.className='coach';d.style.bottom='7rem';d.textContent='Metrica: attendo triangolazione MVS e GS…';scan.appendChild(d);
  }
  if(review){
    const actions=review.querySelector('.actions.wrap');
    if(actions&&!$('buildMetricMeshBtn')){
      const b=document.createElement('button');b.id='buildMetricMeshBtn';b.textContent='Crea mesh metrica GS';actions.appendChild(b);
      b.addEventListener('click',async()=>{try{const mesh=meshState.mesh||await prepareReviewMesh({force:true});if(mesh)downloadPly(mesh);}catch(err){alert(`Meshing fallito: ${err.message}`);}});
    }
    if(!$('metricGsStats')){const d=document.createElement('div');d.id='metricGsStats';d.className='card compact';review.insertBefore(d,review.querySelector('.actions.wrap'));}
  }
  if(!window.__ROOMSCAN_METRIC_MESH_LISTENER){window.__ROOMSCAN_METRIC_MESH_LISTENER=true;window.addEventListener('roomscan:gaussian-surface',()=>updateMetricMeshUi());}
  updateMetricMeshUi();
}

export function updateMetricMeshUi(){
  const s=window.__ROOMSCAN_METRIC_SURFACE,h=$('metricPipelineHud'),d=$('metricGsStats'),metric=$('metricState')?.textContent||'scala —';
  if(s?.gaussians&&!/[—-]|unlocked|init|attesa|non/i.test(metric)&&/(scala|metric|m\b|lock|ok)/i.test(metric))s.metricLocked=true;
  if(h){
    if(!s?.workerSeen)h.textContent=`${metric} · attendo Gaussian worker`;
    else if(!s.gaussians)h.textContent=`${metric} · MVS attivo, attendo primi punti triangolati`;
    else{const b=s.bounds;h.textContent=`${metric} · GS ${b?.count||0} · superficie ${s.samples?.length||0} · bbox ${b?b.size.map(v=>v.toFixed(2)).join(' × '):'—'} m`;}
  }
  if(d){
    if(!s?.gaussians)d.textContent='Dati mesh: nessuno snapshot GS disponibile.';
    else{
      const m=meshState.mesh,nv=m?.vertices?.length?m.vertices.length/3:0,nf=m?.faces?.length?m.faces.length/3:0;
      d.textContent=`GS metriche: ${s.bounds?.count||0} · campioni: ${s.samples?.length||0} · bbox: ${s.bounds?.size?.map(v=>v.toFixed(3)).join(' × ')} m · camera metrica: ${s.metricLocked?'SI':'NON CONFERMATA'} · mesh: ${meshState.busy?'calcolo…':m?`${nv} vertici / ${nf} facce`:'attesa'}`;
    }
  }
  const b=$('buildMetricMeshBtn');if(b&&!meshState.busy)b.textContent=meshState.mesh?'Scarica mesh PLY':'Crea mesh metrica GS';
}

export async function prepareReviewMesh({force=false}={}){
  installMetricMeshUi();
  const s=window.__ROOMSCAN_METRIC_SURFACE;
  if(!s?.samples?.length){updateMetricMeshUi();return null;}
  if(!s.metricLocked)throw new Error('Camera metrica non confermata: completa il bridge con almeno 3 pin.');
  if(meshState.busy)return waitForMesh();
  if(meshState.mesh&&!force&&meshState.sourceSamples===s.samples.length)return meshState.mesh;
  meshState.busy=true;meshState.lastError=null;updateMetricMeshUi();
  const samples=s.samples;
  try{
    const mesh=await buildMeshWorker(samples,{voxelM:.04,maxVoxels:220000});
    meshState.mesh=mesh;meshState.sourceSamples=samples.length;window.__ROOMSCAN_METRIC_MESH=mesh;updateMetricMeshUi();
    window.dispatchEvent(new CustomEvent('roomscan:metric-mesh',{detail:{voxelM:mesh.voxelM,occupiedVoxels:mesh.occupiedVoxels,vertices:mesh.vertices.length/3,faces:mesh.faces.length/3}}));
    return mesh;
  }catch(err){meshState.lastError=err.message;throw err;}
  finally{meshState.busy=false;updateMetricMeshUi();}
}

export async function requestLiveMesh({minIntervalMs=5500,minSamples=260}={}){
  const s=window.__ROOMSCAN_METRIC_SURFACE,now=performance.now();
  if(!s?.metricLocked||!s?.samples?.length||s.samples.length<minSamples||meshState.busy||now-(meshState.lastLiveAt||0)<minIntervalMs)return meshState.mesh;
  meshState.busy=true;meshState.lastLiveAt=now;
  try{const samples=s.samples.length>65000?s.samples.filter((_,i)=>i%Math.ceil(s.samples.length/65000)===0):s.samples;const mesh=await buildMeshWorker(samples,{voxelM:.06,maxVoxels:90000});meshState.mesh=mesh;meshState.sourceSamples=s.samples.length;window.__ROOMSCAN_METRIC_MESH=mesh;window.dispatchEvent(new CustomEvent('roomscan:metric-mesh',{detail:{live:true,voxelM:mesh.voxelM,occupiedVoxels:mesh.occupiedVoxels,vertices:mesh.vertices.length/3,faces:mesh.faces.length/3}}));return mesh;}catch(err){meshState.lastError=err.message;return null;}finally{meshState.busy=false;updateMetricMeshUi();}
}

function buildMeshWorker(samples,{voxelM,maxVoxels}){return new Promise((resolve,reject)=>{const w=new Worker(`workers/metric_mesh_worker.js?v=${window.RoomScanV30?.BUILD?.version||'30.13.0'}`);meshState.worker=w;const timer=setTimeout(()=>{w.terminate();meshState.worker=null;reject(new Error('mesh worker timeout'));},12000);w.onmessage=e=>{const d=e.data||{};if(d.type==='mesh-result'){clearTimeout(timer);w.terminate();meshState.worker=null;resolve(d);}else if(d.type==='mesh-error'){clearTimeout(timer);w.terminate();meshState.worker=null;reject(new Error(d.message||'mesh worker error'));}};w.onerror=e=>{clearTimeout(timer);w.terminate();meshState.worker=null;reject(new Error(e.message||'mesh worker error'));};w.postMessage({type:'mesh',samples,voxelM,maxVoxels});});}
function waitForMesh(){return new Promise((resolve,reject)=>{const started=performance.now(),tick=()=>{if(!meshState.busy)return meshState.mesh?resolve(meshState.mesh):reject(new Error(meshState.lastError||'mesh unavailable'));if(performance.now()-started>12500)return reject(new Error('mesh wait timeout'));setTimeout(tick,80);};tick();});}

export function downloadMetricMesh(){if(!meshState.mesh)throw new Error('Mesh non ancora disponibile');downloadPly(meshState.mesh);}
function downloadPly(m){const V=m.vertices,C=m.colors,F=m.faces,nv=V.length/3,nf=F.length/3,lines=[`ply`,`format ascii 1.0`,`comment Room Scanner V30.13 metric splat occupancy mesh`,`comment voxel_m ${m.voxelM}`,`element vertex ${nv}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue',`element face ${nf}`,'property list uchar int vertex_indices','end_header'];for(let i=0;i<nv;i++)lines.push(`${V[i*3]} ${V[i*3+1]} ${V[i*3+2]} ${C[i*3]||180} ${C[i*3+1]||180} ${C[i*3+2]||180}`);for(let i=0;i<nf;i++)lines.push(`3 ${F[i*3]} ${F[i*3+1]} ${F[i*3+2]}`);const blob=new Blob([lines.join('\n')+'\n'],{type:'application/octet-stream'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`roomscan_metric_mesh_${Date.now()}.ply`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installMetricMeshUi,{once:true});else installMetricMeshUi();
