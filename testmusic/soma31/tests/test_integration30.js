'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const source=html.match(/<script id="engine-source" type="text\/plain">([\s\S]*?)<\/script>/)[1];
let C;const rate=1000;
const ctx={sampleRate:rate,Float32Array,Number,Object,Array,Math,console,
 AudioWorkletProcessor:class{constructor(){this.port={postMessage(){},onmessage:null}}},
 registerProcessor:(name,P)=>{C=P}};
vm.createContext(ctx);vm.runInContext(source,ctx);
function init(mode,body){const p=new C({});p.message({type:'seed',value:432102});p.message({type:'mode',value:mode});p.message({type:'body',value:body});p.message({type:'controls',hr:77,var:body==='B'?115:18,q:.97});p.message({type:'start'});return p;}
function run(p,seconds){let peak=0;const L=new Float32Array(128),R=new Float32Array(128),events=[];
 const raw=p.addVoice.bind(p);p.addVoice=(a)=>{
  if(a.kind==='harmony'||a.kind==='bass'){
   const c=p.currentChord,key=p.root+(c.keyShift||0),pc=n=>((n%12)+12)%12;
   const allowed=c.tones.map(x=>pc(key+c.r+x));
   assert(allowed.includes(pc(a.pitch)),`out-of-chord ${a.kind} pitch ${a.pitch} chord ${c.name}`);
  }
  if(a.kind==='harmony')events.push({pitch:a.pitch,time:p.time});
  return raw(a);
 };
 for(let i=0;i<Math.ceil(seconds*rate/128);i++){
  p.process([],[[L,R]]);
  for(let j=0;j<128;j++){assert(Number.isFinite(L[j])&&Number.isFinite(R[j]));peak=Math.max(peak,Math.abs(L[j]),Math.abs(R[j]));}
 }
 assert(peak<1,`clipping at peak ${peak}`);
 return {peak,events:events.length};
}
const results=[];
for(const mode of ['meditate','wake','activate','sleep'])for(const body of ['A','B']){
 const p=init(mode,body);const stats=run(p,85);assert(p.signature);assert(p.noteCount>0);
 assert(p.harmony.base!==null&&p.harmony.current.length===4);
 assert(p.harmony.lastVoicing&&p.harmony.lastVoicing.length===4);
 results.push({mode,body,root:p.root,progression:p.harmony.current.map(c=>c.name),notes:p.noteCount,peak:stats.peak,events:stats.events,theme:p.theme.map(v=>v.step)});
}
for(const mode of ['meditate','wake','activate','sleep']){
 const x=results.filter(r=>r.mode===mode);
 assert(x[0].root!==x[1].root || JSON.stringify(x[0].progression)!==JSON.stringify(x[1].progression),`indistinguishable personalized harmony ${mode}`);
}
const p=init('activate','B');run(p,225);assert(p.harmony.cycle>=2);assert(p.harmony.modulations>=1,`expected tonal navigation at ${p.time}, got ${p.harmony.cycle} cycles`);assert(p.tiedTones>0,'overlapping common tones should be sustained');
const before=p.harmony.modulations;
p.message({type:'harmonicNavigationControl',enabled:false});run(p,6);assert.equal(p.harmony.modulations,before);
const low=init('meditate','B');low.message({type:'controls',hr:77,var:115,q:.25});run(low,35);assert.equal(low.noteCount,0);assert.equal(low.harmony.base,null);
console.log('PASS: 4 modes x 2 PPG distinct harmonic outputs, four-part voicing, all chord tones correct, 225s modulation, A/B, poor PPG gate, no NaN/clipping');
console.log(JSON.stringify(results,null,2));
