/**
 * Exact-frame synchronization contract between camera -> AlvaAR -> Deep.
 *
 * Deep inference is asynchronous, so wall-clock completion time must NEVER be
 * used to choose a pose/features record.  A job is bound to the immutable
 * camera raster that created it.  The worker independently fingerprints that
 * raster and echoes frameId/frameAt; a late or out-of-order result is accepted
 * only if every identity field still matches.
 */

export function sampledFrameSignature(rgba,width,height){
  const src=rgba instanceof Uint8ClampedArray?rgba:new Uint8ClampedArray(rgba||0);
  let h=2166136261>>>0;
  const pixels=Math.max(1,(width|0)*(height|0)),samples=Math.min(257,pixels);
  for(let k=0;k<samples;k++){
    const p=Math.min(pixels-1,Math.floor(k*(pixels-1)/Math.max(1,samples-1))),i=p*4;
    for(let c=0;c<3;c++){h^=src[i+c]||0;h=Math.imul(h,16777619)>>>0;}
  }
  h^=width|0;h=Math.imul(h,16777619)>>>0;h^=height|0;h=Math.imul(h,16777619)>>>0;
  return h.toString(16).padStart(8,'0');
}

export function createDeepFrameBinding({jobId,kind='keyframe',frameId,frameAt,refId=null,rgba,width,height,payload=null,tracking=null,survey=null}={}){
  if(!jobId)throw new Error('Deep sync: jobId mancante');
  if(!frameId)throw new Error('Deep sync: frameId mancante');
  if(!(Number.isFinite(Number(frameAt))))throw new Error('Deep sync: frameAt mancante');
  if(!rgba?.length||!(width>1&&height>1))throw new Error('Deep sync: raster RGBA non valido');
  return {
    jobId:String(jobId),kind:String(kind),frameId:String(frameId),frameAt:Number(frameAt),
    refId:refId==null?null:String(refId),width:Number(width),height:Number(height),
    frameSignature:sampledFrameSignature(rgba,width,height),payload,tracking,survey,
    requestedAt:typeof performance!=='undefined'?performance.now():Date.now()
  };
}

export function validateDeepFrameResult(result,binding,{timeToleranceMs=.05}={}){
  if(!binding)return {ok:false,reason:'binding-missing'};
  if(String(result?.jobId||'')!==binding.jobId)return {ok:false,reason:'job-id-mismatch'};
  if(String(result?.frameId||'')!==binding.frameId)return {ok:false,reason:'frame-id-mismatch'};
  const at=Number(result?.frameAt);
  if(!Number.isFinite(at)||Math.abs(at-binding.frameAt)>timeToleranceMs)return {ok:false,reason:'frame-time-mismatch',deltaMs:Number.isFinite(at)?at-binding.frameAt:null};
  if(binding.refId!=null&&String(result?.refId||'')!==binding.refId)return {ok:false,reason:'ref-id-mismatch'};
  if(Number(result?.sourceWidth)!==binding.width||Number(result?.sourceHeight)!==binding.height)return {ok:false,reason:'raster-shape-mismatch'};
  if(String(result?.frameSignature||'')!==binding.frameSignature)return {ok:false,reason:'raster-signature-mismatch'};
  return {ok:true,reason:'exact-frame',frameId:binding.frameId,refId:binding.refId,ageMs:(typeof performance!=='undefined'?performance.now():Date.now())-binding.requestedAt};
}

export function sameCameraFrame(frame,keyframe,{timeToleranceMs=.05}={}){
  const a=String(frame?.frameId||''),b=String(keyframe?.frameId||keyframe?.sourceFrameId||'');
  if(!a||!b||a!==b)return {ok:false,reason:'frame-id-mismatch',frameId:a||null,keyframeFrameId:b||null};
  const fa=Number(frame?.at),ka=Number(keyframe?.at);
  if(!Number.isFinite(fa)||!Number.isFinite(ka)||Math.abs(fa-ka)>timeToleranceMs)return {ok:false,reason:'frame-time-mismatch',deltaMs:Number.isFinite(fa)&&Number.isFinite(ka)?fa-ka:null};
  return {ok:true,reason:'same-camera-frame',frameId:a};
}
