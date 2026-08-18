import {AUDIO} from './config_v20_2_0.js';
import {clamp,uid} from './math_v20_2_0.js';

export function makeESS(sampleRate,{durationS=AUDIO.sweepDurationS,startHz=AUDIO.sweepStartHz,endHz=AUDIO.sweepEndHz,level=AUDIO.level}={}){
  const n=Math.max(32,Math.round(durationS*sampleRate)),out=new Float32Array(n),T=n/sampleRate,L=Math.log(endHz/startHz),K=2*Math.PI*startHz*T/L;for(let i=0;i<n;i++){const t=i/sampleRate,phase=K*(Math.exp(t*L/T)-1),fade=Math.min(1,i/(sampleRate*.008),(n-1-i)/(sampleRate*.012));out[i]=Math.sin(phase)*level*clamp(fade,0,1);}return {samples:out,sampleRate,durationS:n/sampleRate,startHz,endHz};
}

/**
 * Audio capture persists each PCM chunk immediately. No base64 conversion and
 * no end-of-session concatenation occur in the WebXR teardown path.
 */
export class AppendOnlyAudioCapture {
  constructor({repository,diagnostics,sessionId,profile}){this.repo=repository;this.diag=diagnostics;this.sessionId=sessionId;this.profile=profile;this.context=null;this.stream=null;this.source=null;this.node=null;this.silentGain=null;this.running=false;this.chunkCount=0;this.totalFrames=0;this.stopWaiter=null;this.settings={};this.recordingStartContextTime=0;}
  async start(){
    const constraints={audio:{channelCount:{ideal:1},sampleRate:{ideal:AUDIO.preferredSampleRate},echoCancellation:{ideal:false},noiseSuppression:{ideal:false},autoGainControl:{ideal:false},latency:{ideal:0.02}},video:false};
    this.stream=await navigator.mediaDevices.getUserMedia(constraints);const track=this.stream.getAudioTracks()[0];this.settings={requested:constraints.audio,settings:track.getSettings?.()||{},constraints:track.getConstraints?.()||{},capabilities:track.getCapabilities?.()||{}};
    const AC=globalThis.AudioContext||globalThis.webkitAudioContext;this.context=new AC({latencyHint:'interactive',sampleRate:AUDIO.preferredSampleRate});await this.context.audioWorklet.addModule(new URL('../workers/audio_worklet_v20_2_0.js',import.meta.url));this.source=this.context.createMediaStreamSource(this.stream);this.node=new AudioWorkletNode(this.context,'roomscan-pcm-recorder',{numberOfInputs:1,numberOfOutputs:1,channelCount:1,processorOptions:{chunkFrames:this.profile.audioChunkFrames}});this.silentGain=this.context.createGain();this.silentGain.gain.value=0;this.source.connect(this.node).connect(this.silentGain).connect(this.context.destination);this.node.port.onmessage=e=>this._onMessage(e.data);await this.context.resume();this.recordingStartContextTime=this.context.currentTime;this.running=true;
    await this.repo.enqueueRecord(this.sessionId,'audio-settings',{sampleRate:this.context.sampleRate,baseLatency:this.context.baseLatency??null,outputLatency:this.context.outputLatency??null,recordingStartContextTime:this.recordingStartContextTime,startClock:this.clockSample(),...this.settings},{key:`${this.sessionId}/audio/settings`});await this.diag.log('audio-started',{sampleRate:this.context.sampleRate,settings:this.settings.settings});return this;
  }
  _onMessage(message){
    if(message?.type==='pcm'){const blob=new Blob([message.buffer?new Int16Array(message.buffer):new Int16Array(0)],{type:'application/octet-stream'});const key=`${this.sessionId}/audio/pcm-${String(message.sequence).padStart(7,'0')}.pcm16`;this.repo.enqueueBlob(this.sessionId,'audio-pcm',blob,{sequence:message.sequence,frames:message.frames,startFrame:message.totalFrames-message.frames,endFrame:message.totalFrames,totalFrames:message.totalFrames,partial:message.partial,sampleRate:this.context?.sampleRate||this.settings.settings?.sampleRate||AUDIO.preferredSampleRate,channels:1,encoding:'s16le'},key).catch(e=>this.diag.error('audio-chunk-write-failed',e,{sequence:message.sequence}));this.chunkCount++;this.totalFrames=message.totalFrames;}
    if(message?.type==='stopped')this.stopWaiter?.(message);
  }
  clockSample(){const ctx=this.context;if(!ctx)return null;let output=null;try{output=ctx.getOutputTimestamp?.()||null;}catch{}return {performanceNow:performance.now(),audioCurrentTime:ctx.currentTime,outputContextTime:output?.contextTime??null,outputPerformanceTime:output?.performanceTime??null,sampleRate:ctx.sampleRate};}
  async flush(){if(!this.node)return;this.node.port.postMessage({type:'flush'});await new Promise(r=>setTimeout(r,80));}
  async stop({timeoutMs=700}={}){
    if(!this.running)return;this.running=false;await new Promise(resolve=>{let done=false;this.stopWaiter=()=>{if(!done){done=true;resolve();}};this.node?.port.postMessage({type:'stop'});setTimeout(()=>{if(!done){done=true;resolve();}},timeoutMs);});
    try{this.source?.disconnect();this.node?.disconnect();this.silentGain?.disconnect();}catch{}for(const t of this.stream?.getTracks?.()||[])t.stop();try{await this.context?.close();}catch{}await this.diag.log('audio-stopped',{chunks:this.chunkCount,totalFrames:this.totalFrames});this.node=this.source=this.silentGain=this.stream=this.context=null;
  }
}

