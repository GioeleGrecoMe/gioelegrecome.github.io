import {CaptureRepository} from './db_v20_2_0.js';
import {downloadBlob} from './raw_export_v20_2_0.js';
import {ModelPreview3D} from './model_preview_v20_4_2.js';

const $=s=>document.querySelector(s),repo=new CaptureRepository();
let sessionId=null,worker=null,acousticWorker=null,currentModel=null,viewer=null;
const log=(text,level='info')=>{const box=$('#processing-log');box.textContent+=`${new Date().toLocaleTimeString()} ${level.toUpperCase()} ${text}\n`;box.scrollTop=box.scrollHeight;};

async function init(){
  await repo.open();
  viewer=new ModelPreview3D($('#model-preview'),{statusElement:$('#model-preview-status'),maxPoints:180000});
  bindViewerControls();
  const query=new URLSearchParams(location.search);sessionId=query.get('session')||(await repo.latestSession())?.id;
  if(!sessionId){$('#processing-stage').textContent='Nessuna sessione disponibile.';$('#btn-run-processing').disabled=true;return;}
  const session=await repo.getSession(sessionId);$('#processing-stage').textContent=`Sessione ${sessionId} · stato ${session.status}`;
  currentModel=await repo.getModel(sessionId);
  if(currentModel){$('#btn-export-model').disabled=false;showModel(currentModel);log('È presente un modello già salvato.');}
}

$('#btn-run-processing').addEventListener('click',()=>run());
$('#btn-run-acoustics').addEventListener('click',()=>runAcoustics());
$('#btn-cancel-processing').addEventListener('click',()=>worker?.postMessage({type:'cancel'}));
$('#btn-export-model').addEventListener('click',()=>{if(!currentModel)return;downloadBlob(new Blob([JSON.stringify(currentModel,null,2)],{type:'application/json'}),`roomscan-${sessionId}-model.json`);});

async function run(){
  if(worker){worker.terminate();worker=null;}
  $('#btn-run-processing').disabled=true;$('#btn-export-model').disabled=true;
  const mode=$('#processing-mode').value,memoryBudgetMB=Number($('#memory-budget').value);log(`Avvio modalità ${mode}, budget ${memoryBudgetMB} MB.`);
  worker=new Worker(new URL('../workers/processing_worker_v20_4_0.js',import.meta.url),{type:'module'});
  worker.onmessage=e=>{
    const m=e.data||{};
    if(m.type==='progress'||m.type==='warning'||m.type==='cancelled'){
      if(Number.isFinite(m.progress))$('#processing-progress').value=m.progress;$('#processing-stage').textContent=m.detail||m.type;log(m.detail||m.type,m.type==='warning'?'warn':'info');
    }else if(m.type==='complete'){
      currentModel=m.model;$('#processing-progress').value=100;
      $('#processing-stage').textContent=`Completato: ${m.summary.gaussians??m.summary.surfels??0} Gaussian, ${m.summary.planes} superfici, ${m.summary.objects} oggetti.`;
      $('#btn-export-model').disabled=false;$('#btn-run-processing').disabled=false;log('Modello salvato in IndexedDB.');showModel(currentModel);worker.terminate();worker=null;
    }else if(m.type==='error'){
      log(`${m.message}\n${m.stack||''}`,'error');$('#processing-stage').textContent='Errore: i RAW restano disponibili.';$('#btn-run-processing').disabled=false;worker?.terminate();worker=null;
    }
  };
  worker.onerror=e=>{log(e.message,'error');$('#btn-run-processing').disabled=false;};
  worker.postMessage({type:'run',sessionId,mode,memoryBudgetMB});
}

async function runAcoustics(){
  if(acousticWorker)acousticWorker.terminate();$('#btn-run-acoustics').disabled=true;log('Avvio analisi RIR relativa in worker separato.');
  acousticWorker=new Worker(new URL('../workers/acoustic_worker_v20_2_0.js',import.meta.url),{type:'module'});
  acousticWorker.onmessage=async e=>{const m=e.data||{};if(m.type==='progress'){if(Number.isFinite(m.progress))$('#processing-progress').value=m.progress;$('#processing-stage').textContent=m.detail;log(m.detail);}else if(m.type==='complete'){log(`RIR completate: ${m.count}, valide ${m.valid}.`);currentModel=await repo.getModel(sessionId);if(currentModel){$('#btn-export-model').disabled=false;showModel(currentModel);}$('#btn-run-acoustics').disabled=false;acousticWorker.terminate();acousticWorker=null;}else if(m.type==='error'){log(m.message,'error');$('#btn-run-acoustics').disabled=false;acousticWorker?.terminate();acousticWorker=null;}};
  acousticWorker.onerror=e=>{log(e.message,'error');$('#btn-run-acoustics').disabled=false;};acousticWorker.postMessage({type:'run',sessionId});
}

function showModel(model){
  viewer?.setModel(model);
  const g=model?.geometry||{},surfels=g.surfels||g.pointGaussians||g.gaussians||[],confirmed=surfels.reduce((n,p)=>n+(p?.gaussian?.confirmed?1:0),0),xr=surfels.reduce((n,p)=>n+(p?.sourceCounts?.xr||0),0),deep=surfels.reduce((n,p)=>n+(p?.sourceCounts?.deep||0),0);
  $('#preview-gaussians').textContent=(g.gaussianCount??surfels.length??0).toLocaleString('it-IT');
  $('#preview-confirmed').textContent=confirmed.toLocaleString('it-IT');
  $('#preview-surfaces').textContent=(g.structuralSurfaces?.length||0).toLocaleString('it-IT');
  $('#preview-objects').textContent=(g.objects?.length||0).toLocaleString('it-IT');
  $('#preview-rays').textContent=(g.rawRaySamples||0).toLocaleString('it-IT');
  $('#preview-provenance').textContent=`XR ${xr.toLocaleString('it-IT')} · Deep ${deep.toLocaleString('it-IT')}`;
}

function bindViewerControls(){
  $('#btn-view-reset')?.addEventListener('click',()=>viewer?.resetView());
  $('#view-points')?.addEventListener('change',e=>viewer?.setLayer('points',e.target.checked));
  $('#view-surfaces')?.addEventListener('change',e=>viewer?.setLayer('surfaces',e.target.checked));
  $('#view-objects')?.addEventListener('change',e=>viewer?.setLayer('objects',e.target.checked));
  $('#view-point-size')?.addEventListener('input',e=>viewer?.setPointSize(e.target.value));
}

init().catch(e=>{log(e.stack||e.message,'error');$('#processing-stage').textContent=e.message;});
