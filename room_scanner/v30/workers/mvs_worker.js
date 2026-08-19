/*
 * Camera-only MVS helper. It never calls a depth network. When explicit matched
 * rays/points are supplied it forwards validated metric samples; otherwise it
 * returns a conservative empty result rather than fabricating depth.
 */
let cfg={near:.3,far:9,depthSteps:36,gridStep:7,maxPoints:5200};
self.onmessage=e=>{const d=e.data||{};try{if(d.type==='init'){cfg={...cfg,...(d.config||{})};postMessage({type:'ready',config:cfg,mode:'camera-only-geometric'});return;}if(d.type==='densify'||d.type==='pair'||d.type==='process'){const src=d.points||d.triangulated||d.matches3d||[],out=[];for(const x of src){const p=x?.p||x?.position||x;if(!Array.isArray(p)||p.length<3||!p.every(Number.isFinite))continue;const z=Math.abs(Number(p[2]));if(z<cfg.near||z>cfg.far)continue;out.push({position:[+p[0],+p[1],+p[2]],color:x.color||x.rgb||[180,210,240],confidence:Number(x.confidence??1)});if(out.length>=cfg.maxPoints)break;}postMessage({type:'mvs-result',points:out,count:out.length,geometric:true});return;}postMessage({type:'status',mode:'camera-only-geometric'});}catch(err){postMessage({type:'mvs-error',message:err.message,stack:err.stack});}};
