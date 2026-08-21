import {ViewPuzzleGraph} from '../js/reconstruction/view_puzzle.js';
import {DepthScaleGraph} from '../js/reconstruction/depth_scale_graph.js';
import {HybridSceneSolver} from '../js/reconstruction/hybrid_scene_solver.js';
import {LivePhotoPuzzleMap} from '../js/reconstruction/live_photo_puzzle.js';

let graph=null,puzzle=null,depthScale=null,solver=null,stopping=false,token=0;
self.onmessage=e=>{const d=e.data||{};Promise.resolve(handle(d)).catch(err=>self.postMessage({type:'puzzle-error',message:err?.message||String(err),stack:err?.stack||null}));};
async function handle(d){
  if(d.type==='stop'){stopping=true;token++;self.postMessage({type:'puzzle-stopping'});return;}
  if(d.type==='init'){
    token++;stopping=false;graph=d.graph;if(!graph)throw new Error('factor graph missing');
    self.postMessage({type:'puzzle-stage',stage:'photo-puzzle',message:'Collego fotografie e cerco chiusure visive…'});
    puzzle=new ViewPuzzleGraph(graph,d.puzzleOptions||{}).build();const atlas=puzzle.renderAtlas(d.atlasOptions||{});self.postMessage({type:'puzzle-atlas',stats:puzzle.stats,atlas},[atlas.rgba.buffer]);
    self.postMessage({type:'puzzle-stage',stage:'depth-scale',message:'Allineo le depth relative sul grafo fotografico…'});
    depthScale=new DepthScaleGraph(graph,puzzle,d.depthOptions||{}).build();
    // Replace the orientation-only averaged diagnostic with the same pose/depth
    // aware, z-buffered atlas used live. This is a view of the solved evidence,
    // not an input resampling step for the 3-D solver.
    const sharpMap=new LivePhotoPuzzleMap({width:d.atlasOptions?.width||480,height:d.atlasOptions?.height||240,maxFrames:Math.max(90,(graph.frames||[]).length),maxRenderFrames:Math.max(90,(graph.frames||[]).length),maxPhotoSamples:300000,maxDepthSamples:220000});
    sharpMap.loadSolvedGraph(graph,puzzle,depthScale);const sharpAtlas=sharpMap.renderPhotoAtlas();self.postMessage({type:'puzzle-atlas',stats:{...puzzle.stats,depthAlignedFrames:depthScale.stats?.alignedFrames||0,sharpPoseDepthAtlas:true},atlas:sharpAtlas},[sharpAtlas.rgba.buffer]);
    self.postMessage({type:'puzzle-stage',stage:'geometry',message:'Estraggo piani e inizializzo le particelle residue…',depthStats:depthScale.stats});
    solver=new HybridSceneSolver(graph,puzzle,depthScale,{particleBudget:d.particleBudget||3000,maxObservations:d.maxObservations||65000,maxPlanes:d.maxPlanes||8,initial:d.initial||null});solver.prepare();const preview=solver.preview();self.postMessage({type:'puzzle-ready',stats:solver.stats,puzzleStats:puzzle.stats,depthStats:depthScale.stats,preview,state:solver.exportState()},transferPreview(preview));return;
  }
  if(d.type==='run'){
    if(!solver)throw new Error('puzzle solver not initialised');const my=++token;stopping=false;const n=Math.max(1,d.iterations|0||1),every=Math.max(1,d.previewEvery|0||1);for(let i=0;i<n;i++){if(stopping||my!==token){self.postMessage({type:'puzzle-stopped',done:i,stats:solver.stats,state:solver.exportState()});return;}solver.step(1);if((i+1)%every===0||i===n-1){const preview=solver.preview();self.postMessage({type:'puzzle-progress',done:i+1,stats:solver.stats,preview,state:solver.exportState()},transferPreview(preview));}await new Promise(r=>setTimeout(r,0));}const preview=solver.preview();self.postMessage({type:'puzzle-done',done:n,stats:solver.stats,preview,state:solver.exportState()},transferPreview(preview));return;
  }
  if(d.type==='preview'){if(!solver)throw new Error('puzzle solver not initialised');const preview=solver.preview();self.postMessage({type:'puzzle-preview',stats:solver.stats,preview,state:solver.exportState()},transferPreview(preview));}
}
function transferPreview(p){const a=[];if(p?.mesh?.vertices?.buffer)a.push(p.mesh.vertices.buffer);if(p?.mesh?.colors?.buffer)a.push(p.mesh.colors.buffer);if(p?.mesh?.faces?.buffer)a.push(p.mesh.faces.buffer);return a;}
