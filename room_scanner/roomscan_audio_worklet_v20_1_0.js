/*
 * Room Scanner V20.1.0 - continuous microphone capture AudioWorklet
 * ------------------------------------------------------------------
 * The processor forwards mono PCM chunks with their absolute AudioContext
 * frame index. It performs no FFT, correlation or RIR processing. Keeping the
 * real-time callback bounded is essential on mobile browsers.
 */
class RoomScanPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions || {};
    this.chunkFrames = Math.max(512, Math.min(16384, processorOptions.chunkFrames || 4096));
    this.buffer = new Float32Array(this.chunkFrames);
    this.offset = 0;
    this.bufferStartFrame = currentFrame;
    this.enabled = true;
    this.meterAccumulator = 0;
    this.meterPeak = 0;
    this.meterSamples = 0;
    this.lastMeterFrame = currentFrame;
    this.port.onmessage = event => {
      const command = event.data?.command;
      if (command === 'pause') this.enabled = false;
      if (command === 'resume') this.enabled = true;
      if (command === 'flush') this.flush();
      if (command === 'reset') {
        this.offset = 0;
        this.bufferStartFrame = currentFrame;
      }
    };
  }

  flush() {
    if (!this.offset) return;
    const payload = this.buffer.slice(0, this.offset);
    this.port.postMessage({
      type: 'pcm',
      startFrame: this.bufferStartFrame,
      sampleRate,
      samples: payload,
    }, [payload.buffer]);
    this.offset = 0;
    this.bufferStartFrame = currentFrame;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    // Always write silence to the output. The node is connected through a zero
    // gain stage solely to keep the worklet alive; microphone audio is never
    // monitored through the loudspeaker.
    for (const channel of output || []) channel.fill(0);
    if (!this.enabled) return true;
    const channelCount = input?.length || 0;
    const frameCount = channelCount ? input[0].length : 128;
    if (!channelCount) {
      // Preserve the absolute frame timeline even if the browser produces a
      // temporary input underrun. Zeros are informative for later diagnostics.
      for (let frame = 0; frame < frameCount; frame += 1) this.pushSample(0, currentFrame + frame);
      return true;
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sample = 0;
      for (let channel = 0; channel < channelCount; channel += 1) sample += input[channel][frame] || 0;
      sample /= channelCount;
      this.pushSample(sample, currentFrame + frame);
    }
    if (currentFrame - this.lastMeterFrame >= sampleRate * 0.20) {
      const rms = Math.sqrt(this.meterAccumulator / Math.max(1, this.meterSamples));
      this.port.postMessage({ type: 'meter', rms, peak: this.meterPeak, frame: currentFrame });
      this.meterAccumulator = 0;
      this.meterPeak = 0;
      this.meterSamples = 0;
      this.lastMeterFrame = currentFrame;
    }
    return true;
  }

  pushSample(sample, absoluteFrame) {
    if (this.offset === 0) this.bufferStartFrame = absoluteFrame;
    this.buffer[this.offset] = sample;
    this.offset += 1;
    this.meterAccumulator += sample * sample;
    this.meterPeak = Math.max(this.meterPeak, Math.abs(sample));
    this.meterSamples += 1;
    if (this.offset >= this.buffer.length) this.flush();
  }
}

registerProcessor('roomscan-pcm-capture-v20-1', RoomScanPcmCaptureProcessor);
