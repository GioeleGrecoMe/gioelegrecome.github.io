const assert=require('node:assert/strict');
const {Tracker}=require('../ambient_harmony.js');
const frame=require('./real_fft_fixture.json');
const tracker=new Tracker();let tones=[];
for(let i=0;i<30;i++)tones=tracker.feed(frame.spectrum,frame.fs,frame.rms,i*.11);
assert(tones.length>=1,'realistic FFT: stable peak should lock');
assert(Math.abs(tones[0].hz-196)<2,'realistic FFT: pitch should stay within 2 Hz');
console.log('PASS: 196 Hz sinusoid + low broadband noise, windowed 16384-point FFT; detected',tones[0]);
