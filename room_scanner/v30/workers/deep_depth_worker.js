/**
 * Lazy Depth Anything V2 Small worker.
 *
 * The neural runtime/model is NOT loaded at scan startup. The first inference
 * request loads a quantized model, preferring WebGPU and falling back to WASM.
 * Later requests reuse the same pipeline/browser cache. This keeps Alva tracking
 * independent from neural-depth availability and avoids inference on video frames.
 */
let pipe=null,provider='unloaded',busy=false,cfg={
  modelId:'onnx-community/depth-anything-v2-small',dtype:'q4',
  transformersLocal:'../vendor/transformers/transformers.min.js',
  transformersRemote:'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm'
};
async function importTransformers(){
  if(cfg.transformersLocal){try{return await import(cfg.transformersLocal);}catch(err){postMessage({type:'deep-diag',level:'info',event:'local-transformers-unavailable',message:err?.message||String(err)});}}
  return import(cfg.transformersRemote);
}
async function ensurePipe(){
  if(pipe)return pipe;const T=await importTransformers(),opts={dtype:cfg.dtype||'q4'};
  if(globalThis.navigator?.gpu){try{pipe=await T.pipeline('depth-estimation',cfg.modelId,{...opts,device:'webgpu'});provider='webgpu';return pipe;}catch(err){postMessage({type:'deep-diag',level:'warn',event:'webgpu-depth-fallback',message:err?.message||String(err)});}}
  pipe=await T.pipeline('depth-estimation',cfg.modelId,{...opts,device:'wasm'});provider='wasm';return pipe;
}
async function rgbaObjectUrl(rgba,width,height){
  if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas unavailable for Depth Anything input');
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('2D OffscreenCanvas unavailable');
  const data=rgba instanceof Uint8ClampedArray?rgba:new Uint8ClampedArray(rgba),image=ctx.createImageData(width,height);image.data.set(data);ctx.putImageData(image,0,0);
  const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.82});return URL.createObjectURL(blob);
}
function tensorToRaw(result){
  const t=result?.predicted_depth||result?.predictedDepth||result?.depth?.tensor||null;
  if(t?.data?.length){const dims=t.dims||t.shape||[],h=Number(dims[dims.length-2]||0),w=Number(dims[dims.length-1]||0);if(w>1&&h>1&&w*h<=t.data.length)return {rawDepth:Float32Array.from(t.data.slice(t.data.length-w*h)),width:w,height:h};}
  const im=result?.depth;if(im?.data?.length&&im.width>1&&im.height>1){const n=im.width*im.height,src=im.data,out=new Float32Array(n),channels=Math.max(1,Math.round(src.length/n));for(let i=0;i<n;i++)out[i]=src[i*channels];return {rawDepth:out,width:im.width,height:im.height};}
  throw new Error('Depth Anything returned no readable depth tensor');
}
self.onmessage=async e=>{
  const d=e.data||{};
  if(d.type==='init'){cfg={...cfg,...(d.config||{})};postMessage({type:'deep-ready',provider:'lazy',modelId:cfg.modelId});return;}
  if(d.type==='status'){postMessage({type:'deep-status',provider,busy,loaded:!!pipe,modelId:cfg.modelId});return;}
  if(d.type!=='infer')return;if(busy){postMessage({type:'deep-error',jobId:d.jobId,message:'Depth Anything worker already busy'});return;}
  busy=true;let url=null;const t0=performance.now();
  try{
    if(!d.rgba?.length||!(d.width>1&&d.height>1))throw new Error('invalid RGBA inference frame');
    const p=await ensurePipe();url=await rgbaObjectUrl(d.rgba,d.width,d.height);const result=await p(url),raw=tensorToRaw(result);
    postMessage({type:'deep-result',jobId:d.jobId,refId:d.refId,provider,rawDepth:raw.rawDepth,rawWidth:raw.width,rawHeight:raw.height,ms:performance.now()-t0},[raw.rawDepth.buffer]);
  }catch(err){postMessage({type:'deep-error',jobId:d.jobId,message:err?.message||String(err),stack:err?.stack||null,provider,ms:performance.now()-t0});}
  finally{if(url)URL.revokeObjectURL(url);busy=false;}
};
