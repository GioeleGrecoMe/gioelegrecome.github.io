import {SurfaceMeshLab} from '../js/experimental/surface_mesh_lab.js';

/**
 * Experimental post-scan surface/mesh worker (EXP-3 robust surface field).
 *
 * Important rollback property: the worker receives a bounded copy of the base
 * Gaussian map.  No message ever asks the main thread to overwrite V30.26's
 * state; it only returns EXP preview objects under a separate namespace.
 */
let lab=null,running=false,stopRequested=false,token=0,target=0,previewEvery=1,meshPreviewEvery=4,previewCounter=0,previewMax=24000,meshOptions={};

self.onmessage=e=>{
  const d=e.data||{};
  try{
    if(d.type==='init'){
      token++;running=false;stopRequested=false;previewCounter=0;meshOptions=d.meshOptions||{};
      lab=new SurfaceMeshLab(d.gaussians||[],d.observations||null,d.options||{});
      previewMax=Math.max(1000,Number(d.previewMax)||24000);
      postMessage({type:'surface-lab-ready',gaussians:lab.optimizer.items.length,observations:lab.observations?.count||0,iteration:lab.iteration});
      return;
    }
    if(d.type==='run'){
      if(!lab)throw new Error('surface lab not initialized');
      stopRequested=false;running=true;const t=++token,more=Math.max(1,Math.min(250,Number(d.iterations)||1));target=lab.iteration+more;previewEvery=Math.max(1,Math.min(20,Number(d.previewEvery)||1));meshPreviewEvery=Math.max(1,Math.min(8,Number(d.meshPreviewEvery)||4));previewCounter=0;runChunk(t);return;
    }
    if(d.type==='stop'){stopRequested=true;return;}
    if(d.type==='mesh'){
      if(!lab)throw new Error('surface lab not initialized');
      const t0=performance.now(),mesh=lab.buildMesh({...meshOptions,...(d.options||{})});mesh.buildMs=performance.now()-t0;postMessage({type:'surface-lab-mesh',iteration:lab.iteration,stats:lab.stats,mesh});return;
    }
    if(d.type==='snapshot'){
      if(!lab)throw new Error('surface lab not initialized');postMessage({type:'surface-lab-snapshot',iteration:lab.iteration,stats:lab.stats,gaussians:lab.surfaceSnapshot({max:d.max||previewMax})});return;
    }
  }catch(err){postMessage({type:'surface-lab-error',message:err.message,stack:err.stack});}
};

function runChunk(t){
  if(t!==token||!running||!lab)return;
  if(stopRequested){running=false;emitFinal('surface-lab-stopped');return;}
  if(lab.iteration>=target){running=false;emitFinal('surface-lab-done');return;}
  try{
    const stats=lab.step(1),shouldPreview=lab.iteration%previewEvery===0||lab.iteration>=target;
    if(shouldPreview){
      previewCounter++;const payload={type:'surface-lab-progress',iteration:lab.iteration,targetIteration:target,stats,gaussians:lab.surfaceSnapshot({max:previewMax})};
      // A coarse mesh every few visual updates is enough to show convergence;
      // rebuilding it on every numerical iteration would dominate phone time.
      if(previewCounter%meshPreviewEvery===0||lab.iteration>=target){const previewCfg={...meshOptions,voxelM:Number(meshOptions.previewVoxelM)||meshOptions.voxelM,maxVoxels:Number(meshOptions.previewMaxVoxels)||meshOptions.maxVoxels,maxTriangles:Number(meshOptions.previewMaxTriangles)||meshOptions.maxTriangles,maxGaussians:Number(meshOptions.previewMaxGaussians)||meshOptions.maxGaussians},t0=performance.now();payload.mesh=lab.buildMesh(previewCfg);payload.mesh.buildMs=performance.now()-t0;}
      postMessage(payload);
    }
  }catch(err){running=false;postMessage({type:'surface-lab-error',message:err.message,stack:err.stack});return;}
  setTimeout(()=>runChunk(t),0);
}
function emitFinal(type){try{const t0=performance.now(),mesh=lab.buildMesh(meshOptions);mesh.buildMs=performance.now()-t0;postMessage({type,iteration:lab.iteration,stats:lab.stats,gaussians:lab.surfaceSnapshot({max:previewMax}),mesh});}catch(err){postMessage({type:'surface-lab-error',message:err.message,stack:err.stack});}}
