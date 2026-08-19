/* Room Scanner V30.1 - optional Depth Anything worker.
 * The worker is intentionally fail-open: camera/WASM SLAM and diagnostics keep
 * running if the neural runtime/model cannot be loaded on a particular phone. */
let pipe=null,provider='disabled',busy=false,cfg=null;
async function importTransformers(){
  // A fully local deployment may place an ES module at this path. Missing local
  // assets are expected and trigger the CDN fallback rather than killing V30.
  try{return await import('../vendor/transformers/transformers.min.js');}catch(localErr){
    postMessage({type:'diag',level:'warn',event:'deep-local-runtime-missing',message:localErr.message});
  }
  return await import(cfg.transformersRemote);
}
async function ensurePipe(){
  if(pipe)return pipe; const T=await importTransformers();
  const opts={dtype:'q4'};
  if('gpu' in navigator){try{pipe=await T.pipeline('depth-estimation',cfg.modelId,{...opts,device:'webgpu'});provider='webgpu';return pipe;}catch(e){postMessage({type:'diag',level:'warn',event:'deep-webgpu-fallback',message:e.message});}}
  pipe=await T.pipeline('depth-estimation',cfg.modelId,{...opts,device:'wasm'});provider='wasm';return pipe;
}
function tensorToDepth(result){
  const t=result?.predicted_depth||result?.predictedDepth;
  if(t?.data&&t?.dims){const dims=t.dims, h=dims[dims.length-2],w=dims[dims.length-1];return {depth:Float32Array.from(t.data),width:w,height:h};}
  const d=result?.depth;
  if(d?.data&&d.width&&d.height){const src=d.data,out=new Float32Array(d.width*d.height),channels=Math.max(1,Math.round(src.length/out.length));for(let i=0;i<out.length;i++)out[i]=src[i*channels];return {depth:out,width:d.width,height:d.height};}
  throw new Error('Depth pipeline returned no supported tensor');
}
async function makeRgb(blob,w,h){const bmp=await createImageBitmap(blob),c=new OffscreenCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();const rgba=ctx.getImageData(0,0,w,h).data,rgb=new Uint8Array(w*h*3);for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];}return rgb;}
async function infer(m){if(busy)throw new Error('depth worker busy');busy=true;try{const p=await ensurePipe();const blob=new Blob([m.jpeg],{type:'image/jpeg'}),url=URL.createObjectURL(blob);let result;try{result=await p(url);}finally{URL.revokeObjectURL(url);}const out=tensorToDepth(result),rgb=await makeRgb(blob,out.width,out.height);postMessage({type:'depth',requestId:m.requestId,frameId:m.frameId,width:out.width,height:out.height,depth:out.depth.buffer,rgb:rgb.buffer,provider},[out.depth.buffer,rgb.buffer]);}finally{busy=false;}}
self.onmessage=async e=>{const m=e.data||{};try{if(m.type==='init'){cfg=m.config;postMessage({type:'ready'});}else if(m.type==='infer')await infer(m);else if(m.type==='ping')postMessage({type:'pong'});}catch(err){busy=false;postMessage({type:'error',requestId:m.requestId,frameId:m.frameId,message:err.message,stack:err.stack,provider});}};
