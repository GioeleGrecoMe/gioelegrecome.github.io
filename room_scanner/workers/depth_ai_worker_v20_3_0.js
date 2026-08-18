/*
 * Room Scanner V20.3 - Depth Anything worker.
 *
 * The worker is intentionally post-XR. It prefers ONNX Runtime WebGPU on
 * current Chrome/Android and falls back to WASM. Only one frame is resident at
 * a time, which keeps peak memory bounded even when processing >100 keyframes.
 */
let session=null,inputName=null,outputName=null,currentConfig=null,provider='none',runtimeFlavor='none';

self.onmessage=async e=>{
  const m=e.data||{};
  try{
    if(m.type==='init')await init(m);
    else if(m.type==='process')await processFrame(m);
    else if(m.type==='dispose')dispose();
  }catch(error){postMessage({type:'error',requestId:m.requestId||null,message:error.message,stack:error.stack,provider,runtimeFlavor});}
};

async function init(m){
  if(session){postMessage({type:'ready',cached:true,provider,runtimeFlavor,modelUrl:currentConfig?.modelUrl});return;}
  currentConfig=m||{};
  const hasWebGPU=!!self.navigator?.gpu;
  const webgpuUrls=m.webgpuRuntimeUrls||[
    '../vendor/onnxruntime-web/ort.webgpu.min.js',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.webgpu.min.js'
  ];
  const wasmUrls=m.runtimeUrls||[
    '../vendor/onnxruntime-web/ort.min.js',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.min.js'
  ];
  let runtimeError=null;
  if(hasWebGPU){for(const url of webgpuUrls){try{importScripts(url);if(self.ort){runtimeFlavor='webgpu';runtimeError=null;break;}}catch(e){runtimeError=e;}}}
  if(!self.ort){for(const url of wasmUrls){try{importScripts(url);if(self.ort){runtimeFlavor='wasm';runtimeError=null;break;}}catch(e){runtimeError=e;}}}
  if(!self.ort)throw runtimeError||new Error('ONNX Runtime Web non disponibile');

  // These settings must be established before the first session is created.
  if(ort.env?.wasm){ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;if(m.wasmPaths)ort.env.wasm.wasmPaths=m.wasmPaths;}
  if(ort.env?.webgpu)ort.env.webgpu.powerPreference='high-performance';

  const modelUrls=m.modelUrls||[
    '../models/depth_anything_v2_vits_q4.onnx',
    'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4.onnx'
  ];
  let last=null;
  for(const url of modelUrls){
    // WebGPU is worth trying for a transformer depth network, but the same
    // browser/device may expose navigator.gpu while lacking one required op.
    if(hasWebGPU&&runtimeFlavor==='webgpu'){
      try{
        session=await ort.InferenceSession.create(url,{executionProviders:['webgpu','wasm'],graphOptimizationLevel:'all'});
        provider='webgpu';currentConfig.modelUrl=url;last=null;break;
      }catch(e){last=e;session=null;}
    }
    try{
      session=await ort.InferenceSession.create(url,{executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:true});
      provider='wasm';currentConfig.modelUrl=url;last=null;break;
    }catch(e){last=e;session=null;}
  }
  if(!session)throw last||new Error('Modello Depth Anything non disponibile');
  inputName=session.inputNames?.[0]||metadataName(session.inputMetadata);
  outputName=session.outputNames?.[0]||metadataName(session.outputMetadata);
  if(!inputName||!outputName)throw new Error('Input/output ONNX non riconosciuti');
  postMessage({type:'ready',modelUrl:currentConfig.modelUrl,inputName,outputName,provider,runtimeFlavor,webgpuAvailable:hasWebGPU});
}

function metadataName(meta){if(Array.isArray(meta))return meta[0]?.name||null;return Object.keys(meta||{})[0]||null;}

async function processFrame(m){
  if(!session)throw new Error('Depth worker non inizializzato');
  const size=Math.max(280,Math.min(630,Number(m.inputSize)||518));
  const bitmap=await createImageBitmap(m.blob);
  const canvas=new OffscreenCanvas(size,size),ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
  ctx.drawImage(bitmap,0,0,size,size);bitmap.close();
  const rgba=ctx.getImageData(0,0,size,size).data,input=new Float32Array(3*size*size),mean=[.485,.456,.406],std=[.229,.224,.225],plane=size*size;
  for(let i=0,p=0;i<rgba.length;i+=4,p++){
    input[p]=(rgba[i]/255-mean[0])/std[0];
    input[plane+p]=(rgba[i+1]/255-mean[1])/std[1];
    input[2*plane+p]=(rgba[i+2]/255-mean[2])/std[2];
  }
  const feeds={};feeds[inputName]=new ort.Tensor('float32',input,[1,3,size,size]);
  const t0=performance.now(),result=await session.run(feeds),inferenceMs=performance.now()-t0,tensor=result[outputName]||result[Object.keys(result)[0]];
  const source=tensor.data,depth=source instanceof Float32Array?new Float32Array(source):Float32Array.from(source),dims=tensor.dims||[1,size,size],outH=dims.at(-2)||size,outW=dims.at(-1)||size,rgb=new Uint8Array(outW*outH*3);
  if(outW===size&&outH===size){for(let p=0,i=0;p<outW*outH;p++,i+=4){rgb[p*3]=rgba[i];rgb[p*3+1]=rgba[i+1];rgb[p*3+2]=rgba[i+2];}}
  else{const c2=new OffscreenCanvas(outW,outH),x2=c2.getContext('2d',{alpha:false,willReadFrequently:true});x2.drawImage(canvas,0,0,outW,outH);const d2=x2.getImageData(0,0,outW,outH).data;for(let p=0,i=0;p<outW*outH;p++,i+=4){rgb[p*3]=d2[i];rgb[p*3+1]=d2[i+1];rgb[p*3+2]=d2[i+2];}}
  postMessage({type:'result',requestId:m.requestId,frameId:m.frameId,width:outW,height:outH,depth:depth.buffer,rgb:rgb.buffer,modelUrl:currentConfig.modelUrl,provider,runtimeFlavor,inferenceMs},[depth.buffer,rgb.buffer]);
}

function dispose(){try{session?.release?.();}catch{}session=null;postMessage({type:'disposed',provider,runtimeFlavor});close();}
