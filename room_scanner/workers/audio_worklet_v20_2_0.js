/**
 * PCM recorder worklet. It emits bounded Int16 chunks and never keeps the full
 * recording in the audio render thread. A flush command returns the partial
 * tail before XR shutdown.
 */
class RoomScanPCMProcessor extends AudioWorkletProcessor {
  constructor(options){super();const p=options.processorOptions||{};this.chunkFrames=Math.max(2048,p.chunkFrames||12288);this.buffer=new Int16Array(this.chunkFrames);this.offset=0;this.sequence=0;this.totalFrames=0;this.running=true;this.port.onmessage=e=>{if(e.data?.type==='flush')this.flush(true);if(e.data?.type==='stop'){this.flush(true);this.running=false;this.port.postMessage({type:'stopped',totalFrames:this.totalFrames});}};}
  process(inputs){if(!this.running)return true;const channels=inputs[0];if(!channels?.length)return true;const input=channels[0];for(let i=0;i<input.length;i++){const s=Math.max(-1,Math.min(1,input[i]));this.buffer[this.offset++]=s<0?s*32768:s*32767;this.totalFrames++;if(this.offset===this.buffer.length)this.flush(false);}return true;}
  flush(partial){if(!this.offset)return;const out=this.offset===this.buffer.length?this.buffer:this.buffer.slice(0,this.offset);this.port.postMessage({type:'pcm',sequence:this.sequence++,buffer:out.buffer,frames:out.length,totalFrames:this.totalFrames,partial},[out.buffer]);this.buffer=new Int16Array(this.chunkFrames);this.offset=0;}
}
registerProcessor('roomscan-pcm-recorder',RoomScanPCMProcessor);