export class RapidChirpScheduler {
  constructor({audioCapture,repository,diagnostics,sessionId,segmentId,onChirp}){this.audio=audioCapture;this.repo=repository;this.diag=diagnostics;this.sessionId=sessionId;this.segmentId=segmentId||'segment-0';this.onChirp=onChirp;this.enabled=true;this.lastChirpPerf=-Infinity;this.nextInterval=AUDIO.minIntervalS;this.activeUntil=0;this.sequence=0;this.sweep=null;}
  prepare(){const sr=this.audio.context?.sampleRate||AUDIO.preferredSampleRate;this.sweep=makeESS(sr);}
  setEnabled(value){this.enabled=!!value;}
  async maybeSchedule({pose,linearSpeed=0,angularSpeed=0,quality=1,force=false}){
    if(!this.enabled||!this.audio.context||!this.audio.running)return null;const now=performance.now(),elapsed=(now-this.lastChirpPerf)/1000;if(!force&&(elapsed<this.nextInterval||this.audio.context.currentTime<this.activeUntil))return null;if(!force&&(linearSpeed>AUDIO.maxLinearSpeedMps||angularSpeed>AUDIO.maxAngularSpeedRadps))return null;
    if(!this.sweep)this.prepare();const ctx=this.audio.context,startAt=ctx.currentTime+.055,buf=ctx.createBuffer(1,this.sweep.samples.length,ctx.sampleRate);buf.copyToChannel(this.sweep.samples,0);const src=ctx.createBufferSource(),gain=ctx.createGain();gain.gain.value=1;src.buffer=buf;src.connect(gain).connect(ctx.destination);src.start(startAt);this.activeUntil=startAt+this.sweep.durationS+AUDIO.tailDurationS;this.lastChirpPerf=now;this.nextInterval=AUDIO.minIntervalS+Math.random()*(AUDIO.maxIntervalS-AUDIO.minIntervalS);
    const id=uid('chirp'),clock=this.audio.clockSample(),record={id,sequence:this.sequence++,sessionId:this.sessionId,segmentId:this.segmentId,scheduledContextTime:startAt,scheduledPerformanceTime:clock?.outputPerformanceTime!=null?clock.outputPerformanceTime+(startAt-clock.outputContextTime)*1000:now+(startAt-ctx.currentTime)*1000,clock,pose,linearSpeed,angularSpeed,captureQuality:quality,sweep:{durationS:this.sweep.durationS,startHz:this.sweep.startHz,endHz:this.sweep.endHz,level:AUDIO.level},tailDurationS:AUDIO.tailDurationS,expectedMicFrame:Math.max(0,Math.round((startAt-(this.audio.recordingStartContextTime||0))*ctx.sampleRate)),time:Date.now()};
    await this.repo.enqueueRecord(this.sessionId,'chirp',record,{key:`${this.sessionId}/chirp/${String(record.sequence).padStart(6,'0')}`});await this.diag.log('chirp-scheduled',{id,sequence:record.sequence,linearSpeed,angularSpeed,quality});this.onChirp?.(record);return record;
  }
  stop(){this.enabled=false;this.activeUntil=Infinity;}
}
