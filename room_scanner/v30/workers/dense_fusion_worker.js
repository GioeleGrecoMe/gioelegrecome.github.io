import {SparseDenseFusion} from '../js/dense/fusion_core.js';
let fusion=null,cfg={voxel:.035,truncation:.105,minSupport:2,maxSurfels:180000,maxTsdf:450000,snapshotEvery:2,meshEvery:12,maxSplats:45000,maxTriangles:90000,minConfirmBaseline:.025,tsdfMinSupport:3,tsdfMaxSurfels:60000,liveTsdfMaxSurfels:18000};
self.onmessage=e=>{const d=e.data||{};try{
  if(d.type==='init'){cfg={...cfg,...(d.config||{})};fusion=new SparseDenseFusion(cfg);postMessage({type:'ready',mode:'probabilistic-ray-consensus',config:cfg});return;}
  if(!fusion)throw new Error('fusion worker not initialized');
  if(d.type==='integrate'){
    const t=performance.now(),st=fusion.integrate(d.samples||[],{origin:d.origin||[0,0,0],frameId:d.frameId,mode:d.mode||'dense'}),out={type:'surface-result',frameId:d.frameId,mode:d.mode||'dense',...st,ms:performance.now()-t};
    if(fusion.frames%cfg.snapshotEvery===0||d.forceSnapshot){out.splats=fusion.splats({max:cfg.maxSplats});out.confirmed=out.splats.length;}
    if(d.forceMesh||fusion.frames%cfg.meshEvery===0){out.mesh=fusion.mesh({maxTriangles:cfg.maxTriangles,maxSurfels:d.forceMesh?cfg.tsdfMaxSurfels:cfg.liveTsdfMaxSurfels});out.tsdfVoxels=fusion.tsdf.size;}
    postMessage(out);return;
  }
  if(d.type==='snapshot'){postMessage({type:'surface-snapshot',splats:fusion.splats({max:d.maxSplats||cfg.maxSplats}),frames:fusion.frames,surfels:fusion.surfels.size,confirmed:fusion._confirmedCount?.()||0,tsdfVoxels:fusion.tsdf.size});return;}
  if(d.type==='mesh'){postMessage({type:'mesh-result',...fusion.mesh({maxTriangles:d.maxTriangles||cfg.maxTriangles,maxSurfels:d.maxSurfels||cfg.tsdfMaxSurfels}),frames:fusion.frames,surfels:fusion.surfels.size,confirmed:fusion._confirmedCount?.()||0});return;}
}catch(err){postMessage({type:'fusion-error',message:err.message,stack:err.stack});}};
