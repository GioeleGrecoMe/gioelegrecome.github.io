/**
 * V30.49 sharp-RGB archive worker.
 *
 * Compression is deliberately off the acquisition/main thread. The caller
 * sends an owned RGBA copy only after the frame-quality gate accepts it; this
 * worker converts that immutable raster to a compact JPEG Blob for IndexedDB.
 */
self.onmessage=async e=>{
  const d=e.data||{};
  if(d.type!=='archive-rgb')return;
  const id=String(d.id||''),width=d.width|0,height=d.height|0;
  try{
    if(!id||width<2||height<2||!d.rgba?.byteLength)throw new Error('invalid archive raster');
    if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas unavailable');
    const rgba=new Uint8ClampedArray(d.rgba),canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:false});
    if(!ctx)throw new Error('2D OffscreenCanvas unavailable');
    ctx.putImageData(new ImageData(rgba,width,height),0,0);
    let type=d.mime||'image/jpeg',quality=Number.isFinite(+d.quality)?Math.max(.55,Math.min(.96,+d.quality)):.88;
    let blob=await canvas.convertToBlob({type,quality});
    if(!blob?.size&&type!=='image/png'){type='image/png';blob=await canvas.convertToBlob({type});}
    if(!blob?.size)throw new Error('archive compression produced empty blob');
    self.postMessage({type:'archive-rgb-result',id,blob,mime:blob.type||type,bytes:blob.size,width,height});
  }catch(err){
    self.postMessage({type:'archive-rgb-error',id,message:err?.message||String(err)});
  }
};
