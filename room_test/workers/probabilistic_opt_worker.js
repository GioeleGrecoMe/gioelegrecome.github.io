import {ProbabilisticJointOptimizer} from '../js/probabilistic/joint_optimizer.js';
let opt=null,token=0,stopping=false;
self.onmessage=e=>{const d=e.data||{};try{
  if(d.type==='init'){token++;stopping=false;opt=new ProbabilisticJointOptimizer(d.graph,d.options||{});self.postMessage({type:'prob-opt-ready',stats:opt.lastStats});return;}
  if(d.type==='stop'){stopping=true;token++;self.postMessage({type:'prob-opt-stopped',stats:opt?.lastStats||null});return;}
  if(d.type==='run'){if(!opt)throw new Error('probabilistic optimiser not initialised');const my=++token;stopping=false;run(my,Math.max(1,d.iterations|0||1),Math.max(1,d.previewEvery|0||1),d.rebuildOptions||{});return;}
  if(d.type==='rebuild'){if(!opt)throw new Error('probabilistic optimiser not initialised');const map=opt.rebuild(d.options||{});self.postMessage({type:'prob-opt-map',map,snapshot:opt.snapshot(),stats:opt.lastStats},transferMap(map));return;}
  if(d.type==='snapshot'){self.postMessage({type:'prob-opt-snapshot',snapshot:opt?.snapshot()||null});}
}catch(err){self.postMessage({type:'prob-opt-error',message:err?.message||String(err),stack:err?.stack||null});}};
function run(my,total,every,rebuildOptions){let done=0;const chunk=()=>{if(stopping||my!==token)return;try{const n=Math.min(every,total-done),stats=opt.step(n);done+=n;self.postMessage({type:'prob-opt-progress',done,total,stats,snapshot:opt.snapshot(),previewGaussians:opt.landmarkPreview(14000)});if(done>=total){const map=opt.rebuild(rebuildOptions);self.postMessage({type:'prob-opt-complete',done,total,stats:opt.lastStats,snapshot:opt.snapshot(),map},transferMap(map));return;}setTimeout(chunk,0);}catch(err){self.postMessage({type:'prob-opt-error',message:err?.message||String(err),stack:err?.stack||null});}};chunk();}
function transferMap(map){const out=[];for(const k of ['vertices','colors','faces'])if(map?.mesh?.[k]?.buffer)out.push(map.mesh[k].buffer);return out;}
