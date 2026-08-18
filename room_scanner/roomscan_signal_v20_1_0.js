/*
 * Room Scanner V20.1.0 - lightweight acoustic signal processing
 * -------------------------------------------------------------------------
 * Pure JavaScript/TypedArray implementation shared by the browser app and the
 * Node test suite. The live WebXR loop never calls the FFT/deconvolution
 * functions in this file. It only schedules short sweeps and stores raw PCM.
 */
(function attachRoomScanSignal(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoomScanSignal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function roomScanSignalFactory() {
  'use strict';

  const TAU = Math.PI * 2;
  const EPS = 1e-18;

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function nextPow2(value) {
    let n = 1;
    while (n < Math.max(1, value)) n <<= 1;
    return n;
  }

  function median(values) {
    if (!values?.length) return NaN;
    const sorted = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const middle = sorted.length >> 1;
    return sorted.length & 1 ? sorted[middle] : 0.5 * (sorted[middle - 1] + sorted[middle]);
  }

  function quantile(values, probability) {
    const sorted = Array.from(values || []).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const index = clamp(probability, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const fraction = index - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  }

  function mad(values, center = median(values)) {
    return median(Array.from(values || [], value => Math.abs(value - center)));
  }

  function rms(signal, start = 0, end = signal?.length || 0) {
    if (!signal || end <= start) return 0;
    let sum = 0;
    let count = 0;
    for (let index = Math.max(0, start | 0); index < Math.min(signal.length, end | 0); index += 1) {
      const value = signal[index];
      sum += value * value;
      count += 1;
    }
    return Math.sqrt(sum / Math.max(1, count));
  }

  function removeDC(signal) {
    const output = new Float32Array(signal?.length || 0);
    if (!output.length) return output;
    let mean = 0;
    for (let index = 0; index < signal.length; index += 1) mean += signal[index];
    mean /= signal.length;
    for (let index = 0; index < signal.length; index += 1) output[index] = signal[index] - mean;
    return output;
  }

  function fadeEdges(signal, sampleRate, durationSeconds = 0.012) {
    const count = Math.min(signal.length >> 1, Math.max(1, Math.round(sampleRate * durationSeconds)));
    for (let index = 0; index < count; index += 1) {
      const weight = 0.5 - 0.5 * Math.cos(Math.PI * index / Math.max(1, count));
      signal[index] *= weight;
      signal[signal.length - 1 - index] *= weight;
    }
    return signal;
  }

  /* Iterative radix-2 complex FFT. Inverse mode applies 1/N scaling. */
  function fft(real, imaginary, inverse = false) {
    const n = real.length;
    if (imaginary.length !== n || (n & (n - 1)) !== 0) throw new Error('FFT richiede array complessi radix-2 della stessa lunghezza');
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = real[i]; real[i] = real[j]; real[j] = tr;
        const ti = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = ti;
      }
    }
    for (let length = 2; length <= n; length <<= 1) {
      const angle = (inverse ? TAU : -TAU) / length;
      const wLengthReal = Math.cos(angle);
      const wLengthImaginary = Math.sin(angle);
      for (let offset = 0; offset < n; offset += length) {
        let wr = 1;
        let wi = 0;
        const half = length >> 1;
        for (let index = 0; index < half; index += 1) {
          const even = offset + index;
          const odd = even + half;
          const or = real[odd] * wr - imaginary[odd] * wi;
          const oi = real[odd] * wi + imaginary[odd] * wr;
          const er = real[even];
          const ei = imaginary[even];
          real[even] = er + or;
          imaginary[even] = ei + oi;
          real[odd] = er - or;
          imaginary[odd] = ei - oi;
          const nextWr = wr * wLengthReal - wi * wLengthImaginary;
          wi = wr * wLengthImaginary + wi * wLengthReal;
          wr = nextWr;
        }
      }
    }
    if (inverse) {
      const scale = 1 / n;
      for (let index = 0; index < n; index += 1) {
        real[index] *= scale;
        imaginary[index] *= scale;
      }
    }
    return { real, imaginary };
  }

  function ifftReal(real, imaginary) {
    const re = Float64Array.from(real);
    const im = Float64Array.from(imaginary);
    fft(re, im, true);
    return Float32Array.from(re);
  }

  function convolve(signal, kernel) {
    const length = signal.length + kernel.length - 1;
    const nfft = nextPow2(length);
    const ar = new Float64Array(nfft);
    const ai = new Float64Array(nfft);
    const br = new Float64Array(nfft);
    const bi = new Float64Array(nfft);
    ar.set(signal);
    br.set(kernel);
    fft(ar, ai);
    fft(br, bi);
    for (let index = 0; index < nfft; index += 1) {
      const real = ar[index] * br[index] - ai[index] * bi[index];
      const imaginary = ar[index] * bi[index] + ai[index] * br[index];
      ar[index] = real;
      ai[index] = imaginary;
    }
    fft(ar, ai, true);
    return Float32Array.from(ar.subarray(0, length));
  }

  function generateESS(sampleRate = 48000, f0 = 180, f1 = 12000, durationSeconds = 0.28, amplitude = 0.55, fadeSeconds = 0.018) {
    const duration = clamp(durationSeconds, 0.08, 4);
    const startFrequency = clamp(f0, 20, sampleRate * 0.40);
    const endFrequency = clamp(f1, startFrequency * 1.02, sampleRate * 0.47);
    const length = Math.max(64, Math.round(duration * sampleRate));
    const samples = new Float32Array(length);
    const logarithmicRatio = Math.log(endFrequency / startFrequency);
    const phaseScale = TAU * startFrequency * duration / logarithmicRatio;
    for (let index = 0; index < length; index += 1) {
      const t = index / sampleRate;
      const phase = phaseScale * (Math.exp(t * logarithmicRatio / duration) - 1);
      samples[index] = amplitude * Math.sin(phase);
    }
    fadeEdges(samples, sampleRate, fadeSeconds);
    return {
      samples,
      sampleRate,
      f0: startFrequency,
      f1: endFrequency,
      duration,
      amplitude,
      fadeSeconds,
      energy: Array.from(samples).reduce((sum, value) => sum + value * value, 0),
    };
  }

  function correlationTrace(signal, reference) {
    const reversed = new Float32Array(reference.length);
    for (let index = 0; index < reference.length; index += 1) reversed[index] = reference[reference.length - 1 - index];
    return convolve(signal, reversed);
  }

  function prefixEnergy(signal) {
    const prefix = new Float64Array(signal.length + 1);
    for (let index = 0; index < signal.length; index += 1) prefix[index + 1] = prefix[index] + signal[index] * signal[index];
    return prefix;
  }

  function windowEnergy(prefix, start, length) {
    const a = clamp(Math.floor(start), 0, prefix.length - 1);
    const b = clamp(Math.floor(start + length), a, prefix.length - 1);
    return Math.max(EPS, prefix[b] - prefix[a]);
  }

  function parabolicPeak(trace, index) {
    if (index <= 0 || index >= trace.length - 1) return { index, value: trace[index], offset: 0 };
    const a = Math.abs(trace[index - 1]);
    const b = Math.abs(trace[index]);
    const c = Math.abs(trace[index + 1]);
    const denominator = a - 2 * b + c;
    const offset = Math.abs(denominator) > 1e-20 ? clamp(0.5 * (a - c) / denominator, -0.5, 0.5) : 0;
    return { index: index + offset, value: trace[index], offset };
  }

  /**
   * Detect one or more sweep onsets in continuous PCM.
   * expectedStarts are sample indices relative to the start of `signal`, based
   * on the AudioContext schedule before the unknown output/hardware latency.
   */
  function detectSweepOnsets(signal, sweep, expectedStarts, options = {}) {
    if (!signal?.length || !sweep?.length || !expectedStarts?.length) return [];
    const sampleRate = options.sampleRate || 48000;
    const minLagSamples = Math.round((options.minLagSeconds ?? -0.04) * sampleRate);
    const maxLagSamples = Math.round((options.maxLagSeconds ?? 3.0) * sampleRate);
    const trace = correlationTrace(removeDC(signal), sweep);
    const energyPrefix = prefixEnergy(signal);
    let sweepEnergy = 0;
    for (let index = 0; index < sweep.length; index += 1) sweepEnergy += sweep[index] * sweep[index];
    const results = [];
    let previousOnset = -Infinity;
    for (let eventIndex = 0; eventIndex < expectedStarts.length; eventIndex += 1) {
      const expected = expectedStarts[eventIndex];
      const searchStartOnset = Math.max(previousOnset + Math.round(0.035 * sampleRate), expected + minLagSamples);
      const searchEndOnset = Math.min(signal.length - sweep.length, expected + maxLagSamples);
      const traceStart = Math.max(sweep.length - 1, Math.floor(searchStartOnset + sweep.length - 1));
      const traceEnd = Math.min(trace.length - 2, Math.ceil(searchEndOnset + sweep.length - 1));
      if (traceEnd <= traceStart) {
        results.push({ expectedStart: expected, found: false, score: 0, eventIndex, reason: 'empty-search-window' });
        continue;
      }

      // The strongest matched-filter peak is not always the direct path: a
      // hard nearby wall can exceed the phone speaker-to-microphone coupling.
      // Estimate a robust correlation floor and select the earliest local peak
      // that is both significant and normalized. This keeps an unknown common
      // hardware delay while avoiding a later reflection as the zero-time.
      let maximumMagnitude = 0;
      const sampledMagnitudes = [];
      const sampleStride = Math.max(1, Math.floor((traceEnd - traceStart + 1) / 2048));
      for (let index = traceStart; index <= traceEnd; index += 1) {
        const magnitude = Math.abs(trace[index]);
        if (magnitude > maximumMagnitude) maximumMagnitude = magnitude;
        if ((index - traceStart) % sampleStride === 0) sampledMagnitudes.push(magnitude);
      }
      const floorCenter = median(sampledMagnitudes);
      const floorScale = Math.max(EPS, 1.4826 * (mad(sampledMagnitudes, floorCenter) || 0));
      const absoluteThreshold = floorCenter + (options.correlationFloorSigma ?? 7.0) * floorScale;
      const relativeThreshold = maximumMagnitude * (options.earliestPeakFraction ?? 0.10);
      const threshold = Math.max(absoluteThreshold, relativeThreshold);

      let selected = null;
      let strongest = null;
      for (let index = traceStart + 1; index < traceEnd; index += 1) {
        const magnitude = Math.abs(trace[index]);
        if (!strongest || magnitude > strongest.magnitude) strongest = { index, magnitude };
        if (magnitude < threshold || magnitude < Math.abs(trace[index - 1]) || magnitude < Math.abs(trace[index + 1])) continue;
        const refined = parabolicPeak(trace, index);
        const onset = refined.index - (sweep.length - 1);
        const localEnergy = windowEnergy(energyPrefix, Math.round(onset), sweep.length);
        const score = Math.abs(refined.value) / Math.sqrt(Math.max(EPS, sweepEnergy * localEnergy));
        if (score < (options.minimumScore ?? 0.08)) continue;
        selected = { refined, onset, score, magnitude };
        break;
      }
      if (!selected && strongest) {
        const refined = parabolicPeak(trace, strongest.index);
        const onset = refined.index - (sweep.length - 1);
        const localEnergy = windowEnergy(energyPrefix, Math.round(onset), sweep.length);
        const score = Math.abs(refined.value) / Math.sqrt(Math.max(EPS, sweepEnergy * localEnergy));
        selected = { refined, onset, score, magnitude: strongest.magnitude, fallbackStrongest: true };
      }
      if (!selected) {
        results.push({ expectedStart: expected, found: false, score: 0, eventIndex, reason: 'no-correlation-peak' });
        continue;
      }
      const lagSamples = selected.onset - expected;
      const found = selected.score >= (options.minimumScore ?? 0.08);
      results.push({
        eventIndex,
        expectedStart: expected,
        onsetSample: selected.onset,
        onsetSampleRounded: Math.round(selected.onset),
        lagSamples,
        lagSeconds: lagSamples / sampleRate,
        correlation: selected.refined.value,
        score: selected.score,
        found,
        selection: selected.fallbackStrongest ? 'strongest-fallback' : 'earliest-significant',
        correlationThreshold: threshold,
        maximumCorrelationMagnitude: maximumMagnitude,
        correlationFloor: floorCenter,
      });
      if (found) previousOnset = selected.onset;
    }
    return results;
  }

  function spectrumPower(signal, nfft = nextPow2(signal.length)) {
    const real = new Float64Array(nfft);
    const imaginary = new Float64Array(nfft);
    real.set(signal.subarray ? signal.subarray(0, Math.min(signal.length, nfft)) : signal.slice(0, nfft));
    fft(real, imaginary);
    const output = new Float64Array((nfft >> 1) + 1);
    for (let index = 0; index < output.length; index += 1) output[index] = real[index] * real[index] + imaginary[index] * imaginary[index];
    return output;
  }

  function bandWeight(frequency, band) {
    const low = Math.max(18, band?.fLow ?? 20);
    const high = Math.max(low * 1.05, band?.fHigh ?? Infinity);
    const lowOuter = low / Math.pow(2, 1 / 6);
    const highOuter = high * Math.pow(2, 1 / 6);
    if (frequency <= lowOuter || frequency >= highOuter) return 0;
    if (frequency < low) return 0.5 - 0.5 * Math.cos(Math.PI * (frequency - lowOuter) / Math.max(EPS, low - lowOuter));
    if (frequency > high) return 0.5 + 0.5 * Math.cos(Math.PI * (frequency - high) / Math.max(EPS, highOuter - high));
    return 1;
  }

  function estimateUsefulBand(signal, noise, sampleRate, options = {}) {
    const nfft = nextPow2(Math.max(4096, Math.min(options.maximumNfft || 32768, Math.max(signal.length, noise.length))));
    const signalPower = spectrumPower(signal, nfft);
    const noisePower = spectrumPower(noise, nfft);
    const thresholdDb = options.minimumSnrDb ?? 6;
    const minimumFrequency = options.minimumFrequency ?? 80;
    const maximumFrequency = Math.min(options.maximumFrequency ?? sampleRate * 0.45, sampleRate * 0.47);
    const firstBin = Math.max(1, Math.ceil(minimumFrequency * nfft / sampleRate));
    const lastBin = Math.min(signalPower.length - 1, Math.floor(maximumFrequency * nfft / sampleRate));
    let bestStart = firstBin;
    let bestEnd = firstBin;
    let currentStart = -1;
    const snr = new Float32Array(signalPower.length);
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
      snr[bin] = 10 * Math.log10((signalPower[bin] + EPS) / (noisePower[bin] + EPS));
      if (snr[bin] >= thresholdDb) {
        if (currentStart < 0) currentStart = bin;
      } else if (currentStart >= 0) {
        if (bin - 1 - currentStart > bestEnd - bestStart) {
          bestStart = currentStart;
          bestEnd = bin - 1;
        }
        currentStart = -1;
      }
    }
    if (currentStart >= 0 && lastBin - currentStart > bestEnd - bestStart) {
      bestStart = currentStart;
      bestEnd = lastBin;
    }
    const sampleSnr = [];
    const stride = Math.max(1, Math.floor((bestEnd - bestStart + 1) / 512));
    for (let bin = bestStart; bin <= bestEnd; bin += stride) sampleSnr.push(snr[bin]);
    return {
      fLow: bestStart * sampleRate / nfft,
      fHigh: bestEnd * sampleRate / nfft,
      snrMedianDb: median(sampleSnr),
      snrP10Db: quantile(sampleSnr, 0.1),
      nfft,
    };
  }

  /** Noise-regularised frequency-domain inverse (Kirkeby-style). */
  function kirkebyDeconvolve(recorded, excitation, noise, sampleRate, band = null, options = {}) {
    const nfft = nextPow2(recorded.length + excitation.length);
    const yr = new Float64Array(nfft);
    const yi = new Float64Array(nfft);
    const xr = new Float64Array(nfft);
    const xi = new Float64Array(nfft);
    yr.set(recorded);
    xr.set(excitation);
    fft(yr, yi);
    fft(xr, xi);
    const noiseSpectrum = spectrumPower(noise?.length ? noise : new Float32Array(256), nfft);
    let maximumExcitationPower = EPS;
    for (let index = 0; index < nfft; index += 1) maximumExcitationPower = Math.max(maximumExcitationPower, xr[index] * xr[index] + xi[index] * xi[index]);
    const floor = maximumExcitationPower * Math.pow(10, (options.floorDb ?? -48) / 10);
    const noiseFactor = options.noiseFactor ?? 2.2;
    const maximumBoost = Math.pow(10, (options.maximumBoostDb ?? 24) / 20) / Math.sqrt(maximumExcitationPower);
    const hr = new Float64Array(nfft);
    const hi = new Float64Array(nfft);
    const half = nfft >> 1;
    for (let index = 0; index < nfft; index += 1) {
      const positiveBin = index <= half ? index : nfft - index;
      const frequency = positiveBin * sampleRate / nfft;
      const weight = band ? bandWeight(frequency, band) : (frequency <= sampleRate * 0.48 ? 1 : 0);
      const excitationPower = xr[index] * xr[index] + xi[index] * xi[index];
      const noisePower = noiseSpectrum[Math.min(noiseSpectrum.length - 1, positiveBin)] * Math.max(1, excitation.length);
      const beta = floor + noiseFactor * noisePower + (1 - weight) * maximumExcitationPower * 1e3;
      let gr = xr[index] / (excitationPower + beta);
      let gi = -xi[index] / (excitationPower + beta);
      const magnitude = Math.hypot(gr, gi);
      if (magnitude > maximumBoost) {
        gr *= maximumBoost / magnitude;
        gi *= maximumBoost / magnitude;
      }
      hr[index] = (yr[index] * gr - yi[index] * gi) * weight;
      hi[index] = (yr[index] * gi + yi[index] * gr) * weight;
    }
    return { real: hr, imaginary: hi, nfft, ir: ifftReal(hr, hi) };
  }

  function findPeak(signal, start = 0, end = signal?.length || 0) {
    let index = Math.max(0, start | 0);
    let value = 0;
    for (let cursor = index; cursor < Math.min(signal.length, end | 0); cursor += 1) {
      const magnitude = Math.abs(signal[cursor]);
      if (magnitude > value) {
        value = magnitude;
        index = cursor;
      }
    }
    return { index, value };
  }

  function trimRIR(ir, sampleRate, options = {}) {
    let direct;
    if (Number.isFinite(options.expectedDirectIndex)) {
      const expected = Math.round(options.expectedDirectIndex);
      const before = Math.round((options.directWindowBeforeSeconds ?? 0.004) * sampleRate);
      const after = Math.round((options.directWindowAfterSeconds ?? 0.014) * sampleRate);
      const searchStart = Math.max(1, expected - before);
      const searchEnd = Math.min(ir.length - 1, expected + after + 1);
      let maximum = 0;
      const magnitudes = [];
      for (let index = searchStart; index < searchEnd; index += 1) {
        const magnitude = Math.abs(ir[index]);
        maximum = Math.max(maximum, magnitude);
        magnitudes.push(magnitude);
      }
      const center = median(magnitudes);
      const scale = Math.max(EPS, 1.4826 * (mad(magnitudes, center) || 0));
      const threshold = Math.max(
        center + (options.directFloorSigma ?? 6) * scale,
        maximum * (options.directEarliestFraction ?? 0.06),
      );
      direct = null;
      for (let index = searchStart + 1; index < searchEnd - 1; index += 1) {
        const magnitude = Math.abs(ir[index]);
        if (magnitude < threshold || magnitude < Math.abs(ir[index - 1]) || magnitude < Math.abs(ir[index + 1])) continue;
        direct = { index, value: magnitude };
        break;
      }
      if (!direct) direct = findPeak(ir, searchStart, searchEnd);
    } else {
      const directSearchSeconds = options.directSearchSeconds ?? 0.45;
      direct = findPeak(ir, 0, Math.min(ir.length, Math.round(sampleRate * directSearchSeconds)));
    }
    const preSeconds = options.preSeconds ?? 0.012;
    const tailSeconds = options.tailSeconds ?? 2.8;
    const start = Math.max(0, direct.index - Math.round(preSeconds * sampleRate));
    const length = Math.min(ir.length - start, Math.round(tailSeconds * sampleRate));
    const output = Float32Array.from(ir.subarray(start, start + length));
    fadeEdges(output, sampleRate, Math.min(0.04, tailSeconds * 0.05));
    return {
      ir: output,
      startIndex: start,
      directIndex: direct.index - start,
      rawDirectIndex: direct.index,
      directPeak: direct.value,
      expectedDirectIndex: Number.isFinite(options.expectedDirectIndex) ? options.expectedDirectIndex : null,
    };
  }

  function peakToTailDb(ir, directIndex = 0) {
    if (!ir?.length) return -Infinity;
    const peak = findPeak(ir, Math.max(0, directIndex - 32), Math.min(ir.length, directIndex + 256)).value;
    const tailStart = Math.max(0, Math.floor(ir.length * 0.82));
    const tailRms = rms(ir, tailStart, ir.length);
    return 20 * Math.log10((peak + EPS) / (tailRms + EPS));
  }

  function biquad(signal, type, cutoff, sampleRate, quality = Math.SQRT1_2) {
    const omega = TAU * Math.min(cutoff, sampleRate * 0.475) / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const alpha = sine / (2 * quality);
    let b0;
    let b1;
    let b2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosine;
    const a2 = 1 - alpha;
    if (type === 'lowpass') {
      b0 = (1 - cosine) / 2;
      b1 = 1 - cosine;
      b2 = b0;
    } else {
      b0 = (1 + cosine) / 2;
      b1 = -(1 + cosine);
      b2 = b0;
    }
    b0 /= a0; b1 /= a0; b2 /= a0;
    const na1 = a1 / a0;
    const na2 = a2 / a0;
    const output = new Float32Array(signal.length);
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let index = 0; index < signal.length; index += 1) {
      const input = signal[index];
      const value = b0 * input + b1 * x1 + b2 * x2 - na1 * y1 - na2 * y2;
      output[index] = value;
      x2 = x1; x1 = input; y2 = y1; y1 = value;
    }
    return output;
  }

  function octaveFilter(signal, sampleRate, centerFrequency) {
    const low = centerFrequency / Math.SQRT2;
    const high = centerFrequency * Math.SQRT2;
    if (low < 18 || high > sampleRate * 0.49) return null;
    let output = biquad(signal, 'highpass', low, sampleRate);
    output = biquad(output, 'highpass', low, sampleRate);
    output = biquad(output, 'lowpass', high, sampleRate);
    output = biquad(output, 'lowpass', high, sampleRate);
    return output;
  }

  function linearRegression(points) {
    if (points.length < 4) return null;
    let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
    for (const point of points) {
      sx += point.x;
      sy += point.y;
      sxx += point.x * point.x;
      sxy += point.x * point.y;
    }
    const n = points.length;
    const denominator = n * sxx - sx * sx;
    if (Math.abs(denominator) < 1e-18) return null;
    const slope = (n * sxy - sx * sy) / denominator;
    const intercept = (sy - slope * sx) / n;
    const meanY = sy / n;
    let total = 0;
    let residual = 0;
    for (const point of points) {
      total += (point.y - meanY) ** 2;
      residual += (point.y - (slope * point.x + intercept)) ** 2;
    }
    return { slope, intercept, r2: total > EPS ? clamp(1 - residual / total) : 0 };
  }

  function schroederEDC(signal, noisePower = null) {
    const output = new Float32Array(signal.length);
    const tailStart = Math.floor(signal.length * 0.82);
    const estimatedNoise = noisePower ?? Math.max(EPS, rms(signal, tailStart, signal.length) ** 2);
    let sum = 0;
    for (let index = signal.length - 1; index >= 0; index -= 1) {
      sum += Math.max(0, signal[index] * signal[index] - estimatedNoise);
      output[index] = sum;
    }
    const reference = Math.max(EPS, output[0]);
    for (let index = 0; index < output.length; index += 1) output[index] = 10 * Math.log10(Math.max(EPS, output[index]) / reference);
    return output;
  }

  function decayFit(edcDb, sampleRate, upperDb, lowerDb) {
    const points = [];
    for (let index = 0; index < edcDb.length; index += 1) {
      const value = edcDb[index];
      if (value <= upperDb && value >= lowerDb) points.push({ x: index / sampleRate, y: value });
    }
    const fit = linearRegression(points);
    if (!fit || fit.slope >= -0.5 || fit.r2 < 0.35) return null;
    return { ...fit, rt60: -60 / fit.slope, points: points.length };
  }

  function decayMetrics(ir, sampleRate, centerFrequency = null, directIndex = 0) {
    const filtered = centerFrequency ? octaveFilter(ir, sampleRate, centerFrequency) : Float32Array.from(ir);
    if (!filtered?.length) return null;
    const start = clamp(directIndex, 0, filtered.length - 1);
    const analysis = filtered.subarray(start);
    const edcDb = schroederEDC(analysis);
    const t30 = decayFit(edcDb, sampleRate, -5, -35);
    const t20 = decayFit(edcDb, sampleRate, -5, -25);
    const edt = decayFit(edcDb, sampleRate, 0, -10);
    const chosen = t30 || t20 || edt;
    if (!chosen || chosen.rt60 < 0.05 || chosen.rt60 > 15) return null;
    const early50 = Math.min(analysis.length, Math.round(sampleRate * 0.05));
    const early80 = Math.min(analysis.length, Math.round(sampleRate * 0.08));
    let totalEnergy = 0;
    let energy50 = 0;
    let energy80 = 0;
    for (let index = 0; index < analysis.length; index += 1) {
      const energy = analysis[index] * analysis[index];
      totalEnergy += energy;
      if (index < early50) energy50 += energy;
      if (index < early80) energy80 += energy;
    }
    return {
      rt60: chosen.rt60,
      r2: chosen.r2,
      method: t30 ? 'T30' : t20 ? 'T20' : 'EDT',
      t30: t30?.rt60 ?? null,
      t20: t20?.rt60 ?? null,
      edt: edt?.rt60 ?? null,
      c50: 10 * Math.log10((energy50 + EPS) / (Math.max(EPS, totalEnergy - energy50))),
      c80: 10 * Math.log10((energy80 + EPS) / (Math.max(EPS, totalEnergy - energy80))),
      edcDb,
    };
  }

  function localEnergy(signal, center, halfWidth) {
    let sum = 0;
    const start = Math.max(0, center - halfWidth);
    const end = Math.min(signal.length, center + halfWidth + 1);
    for (let index = start; index < end; index += 1) sum += signal[index] * signal[index];
    return sum;
  }

  function detectEchoPeaks(ir, sampleRate, directIndex, options = {}) {
    if (!ir?.length || !Number.isFinite(directIndex)) return [];
    const minimumDelayMs = options.minimumDelayMs ?? 2.5;
    const maximumDelayMs = options.maximumDelayMs ?? 140;
    const minimumSnrDb = options.minimumSnrDb ?? 5.5;
    const maximumPeaks = options.maximumPeaks ?? 14;
    const separationSamples = Math.max(2, Math.round((options.minimumSeparationMs ?? 0.9) * 0.001 * sampleRate));
    const halfWidth = Math.max(2, Math.round((options.energyWindowMs ?? 0.7) * 0.001 * sampleRate));
    const start = Math.max(directIndex + 2, directIndex + Math.round(minimumDelayMs * 0.001 * sampleRate));
    const end = Math.min(ir.length - 2, directIndex + Math.round(maximumDelayMs * 0.001 * sampleRate));
    const tailStart = Math.max(0, Math.floor(ir.length * 0.82));
    const noisePower = Math.max(EPS, rms(ir, tailStart, ir.length) ** 2);
    const directEnergy = Math.max(EPS, localEnergy(ir, directIndex, halfWidth));
    const candidates = [];
    for (let index = start; index <= end; index += 1) {
      const magnitude = Math.abs(ir[index]);
      if (magnitude < Math.abs(ir[index - 1]) || magnitude < Math.abs(ir[index + 1])) continue;
      const energy = localEnergy(ir, index, halfWidth);
      const noiseEnergy = noisePower * (2 * halfWidth + 1);
      const correctedEnergy = Math.max(0, energy - noiseEnergy);
      const snrDb = 10 * Math.log10((correctedEnergy + EPS) / (noiseEnergy + EPS));
      if (snrDb < minimumSnrDb) continue;
      candidates.push({
        sample: index,
        delaySamples: index - directIndex,
        delaySeconds: (index - directIndex) / sampleRate,
        delayMs: 1000 * (index - directIndex) / sampleRate,
        energy: correctedEnergy,
        energyRatioDirect: correctedEnergy / directEnergy,
        snrDb,
        score: snrDb + 3 * Math.log10(1 + correctedEnergy / directEnergy),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = [];
    for (const candidate of candidates) {
      if (selected.some(existing => Math.abs(existing.sample - candidate.sample) < separationSamples)) continue;
      selected.push(candidate);
      if (selected.length >= maximumPeaks) break;
    }
    selected.sort((a, b) => a.sample - b.sample);
    return selected;
  }

  function extractSweepRIR(recording, sweep, onsetSample, sampleRate, options = {}) {
    const preSeconds = options.preSeconds ?? 0.04;
    const tailSeconds = options.tailSeconds ?? 2.5;
    const preSamples = Math.round(preSeconds * sampleRate);
    const start = Math.max(0, Math.round(onsetSample) - preSamples);
    const required = sweep.length + Math.round(tailSeconds * sampleRate) + preSamples;
    const end = Math.min(recording.length, start + required);
    const segment = removeDC(recording.subarray(start, end));
    const noiseStart = Math.max(0, Math.round(onsetSample) - Math.round((options.noiseSeconds ?? 0.25) * sampleRate));
    const noiseEnd = Math.max(noiseStart + 16, Math.round(onsetSample) - Math.round(0.015 * sampleRate));
    const noise = removeDC(recording.subarray(noiseStart, Math.min(recording.length, noiseEnd)));
    const band = options.band || { fLow: options.fLow ?? 100, fHigh: options.fHigh ?? Math.min(16000, sampleRate * 0.45) };
    const deconvolved = kirkebyDeconvolve(segment, sweep, noise, sampleRate, band, options.kirkeby || {});
    const trimmed = trimRIR(deconvolved.ir, sampleRate, {
      expectedDirectIndex: preSamples,
      directWindowBeforeSeconds: options.directWindowBeforeSeconds ?? 0.006,
      directWindowAfterSeconds: options.directWindowAfterSeconds ?? 0.014,
      directSearchSeconds: Math.min(0.55, preSeconds + 0.28),
      tailSeconds,
    });
    return {
      segment,
      noise,
      ir: trimmed.ir,
      directIndex: trimmed.directIndex,
      rawDirectIndex: trimmed.rawDirectIndex,
      startSample: start,
      onsetSample,
      peakToTailDb: peakToTailDb(trimmed.ir, trimmed.directIndex),
      band,
      deconvolutionNfft: deconvolved.nfft,
    };
  }

  function fitClockMap(samples, options = {}) {
    const points = Array.from(samples || []).filter(sample => Number.isFinite(sample.contextTime) && Number.isFinite(sample.performanceTime));
    if (points.length < 2) return null;
    let active = points;
    let fit = null;
    for (let pass = 0; pass < 3; pass += 1) {
      const mapped = active.map(point => ({ x: point.contextTime, y: point.performanceTime }));
      fit = linearRegression(mapped);
      if (!fit) return null;
      const residuals = active.map(point => point.performanceTime - (fit.slope * point.contextTime + fit.intercept));
      const center = median(residuals);
      const scale = Math.max(0.08, 1.4826 * (mad(residuals, center) || 0));
      const threshold = Math.max(options.minimumResidualMs ?? 1.5, (options.outlierSigma ?? 3.5) * scale);
      const next = active.filter((point, index) => Math.abs(residuals[index] - center) <= threshold);
      if (next.length === active.length || next.length < 2) break;
      active = next;
    }
    if (!fit) return null;
    const residuals = active.map(point => point.performanceTime - (fit.slope * point.contextTime + fit.intercept));
    const residualMadMs = 1.4826 * (mad(residuals) || 0);
    return {
      performanceTimeFromContext: contextTime => fit.slope * contextTime + fit.intercept,
      contextTimeFromPerformance: performanceTime => (performanceTime - fit.intercept) / fit.slope,
      slopeMsPerSecond: fit.slope,
      interceptMs: fit.intercept,
      residualMadMs,
      residualP95Ms: quantile(residuals.map(Math.abs), 0.95),
      sampleCount: active.length,
      r2: fit.r2,
      serializable: {
        slopeMsPerSecond: fit.slope,
        interceptMs: fit.intercept,
        residualMadMs,
        sampleCount: active.length,
        r2: fit.r2,
      },
    };
  }

  function quaternionNormalize(q) {
    const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return q.map(value => value / length);
  }

  function quaternionSlerp(a, b, amount) {
    let qb = b.slice();
    let cosine = a[0] * qb[0] + a[1] * qb[1] + a[2] * qb[2] + a[3] * qb[3];
    if (cosine < 0) {
      qb = qb.map(value => -value);
      cosine = -cosine;
    }
    if (cosine > 0.9995) return quaternionNormalize(a.map((value, index) => value + amount * (qb[index] - value)));
    const angle = Math.acos(clamp(cosine, -1, 1));
    const sine = Math.sin(angle);
    const wa = Math.sin((1 - amount) * angle) / sine;
    const wb = Math.sin(amount * angle) / sine;
    return a.map((value, index) => value * wa + qb[index] * wb);
  }

  function interpolatePose(path, performanceTime) {
    if (!path?.length) return null;
    if (performanceTime <= path[0].t) return { ...path[0], p: path[0].p.slice(), q: path[0].q?.slice() || null };
    if (performanceTime >= path[path.length - 1].t) {
      const last = path[path.length - 1];
      return { ...last, p: last.p.slice(), q: last.q?.slice() || null };
    }
    let low = 0;
    let high = path.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (path[middle].t < performanceTime) low = middle;
      else high = middle;
    }
    const before = path[low];
    const after = path[high];
    const fraction = clamp((performanceTime - before.t) / Math.max(EPS, after.t - before.t));
    const p = before.p.map((value, index) => value + fraction * (after.p[index] - value));
    const q = before.q && after.q ? quaternionSlerp(before.q, after.q, fraction) : before.q?.slice() || after.q?.slice() || null;
    return {
      t: performanceTime,
      p,
      q,
      confidence: Math.min(before.confidence ?? 1, after.confidence ?? 1),
      interpolated: true,
    };
  }

  function floatToInt16(signal) {
    const output = new Int16Array(signal.length);
    for (let index = 0; index < signal.length; index += 1) output[index] = Math.round(clamp(signal[index], -1, 1) * 32767);
    return output;
  }

  function int16ToFloat(signal) {
    const output = new Float32Array(signal.length);
    for (let index = 0; index < signal.length; index += 1) output[index] = signal[index] / 32768;
    return output;
  }

  function concatenateFloat32(blocks, totalLength = null) {
    const length = totalLength ?? blocks.reduce((sum, block) => sum + block.length, 0);
    const output = new Float32Array(length);
    let offset = 0;
    for (const block of blocks) {
      if (offset >= length) break;
      const count = Math.min(block.length, length - offset);
      output.set(block.subarray(0, count), offset);
      offset += count;
    }
    return output;
  }

  return {
    clamp,
    nextPow2,
    median,
    quantile,
    mad,
    rms,
    removeDC,
    fadeEdges,
    fft,
    ifftReal,
    convolve,
    generateESS,
    correlationTrace,
    detectSweepOnsets,
    spectrumPower,
    estimateUsefulBand,
    kirkebyDeconvolve,
    findPeak,
    trimRIR,
    peakToTailDb,
    biquad,
    octaveFilter,
    schroederEDC,
    decayMetrics,
    detectEchoPeaks,
    extractSweepRIR,
    fitClockMap,
    interpolatePose,
    quaternionSlerp,
    floatToInt16,
    int16ToFloat,
    concatenateFloat32,
  };
});
