'use strict';
const assert=require('node:assert/strict');
const {Tracker}=require('../ambient_harmony.js');
const fs=48000,N=16384,step=fs/N,len=N/2;
function bins(tones=[],floor=-97){const spectrum=new Float32Array(len).fill(floor);for(const [hz,db] of tones){
 const j=hz/step;
 for(let k=Math.max(1,Math.floor(j)-9);k<=Math.min(len-2,Math.ceil(j)+9);k++){
  const peak=db-10*Math.pow(k-j,2);
  spectrum[k]=Math.max(spectrum[k],peak);
 }
 }return spectrum;}
function run(tracker,sequence){let out=[];for(const [i,tones,rms] of sequence){out=tracker.feed(bins(tones),fs,rms,i*.11)}return out;}
const ticks=(from,to,tones,rms=.02)=>Array.from({length:to-from},(_,i)=>[from+i,tones,rms]);
const t=new Tracker();assert.equal(run(t,ticks(0,45,[],0.0003)).length,0,'silence must not lock');
let out=run(t,ticks(45,70,[[196,-27]]));assert(out.length,'sustained G3 must lock');
assert(Math.abs(out[0].hz-196)<3,`interpolation inaccurate: ${out[0].hz}`);
assert(out[0].confidence>.2,'locked tone must be confident');
out=run(t,ticks(70,72,[[510,-25]]));assert(!out.some(q=>Math.abs(q.hz-510)<6),'2 frames cannot establish new stable pitch');
out=run(t,ticks(72,102,[],.0001));assert.equal(out.length,0,'stale tone must disappear');
const impulses=new Tracker();out=run(impulses,Array.from({length:100},(_,i)=>[i,i%11===0?[[440,-20]]:[],.016]));
assert.equal(out.length,0,'isolated tonal clicks must never lock');
const noise=new Tracker();out=run(noise,ticks(0,45,[],.025));assert.equal(out.length,0,'flat spectrum cannot lock');
const mixture=new Tracker();out=run(mixture,ticks(0,38,[[196,-25],[293.66,-30]]));assert(out.length>=2,'stable two-tone mixture must retain independent tones');
console.log('PASS: silence, accurate sustained tones, multiple tones, click rejection, noise, stale decay');
