import {GaussianBatchOptimizer} from '../js/gaussian/batch_optimizer.js';

/**
 * Chunked post-scan optimiser worker.
 *
 * One optimisation iteration can touch tens of thousands of splats.  Keeping
 * the loop in a Worker protects the review controls; scheduling one chunk with
 * setTimeout(0) also lets a STOP message be observed between chunks instead of
 * forcing the user to wait for the whole requested budget.
 */
let optimizer=null;
let running=false;
let stopRequested=false;
let runToken=0;
let targetIteration=0;
let previewEvery=1;
let previewMax=70000;
let lastPreviewAt=0;

self.onmessage=e=>{
  const d=e.data||{};
  try{
    if(d.type==='init'){
      runToken++;running=false;stopRequested=false;
      optimizer=new GaussianBatchOptimizer(d.gaussians||[],d.observations||null,d.options||{});
      previewMax=Math.max(1000,Number(d.previewMax)||70000);
      postMessage({type:'optimizer-ready',count:optimizer.items.length,observations:optimizer.observations?.count||0,cellSize:optimizer.cellSize});
      return;
    }
    if(d.type==='run'){
      if(!optimizer)throw new Error('optimizer not initialized');
      stopRequested=false;running=true;const token=++runToken,more=Math.max(1,Math.min(500,Number(d.iterations)||1));targetIteration=optimizer.iteration+more;previewEvery=Math.max(1,Math.min(25,Number(d.previewEvery)||1));lastPreviewAt=optimizer.iteration;runChunk(token);return;
    }
    if(d.type==='stop'){stopRequested=true;return;}
    if(d.type==='snapshot'){
      if(!optimizer)throw new Error('optimizer not initialized');
      postMessage({type:'optimizer-snapshot',iteration:optimizer.iteration,stats:optimizer.lastStats,gaussians:optimizer.snapshot({max:d.max||previewMax})});return;
    }
  }catch(err){postMessage({type:'optimizer-error',message:err.message,stack:err.stack});}
};

function runChunk(token){
  if(token!==runToken||!running||!optimizer)return;
  if(stopRequested){running=false;postMessage({type:'optimizer-stopped',iteration:optimizer.iteration,stats:optimizer.lastStats,gaussians:optimizer.snapshot({max:previewMax})});return;}
  if(optimizer.iteration>=targetIteration){running=false;postMessage({type:'optimizer-done',iteration:optimizer.iteration,stats:optimizer.lastStats,gaussians:optimizer.snapshot({max:previewMax})});return;}

  try{
    const stats=optimizer.step(1),atPreview=(optimizer.iteration-lastPreviewAt)>=previewEvery||optimizer.iteration>=targetIteration;
    if(atPreview){lastPreviewAt=optimizer.iteration;postMessage({type:'optimizer-progress',iteration:optimizer.iteration,targetIteration,stats,gaussians:optimizer.snapshot({max:previewMax})});}
  }catch(err){running=false;postMessage({type:'optimizer-error',message:err.message,stack:err.stack});return;}
  setTimeout(()=>runChunk(token),0);
}
