'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const source=html.match(/<script id="engine-source" type="text\/plain">([\s\S]*?)<\/script>/)[1];
let C;const rate=1000;
const ctx={sampleRate:rate,Float32Array,Number,Object,Array,Math,console,
 AudioWorkletProcessor:class{constructor(){this.port={postMessage(){},onmessage:null}}},registerProcessor:(name,P)=>{C=P;}};
vm.createContext(ctx);vm.runInContext(source,ctx);
function init(body='A',q=.97,mode='activate'){
 const p=new C({});p.message({type:'mode',value:mode});p.message({type:'body',value:body});
 p.message({type:'controls',hr:78,var:body==='A'?20:125,q});p.message({type:'start'});return p;
}
function runUntil(p,time){const L=new Float32Array(128),R=new Float32Array(128);let sum=0,max=0;
 while(p.time<time-.0001){p.process([],[[L,R]]);for(let i=0;i<L.length;i++){
  assert(Number.isFinite(L[i])&&Number.isFinite(R[i]));sum+=L[i]*L[i]+R[i]*R[i];max=Math.max(max,Math.abs(L[i]),Math.abs(R[i]));}}
 assert(max<1);return {sum,max};
}
const p=init('B');
let first=runUntil(p,21);assert(first.sum>0,'direct pulse is audible during acquisition');
assert(!p.onset.ready&&!p.signature&&!p.scoreStarted&&p.noteCount===0&&p.organisms.length===0);
runUntil(p,36);assert(!p.onset.ready&&!p.signature&&p.noteCount===0);
runUntil(p,41);assert(p.onset.ready&&p.onset.readyAt>=38,'baseline gate cannot start too early');
assert(p.onset.baseline.bpm>70&&p.onset.baseline.bpm<90);
assert(p.onset.phase==='emerging');assert(p.noteCount===0 || p.onset.ready);
assert(p.onset.musicMix(p.onset.readyAt)===0);
runUntil(p,47);
assert(p.musicBeatSec>0&&Math.abs(60/p.musicBeatSec-p.onset.baseline.bpm)<6,'initial pulse must remain close to baseline at onset');
runUntil(p,67);assert(p.signature&&p.noteCount>0&&p.scoreStarted&&p.onset.musicMix(p.time)>.98);
assert(Math.abs(60/p.musicBeatSec-60/p.mem.ibi12.value)<12,'musical pulse must track measured state, without hard tempo jumps');
runUntil(p,85);assert(p.onset.phase==='active');
const startupB=p.onset.baseline.bpm;
const targetNew=p.onset.tempoTarget(p.onset.readyAt+270,p.onset.baseline.ibi,'activate',{confidence:0,score:0});
const targetSleep=p.onset.tempoTarget(p.onset.readyAt+270,p.onset.baseline.ibi,'sleep',{confidence:0,score:0});
assert(60/targetNew>startupB+3, 'activation should explore gently increasing musical tempo');
assert(60/targetSleep<startupB-3, 'sleep should explore gently decreasing musical tempo');
const adverse=p.onset.tempoTarget(p.onset.readyAt+270,p.onset.baseline.ibi,'activate',{confidence:.90,score:-.7,delta:5});
assert(60/adverse<60/targetNew, 'adverse response must attenuate exploration');
const poor=init('A',.35);runUntil(poor,80);assert(!poor.onset.ready&&!poor.signature&&poor.noteCount===0&&poor.organisms.length===0);
const stale=init();runUntil(stale,21);
stale.message({type:'csv',events:Array.from({length:21},(_,i)=>({t:i*.8,ibi:.8,amp:.7,width:.22,rise:.1,q:.96}))});
runUntil(stale,65);assert(!stale.onset.ready&&stale.noteCount===0,'disconnected or insufficient CSV must remain silent');
const csv=init();csv.message({type:'csv',events:Array.from({length:108},(_,i)=>({t:i*.85,ibi:.85,amp:.70+.03*Math.sin(i*.2),width:.22,rise:.11,q:.96}))});
runUntil(csv,68);assert(csv.onset.ready&&csv.signature&&csv.noteCount>0&&csv.onset.baseline.source==='CSV replay');
assert(Math.abs(csv.onset.baseline.bpm-60/.85)<2);
const a=init('A'),b=init('B');runUntil(a,50);runUntil(b,50);
assert(a.onset.ready&&b.onset.ready&&Math.abs(a.onset.initialMobility-b.onset.initialMobility)>.02,'temporal individuality affects onset');
console.log('PASS SOMA31: audible direct pulse without music, reliable baseline gate, delayed fade, BPM matching, goal-directed slow tempo, adverse feedback, rejection, dropout, CSV provenance, individual onset, no nonfinite audio');
console.log(JSON.stringify({baselineStart:p.onset.readyAt,baselineBpm:startupB,initialMobility:p.onset.initialMobility,finalMusicBpm:60/p.musicBeatSec,targetActivation:60/targetNew,targetSleep:60/targetSleep,profiles:[a.onset.initialMobility,b.onset.initialMobility]},null,2));
