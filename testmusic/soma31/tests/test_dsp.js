'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const source=html.match(/<script id="engine-source" type="text\/plain">([\s\S]*?)<\/script>/)[1];
let C;const rate=2000;
const ctx={sampleRate:rate,Float32Array,Number,Object,Array,Math,console,
 AudioWorkletProcessor:class {constructor(){this.port={postMessage(){},onmessage:null}}},
 registerProcessor:(name,P)=>{assert.equal(name,'soma-ecology');C=P;}};
vm.createContext(ctx);vm.runInContext(source,ctx);
function init(quality=1){const p=new C({});p.message({type:'seed',value:748114});p.message({type:'mode',value:'meditate'});
 p.message({type:'body',value:'A'});p.message({type:'controls',hr:75,var:20,q:quality});p.message({type:'start'});return p;}
function render(p,seconds,{mic=false,hz=196,enabled=true,amount=.85}={}){
 p.message({type:'ambientHarmonyControl',enabled,amount});p.message({type:'micConnected',enabled:mic});
 const L=new Float32Array(128),R=new Float32Array(128),frames=Math.ceil(seconds*rate/128);
 let peak=0,invalid=0,sum=0;
 for(let i=0;i<frames;i++){
  if(mic)p.message({type:'ambientTones',tones:[{hz:typeof hz==='function'?hz(p):hz,confidence:.97}]});
  p.process([],[[L,R]]);
  for(let k=0;k<128;k++){
   const a=L[k],b=R[k];if(!Number.isFinite(a)||!Number.isFinite(b))invalid++;
   peak=Math.max(peak,Math.abs(a),Math.abs(b));sum+=a*a+b*b;
  }
 }
 return {peak,invalid,rms:Math.sqrt(sum/(frames*256))};
}
const harmonicHz=p=>440*Math.pow(2,(p.root+(p.currentChord?.keyShift||0)+(p.currentChord?.r||0)+24-69)/12);
const reference=init();const r0=render(reference,68);assert.equal(r0.invalid,0);assert(r0.peak<1);
assert.equal(reference.organisms.filter(p=>p.symLevel>.01).length,0,'no mic -> no sympathetics');
const disabled=init();render(disabled,68,{mic:true,enabled:false,hz:harmonicHz});assert.equal(disabled.organisms.filter(p=>p.symLevel>.01).length,0,'off A/B');
const enhanced=init();const r1=render(enhanced,68,{mic:true,hz:harmonicHz});
assert.equal(r1.invalid,0);assert(r1.peak<1);
let active=enhanced.organisms.filter(p=>p.symLevel>.04);
assert(active.length>=1,`tone must drive at least one PPG-born organism, got ${active.length}`);
assert(active.length<=2,'no more than two sympathetic organisms');
assert(active.every(p=>p.symHz>=70 && p.symHz<=1350),'resonance must be within audible biological register');
assert.equal(enhanced.noteCount,reference.noteCount,'note-count and composition must be independent of mic');
assert.deepEqual(enhanced.theme.map(p=>p.step),reference.theme.map(p=>p.step),'PPG phrase unchanged');
const before=active.map(p=>({p,level:p.symLevel}));
render(enhanced,5,{mic:false});assert(enhanced.organisms.every(p=>p.symTarget===0),'stop mic -> no target');
assert(enhanced.organisms.every(p=>p.symLevel<.03),'stop mic -> fade');
const dissonance=init();render(dissonance,68,{mic:true,hz:p=>440*Math.pow(2,(p.root+(p.currentChord?.keyShift||0)+(p.currentChord?.r||0)+1+24-69)/12)});
assert(dissonance.organisms.every(p=>p.symLevel<.03),'pitch one semitone above each chord root must remain incompatible');
const gated=init(.2);render(gated,28,{mic:true});assert.equal(gated.signature,false);
assert.equal(gated.noteCount,0,'microphone must not start the music without PPG');
assert.equal(gated.organisms.length,0,'microphone must not create organisms');
console.log('PASS: DSP no mic, A/B off, two PPG sympathetic voices max, harmonic-compatible frequency tracking, shared composition, decay, incompatibility, quality gate');
console.log(JSON.stringify({reference:r0,enhanced:r1,active:active.map(p=>({id:p.id,hz:p.symHz,level:p.symLevel})),notes:reference.noteCount},null,2));
