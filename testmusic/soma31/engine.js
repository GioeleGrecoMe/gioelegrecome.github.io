/* SOMA 28 — Cells into Music. PPG ecology + measured spectral finishing downstream. */
'use strict';
/*@@SOMA_ADAPTIVE_LIBRARY@@*/
const TAU = Math.PI * 2;
const clamp = (x,a=0,b=1)=> Math.max(a,Math.min(b,x));
const mix = (a,b,t)=>a+(b-a)*t;
const midiHz=n=>440*Math.pow(2,(n-69)/12);
const SIN=new Float32Array(4096);
for(let i=0;i<SIN.length;i++) SIN[i]=Math.sin(i*TAU/SIN.length);
function sine(phase){let p=phase*4096,idx=p|0,f=p-idx;return SIN[idx&4095]*(1-f)+SIN[(idx+1)&4095]*f;}
function smooth(x){x=clamp(x);return x*x*(3-2*x);}
class RNG{
 constructor(seed=12345){this.s=(seed>>>0)||1;}
 next(){let s=this.s;s^=s<<13;s^=s>>>17;s^=s<<5;this.s=s>>>0;return this.s/4294967296;}
 signed(){return this.next()*2-1;}
}
class Memory{
 constructor(tau){this.tau=tau;this.value=0;this.ready=false;}
 feed(v,dt,q){if(!(q>=.56)||!Number.isFinite(v))return; if(!this.ready){this.value=v;this.ready=true;return;}this.value+=clamp((1-Math.exp(-dt/this.tau))*q,0,1)*(v-this.value);}
}
const SCALES={meditate:[0,2,3,5,7,9,10],sleep:[0,2,3,5,7,9,10],wake:[0,2,4,5,7,9,11],activate:[0,2,4,5,7,9,11]};
const MATERIALS=['Membrana','Minerale','Fluido','Vapore','Filamento'];
const RATIOS=[[1,1.997,3.009],[1,2.414,3.76],[1,1.49,2.014],[1,2.87,4.3],[1,2.05,4.8]];
const SETTINGS={meditate:{energy:.35,target:4,breathe:9,hold:26},sleep:{energy:.19,target:3,breathe:12,hold:31},wake:{energy:.52,target:5,breathe:6.8,hold:22},activate:{energy:.76,target:6,breathe:4.5,hold:17}};
// Chord grammar: tonal functions are planned at bar boundaries, never picked per PPG impulse.
const HARMONIC_PATHS={
 meditate:[{name:'i(add9)',r:0,tones:[0,3,7,14]}, {name:'VImaj7',r:8,tones:[0,4,7,11]}, {name:'iv(add9)',r:5,tones:[0,3,7,14]}, {name:'bVII(sus2)',r:10,tones:[0,2,5,7]}],
 wake:[{name:'Imaj9',r:0,tones:[0,4,7,11,14]}, {name:'IVmaj9',r:5,tones:[0,4,7,11,14]}, {name:'vi7',r:9,tones:[0,3,7,10]}, {name:'Vsus4',r:7,tones:[0,5,7,10]}],
 activate:[{name:'i(add9)',r:0,tones:[0,3,7,14]}, {name:'bVImaj7',r:8,tones:[0,4,7,11]}, {name:'bVII(add9)',r:10,tones:[0,4,7,14]}, {name:'Vsus4',r:7,tones:[0,5,7,10]}],
 sleep:[{name:'i(add9)',r:0,tones:[0,3,7,14]}, {name:'iv(add9)',r:5,tones:[0,3,7,14]}, {name:'bVImaj7',r:8,tones:[0,4,7,11]}, {name:'i(add9)/5',r:0,tones:[0,3,7,14]}]
};
const FORM_NAMES=['Esposizione','Risposta','Metamorfosi','Ritorno'];
const VOICE_CAP=34;
class SomaEcology extends AudioWorkletProcessor{
 constructor(opts){
  super();this.fs=sampleRate;this.seed=324817;this.rng=new RNG(this.seed);this.running=false;this.mode='meditate';this.body='A';this.source='sim';this.csv=[];this.csvIndex=0;
  this.time=0;this.nextBeat=.64;this.beat=0;this.lastBeat=null;this.lastIbi=.84;this.latest={ibi:.84,amp:.62,width:.25,rise:.12,q:0};
  this.mem={ibi2:new Memory(2),ibi12:new Memory(12),ibi90:new Memory(90),ibi900:new Memory(900),amp:new Memory(24),width:new Memory(30),complex:new Memory(18)};
  this.quality=.96;this.simQuality=.96;this.hr=72;this.simVariability=.5;this.bioComplex=0;this.bioNovelty=0;this.targetPop=0;
  this.bioCells=[];this.signature=false;this.root=41;this.harmonic=0;this.nextHarmony=24;this.prevHarmony=-1;
  this.organisms=[];this.nextId=1;this.births=0;this.deaths=0;this.controlClock=0;this.reportClock=0;this.changes=0;this.direct=0;this.directPhase=0;
  this.resource=.75;this.hash=0;this.phaseCoherence=0;this.lastBirth=-30;this.mutePulse=false;this.profileAge=0;this.lastReliable=-1e9;
  this.noteVotes=new Float32Array(7);this.parity=0;
  this.voices=[];this.retiringVoices=[];this.noteCount=0;this.noteEvents=[];this.musicTick=0;this.nextMusicTick=0;
  this.scoreStarted=false;this.currentChord=null;this.currentChordIndex=0;this.keyRoot=41;
  this.bar=0;this.form=0;this.interaction='solo';this.leaderId=0;this.theme=[];
  this.previousVoicing=null;this.pitchChanges=0;this.tiedTones=0;this.lastPhrase=-1;this.qualityHold=0;this.musicBeatSec=.8;
  const lengths=[1493,1699,1867,2063,2311,2503].map(x=>Math.round(x*this.fs/48000));
  this.combs=lengths.map(n=>new Float32Array(n));this.ptrs=lengths.map(()=>0);this.damp=new Float32Array(6);
  this.sideBuffer=new Float32Array(Math.round(this.fs*.019)+1);this.sideIndex=0;this.sideLow=0;
  // Environment enters as a SECONDARY, provenance-labelled layer. Never creates PPG identity.
  this.env={rms:0,ambient:0,centroid:0.3,flatness:0.3,onset:0,voiceLike:0,confidence:0,scene:'off'};
  this.envSmooth={ambient:0,brightness:.3,voice:0,weatherCloud:0,weatherWind:0,weatherRain:0,weatherNight:0};
  this.weatherTarget={cloud:0,wind:0,rain:0,night:0};this.weatherReady=false;this.timeReady=false;
  this.acousticImpulse=0;this.micGrains=[];this.micGrainCount=0;this.envMix=1;this.weatherMix=1;
  this.micLinked=false;this.fastMicFloor=.002;this.fastMicPrevious=0;this.fastMicLast=-20;
  // Ambient spectral field: passive analysis in UI, optional sympathetic coupling only.
  this.ambientTones=[];this.ambientLastAt=-1e9;this.ambientEnabled=true;this.ambientAmount=.55;
  this.symUpdateClock=0;
  this.onset=new SomaOnset.Gate();this.pulseResponse=new SomaAdaptive.PulseWindow();this.feedback=new SomaAdaptive.Controller(this.mode);this.harmony=new SomaHarmony.Navigator(this.mode);this.responseClock=0;
  this.lastStats={rms:0,peak:0,side:0};this.metricSq=0;this.metricPk=0;this.metricLR=0;this.metricLL=0;this.metricRR=0;this.metricN=0;
  this.port.onmessage=e=>this.message(e.data||{});
 }
 message(d){
  if(d.type==='start'){this.reset();this.running=true;}
  if(d.type==='stop'){this.running=false;}
  if(d.type==='mode'){if(SETTINGS[d.value]){if(this.mode!==d.value){this.mode=d.value;this.feedback.reset(this.mode);const wasHarmonyOn=this.harmony.enabled;this.harmony.reset(this.mode);this.harmony.enabled=wasHarmonyOn;this.harmony.initialise(SomaHarmony.profile(this.bioCells));this.root=this.harmony.root;this.currentChord=null;this.previousVoicing=null;}this.nextHarmony=this.time+6;this.onset.goalChange(this.time);if(this.onset.ready){this.feedback.reference=this.pulseResponse.stats(this.time,40);this.feedback.epochAt=this.time;}}}
  if(d.type==='body'){this.body=d.value==='B'?'B':'A';this.reset();this.running=true;}
  if(d.type==='seed'){this.seed=(d.value>>>0)||1;this.reset();this.running=true;}
  if(d.type==='controls'){
   if(Number.isFinite(d.hr))this.hr=clamp(d.hr,48,185);
   if(Number.isFinite(d.var))this.simVariability=clamp(d.var/100,.0,1.5);
   if(Number.isFinite(d.q))this.simQuality=clamp(d.q);
   this.mutePulse=!!d.mutePulse;
  }
  if(d.type==='csv'){
   let events=Array.isArray(d.events)?d.events:[];
   this.csv=events.filter(b=>Number.isFinite(b.t)&&b.t>=0&&Number.isFinite(b.ibi)).map(b=>({t:b.t,ibi:clamp(b.ibi,.33,1.8),amp:clamp(b.amp||.62,.1,1.5),width:clamp(b.width||.2,.06,.72),rise:clamp(b.rise||.12,.02,.35),q:clamp(b.q??.9)})).sort((a,b)=>a.t-b.t);
   this.source='csv';this.reset();this.running=true;
  }
  if(d.type==='sim'){this.source='sim';this.reset();this.running=true;}
  if(d.type==='resurface'){this.direct=.24;this.mutePulse=false;}
  if(d.type==='time'&&Number.isFinite(d.night)){this.weatherTarget.night=clamp(d.night);if(!this.timeReady){this.envSmooth.weatherNight=this.weatherTarget.night;this.timeReady=true;}}
  if(d.type==='micConnected'){
   this.micLinked=!!d.enabled;this.fastMicPrevious=0;
   if(!this.micLinked){this.ambientTones=[];this.ambientLastAt=-1e9;this.clearSympathetic();}
  }
  if(d.type==='ambientHarmonyControl'){
   this.ambientEnabled=!!d.enabled;
   if(Number.isFinite(d.amount))this.ambientAmount=clamp(d.amount);
   if(!this.ambientEnabled)this.clearSympathetic();
  }
  if(d.type==='ambientTones'&&this.micLinked){
   this.ambientTones=(Array.isArray(d.tones)?d.tones:[]).slice(0,3)
    .filter(x=>Number.isFinite(x.hz)&&x.hz>=95&&x.hz<=1250&&Number.isFinite(x.confidence))
    .map(x=>({hz:x.hz,confidence:clamp(x.confidence)}));
   this.ambientLastAt=this.time;
  }
  if(d.type==='environmentMix'){this.envMix=clamp(d.value??1);}
  if(d.type==='weatherMix'){this.weatherMix=clamp(d.value??1);}
  if(d.type==='environment'){
   const a=d.features||{};
   for(const k of ['rms','ambient','centroid','flatness','onset','voiceLike','confidence']){
    if(Number.isFinite(a[k]))this.env[k]=clamp(a[k]);
   }
   if(typeof a.scene==='string')this.env.scene=a.scene.slice(0,36);
  }
  if(d.type==='weather'){
   const w=d.features||{};
   for(const k of ['cloud','wind','rain','night'])if(Number.isFinite(w[k]))this.weatherTarget[k]=clamp(w[k]);
   if(!this.weatherReady||d.instant===true){for(const k of ['cloud','wind','rain','night']){
     this.envSmooth['weather'+k[0].toUpperCase()+k.slice(1)]=this.weatherTarget[k];
   }this.weatherReady=true;}
  }
  if(d.type==='acousticEvent'){
   const v=clamp(d.strength||0);
   this.acousticImpulse=Math.max(this.acousticImpulse,.85*v*this.envMix);
   // An acoustic transient can excite PPG-descended resonators, not create fictitious organisms.
   if(this.signature && this.time-this.lastReliable<3.5){
    for(let k=0;k<this.organisms.length;k++){
     const a=this.organisms[k]; if(k%3===0)a.recentPulse=clamp(a.recentPulse+v*.23);
    }
   }
  }
  if(d.type==='micGrain'&&d.samples&&d.consent===true&&this.signature&&this.envMix>0){
   const a=d.samples instanceof Float32Array?d.samples:new Float32Array(d.samples);
   if(a.length>=256&&a.length<=12000){
    const strength=clamp(d.strength||.5,.1,1);
    const offspring=this.organisms.find(o=>o.role!==0)||this.organisms[0];
    const pos=offspring?offspring.pan:.5;
    const offset=Math.floor(this.rng.next()*.23*a.length);
    const rate=(.32+.38*this.rng.next())*(offspring?(.8+.3*offspring.spec):1);
    this.micGrains.push({samples:a,idx:offset,rate,low:0,pan:clamp(pos),gain:.10*strength*this.envMix});
    if(this.micGrains.length>5)this.micGrains.shift();
    this.micGrainCount++;
   }
  }
  if(d.type==='adaptiveControl'){this.feedback.setEnabled(d.enabled);if(!d.enabled){this.feedback.level=0;this.feedback.evaluations=[];}}
  if(d.type==='harmonicNavigationControl'){this.harmony.enabled=!!d.enabled;this.harmony.current=[];this.currentChord=null;this.previousVoicing=null;}
  if(d.type==='userFeedback'&&(d.value==='comfortable'||d.value==='tooIntense'))this.feedback.userFeedback(d.value,this.time);
  if(d.type==='snapshot')this.report(true);
 }
 reset(){
  this.time=0;this.nextBeat=.64;this.beat=0;this.csvIndex=0;this.lastBeat=null;this.lastIbi=60/this.hr;this.bioCells=[];this.signature=false;
  this.rng=new RNG(this.seed);this.mem={ibi2:new Memory(2),ibi12:new Memory(12),ibi90:new Memory(90),ibi900:new Memory(900),amp:new Memory(24),width:new Memory(30),complex:new Memory(18)};
  this.quality=0;this.bioComplex=0;this.bioNovelty=0;this.targetPop=0;this.organisms=[];this.nextId=1;this.births=0;this.deaths=0;this.hash=0;this.nextHarmony=24;this.harmonic=0;this.prevHarmony=-1;
  this.controlClock=0;this.reportClock=0;this.profileAge=0;this.lastBirth=-30;this.lastReliable=-1e9;this.phaseCoherence=0;this.resource=.75;this.noteVotes.fill(0);
  this.onset.reset();this.direct=0;this.directStrength=1;this.directPhase=0;this.sideBuffer.fill(0);this.sideIndex=0;this.sideLow=0;for(const b of this.combs)b.fill(0);this.ptrs.fill(0);this.damp.fill(0);
  this.metricSq=0;this.metricPk=0;this.metricLR=0;this.metricLL=0;this.metricRR=0;this.metricN=0;
  this.voices=[];this.retiringVoices=[];this.noteCount=0;this.noteEvents=[];this.musicTick=0;this.nextMusicTick=0;
  this.scoreStarted=false;this.currentChord=null;this.currentChordIndex=0;this.bar=0;this.form=0;
  this.interaction='solo';this.leaderId=0;this.theme=[];this.previousVoicing=null;this.pitchChanges=0;this.tiedTones=0;this.lastPhrase=-1;
  this.musicBeatSec=.8;
  this.ambientTones=[];this.ambientLastAt=-1e9;this.symUpdateClock=0;
  const harmonicOn=this.harmony.enabled;this.pulseResponse.reset();this.feedback.reset(this.mode);this.harmony.reset(this.mode);this.harmony.enabled=harmonicOn;this.responseClock=0;
 }
 simulateBeat(){
  const n=this.beat;const mean=60/this.hr;
  // same mean HR, distinct temporal and morphological structure (not claims about real people).
  const base=this.body==='A'?.009*Math.sin(n*.42)+.005*Math.sin(n*.17):.093*Math.sin(n*.83)+.054*Math.sin(n*1.73)+.016*Math.sin(n*.087);
  const ibi=clamp(mean+base*this.simVariability*1.4,.35,1.65);
  const amp=this.body==='A'?.72+.055*Math.sin(n*.22):.64+.23*Math.sin(n*.71)+.10*Math.sin(n*1.53);
  const width=this.body==='A'?.22+.015*Math.sin(n*.25):.22+.045*Math.sin(n*.63+.7);
  this.acceptPulse({t:this.time,ibi,amp,width,rise:.11+.025*Math.sin(n*.24),q:this.simQuality});
  this.nextBeat=this.time+ibi;
 }
 acceptPulse(b){
  this.beat++;
  const q=clamp(b.q??0),ibi=clamp(b.ibi,.32,1.85),amp=clamp(b.amp,.08,1.6),width=clamp(b.width,.05,.8);
  this.quality=q;this.latest={ibi,amp,width,rise:b.rise??.1,q};
  if(q<.58){this.direct=0;this.pulseResponse.rejected++;return;}
  if(!this.pulseResponse.add(this.time,ibi,q,amp,width)){this.direct=0;return;}
  this.lastReliable=this.time;this.profileAge=this.time;
  const old=this.mem.ibi12.ready?this.mem.ibi12.value:ibi;
  const oldAmp=this.mem.amp.ready?this.mem.amp.value:amp;
  const oldWidth=this.mem.width.ready?this.mem.width.value:width;
  const timeNovelty=clamp(Math.abs(ibi-old)/Math.max(.08,old)*3.0);
  const shapeNovelty=clamp(.95*Math.abs(amp-oldAmp)+2.3*Math.abs(width-oldWidth));
  const combined=clamp(timeNovelty*.65+shapeNovelty*.35);
  this.bioNovelty=combined;
  for(const p of this.organisms){p.recentPulse=clamp((p.recentPulse||0)+.12*(.45+combined));}
  this.mem.ibi2.feed(ibi,ibi,q);this.mem.ibi12.feed(ibi,ibi,q);this.mem.ibi90.feed(ibi,ibi,q);this.mem.ibi900.feed(ibi,ibi,q);
  this.mem.amp.feed(amp,ibi,q);this.mem.width.feed(width,ibi,q);this.mem.complex.feed(combined,ibi,q);
  this.bioComplex=this.mem.complex.value;
  this.bioCells.push({ibi,amp,width,rise:b.rise??.1,q});if(this.bioCells.length>16)this.bioCells.shift();
  this.hash=(Math.imul(this.hash^Math.round(ibi*10000),1664525)+Math.round(amp*1000)+Math.round(width*1000))>>>0;
  // During initial acquisition only the real or replayed pulse is audible.
  // No biological identity / organism / score is committed until a stable
  // personal baseline has been obtained from sufficient clean measurements.
  const directFade=this.onset.ready?1-smooth((this.time-this.onset.readyAt-8)/43):1;
  // Physiological pulse timing AND morphology are heard during acquisition.
  this.directStrength=clamp(.64+.32*amp+.11*(.27-width),.60,1.12);
  this.direct=this.mutePulse?0:Math.max(this.direct,.29*directFade*this.directStrength);
  if(this.direct>.0001)this.directPhase=0;
  if(!this.onset.ready)return;
  const settings=SETTINGS[this.mode];
  const desired=clamp(Math.round(settings.target+this.bioComplex*8),2,12);
  this.targetPop=desired;
  const lowPopulation=this.organisms.filter(a=>!a.dying).length<desired;
  const minGap=clamp(3.3-this.bioComplex*3,1.2,3.3);
  if(lowPopulation&&this.time-this.lastBirth>minGap)this.born(false);
 }
 activateIdentity(){
  const dna=SomaHarmony.profile(this.bioCells);
  if(!dna||!this.onset.baseline)return false;
  this.harmony.initialise(dna);this.root=this.harmony.root;this.signature=true;
  this.musicBeatSec=this.onset.baseline.ibi;
  this.nextMusicTick=this.time+3;this.nextHarmony=this.time+12;
  this.feedback.reference=this.pulseResponse.stats(this.time,40);
  this.feedback.epochAt=this.time;this.feedback.lastEvaluation=this.time;
  this.feedback.evaluations=[];this.feedback.decision='osservazione';
  this.feedback.reason='Baseline acquisita: risposta valutabile solo dopo l’inizio della musica';
  this.born(true);
  return true;
 }
 born(founder=false){
  if(this.quality<.58||this.organisms.length>=15||this.resource<.09)return;
  const settings=SETTINGS[this.mode];
  // Fitness tournament: propagation favours energetic, audible, spectrally distinct lineages.
  let parent=null;
  if(!founder&&this.organisms.length){
   const score=p=>p.energy*.48+clamp(p.amp/.18)*.23+clamp((p.life-p.age)/Math.max(1,p.life))*.19+.1*(1-p.hardness);
   for(let k=0;k<Math.min(3,this.organisms.length);k++){
    const c=this.organisms[Math.floor(this.rng.next()*this.organisms.length)];
    if(!parent||score(c)>score(parent))parent=c;
   }
  }
  const cell=this.bioCells[this.bioCells.length-1]||{ibi:.82,amp:.65,width:.21,rise:.12};
  let n=this.nextId++,role=n===1?0:(n%5===0?1:2); // 0 bass, 1 body, 2 moving matter
  let material=parent?(parent.material+(Math.abs(Math.round((cell.amp-.6)*9+(cell.ibi-this.lastIbi)*23))+1))%5:
   (Math.abs(Math.round(cell.amp*6+cell.width*13+cell.ibi*9))%5);
  const stem=Math.round(cell.ibi*1000+cell.amp*100+cell.width*1000),variant=(stem%7+7)%7;
  let pitchIndex=parent?(parent.pitchIndex + (variant%3)-1 + 7)%7:variant;
  if(role===0)pitchIndex=0;
  let hardness=clamp((parent?parent.hardness*.72:.21)+.22*this.bioComplex+.16*(cell.amp-.6)+.07*this.rng.signed(),.02,.90);
  const life=role===0?mix(65,95,this.rng.next()):mix(22,54,this.rng.next())*(1.0-.18*this.bioComplex);
  let p={id:n,parent:parent?.id||0,beat:this.beat,age:0,life,material,role,pitchIndex,
   hardness,friction:clamp(.04+.44*this.bioComplex+.12*Math.abs(cell.width-.2)),
   body:clamp(.4+.5*cell.amp),damping:clamp(.15+.65*cell.width),
   amp:0,env:0,energy:mix(.5,.8,cell.amp),gene:stem,phase:this.rng.next()*TAU,
   omega:TAU/(settings.breathe*(.65+.7*this.rng.next())),freq:0,targetHz:0,
   pan:clamp(parent?parent.pan+.22*this.rng.signed():.18+.65*this.rng.next(),.06,.94),
   phaseAudio:[this.rng.next(),this.rng.next(),this.rng.next()],noise:0,
   dying:false,fade:1,gain:0,modulation:0,spec:0,recentPulse:0,
   oldHz:0,oldPhases:null,revoice:1,cellStep:0,nextGestureTick:0,motifOffset:parent?parent.motifOffset:Math.round((cell.amp-.6)*3+(cell.width-.2)*6),
   symHz:0,symOldHz:0,symPhase:0,symOldPhase:0,symFade:1,symLevel:0,symTarget:0,symFrom:0};
  this.organisms.push(p);this.births++;this.resource=clamp(this.resource-.08,0,1.2);this.lastBirth=this.time;this.lastIbi=cell.ibi;
  this.pickPitch(p,true);
 }
 pickPitch(p,immediate){
  const base=this.root,scale=SCALES[this.mode],scaleDegree=scale[p.pitchIndex%7];
  const chord=this.currentChord||this.getChord();
  const note=base+scaleDegree+(p.role===0?-12:(p.role===1?12:24));
  const min=p.role===0?30:(p.role===1?48:60),max=p.role===0?54:(p.role===1?76:92);
  // Continuous ecology shares the SAME harmonic field as the composed score.
  const best=this.midiInChord(note,chord,min,max);
  p.targetHz=midiHz(best);
  if(immediate||!p.freq){p.freq=p.targetHz;p.oldHz=0;p.revoice=1;}
  else if(Math.abs(Math.log2(p.targetHz/p.freq))>.035){
   p.oldHz=p.freq;p.oldPhases=p.phaseAudio.slice();p.freq=p.targetHz;p.revoice=0;this.pitchChanges++;
  }
 }
 // Passive room-tone listening affects at most two extant biological organisms.
 clearSympathetic(){for(const p of this.organisms)p.symTarget=0;}
 findSympathetic(p){
  const chord=this.currentChord;
  if(!chord||!this.micLinked||!this.ambientEnabled||this.ambientAmount<=0||this.envMix<=0||this.time-this.ambientLastAt>1.2)return null;
  const tones=chord.tones.map(n=>this.root+(chord.keyShift||0)+chord.r+n);
  const lo=p.role===0?70:p.role===1?145:230;
  const hi=p.role===0?270:p.role===1?750:1350;
  let best=null,bestScore=-1e9;
  for(const tone of this.ambientTones){
   if(tone.confidence<.22)continue;
   const midi=69+12*Math.log2(tone.hz/440);
   const cents=100*Math.min(...tones.map(n=>Math.abs(((midi-n+6)%12+12)%12-6)));
   // About a third of a semitone; no arbitrary detuned accompaniment.
   if(cents>38)continue;
   for(let octave=-2;octave<=3;octave++){
    const hz=tone.hz*Math.pow(2,octave);
    if(hz<lo||hz>hi||hz>this.fs*.36)continue;
    const distance=Math.abs(Math.log2(hz/Math.max(25,p.freq)));
    const score=tone.confidence-.2*distance-.003*cents;
    if(score>bestScore){bestScore=score;best={hz,confidence:tone.confidence,cents};}
   }
  }
  return best;
 }
 updateSympathetic(){
  const audible=this.organisms.filter(p=>!p.dying&&p.energy>.1&&p.fade>.2)
   .sort((a,b)=>((b.role===1?2:b.role===2?1:0)+b.energy*.15)-((a.role===1?2:a.role===2?1:0)+a.energy*.15));
  const selected=audible.slice(0,2);
  for(const p of this.organisms){
   const match=selected.includes(p)?this.findSympathetic(p):null;
   p.symTarget=match?clamp(match.confidence*this.ambientAmount*this.envMix):0;
   if(!match)continue;
   // Hold fixed frequency between decisions. Retune via overlap, never a glissando.
   if(!p.symHz){p.symHz=match.hz;p.symPhase=0;p.symOldHz=0;p.symFade=1;}
   else if(Math.abs(1200*Math.log2(match.hz/p.symHz))>35){
    p.symOldHz=p.symHz;p.symOldPhase=p.symPhase;
    p.symHz=match.hz;p.symPhase=0;p.symFade=0;
   }
  }
 }
 // BIOLOGICAL COMPOSER: a population of PPG-descended cells becomes a shared score.
 // A note's pitch remains constant for its entire life. New notes overlap and fade.
 rebuildTheme(){
  if(this.bioCells.length<8)return;
  const a=this.bioCells.slice(-8);
  const avg=a.reduce((s,b)=>s+b.ibi,0)/8;
  const amp=a.reduce((s,b)=>s+b.amp,0)/8;
  const width=a.reduce((s,b)=>s+b.width,0)/8;
  const rise=a.reduce((s,b)=>s+b.rise,0)/8;
  const scaffold=[0,1,0,2,1,-1,0,-2]; // musical grammar, not fake physiology
  const shape=a.map((b,i)=>{
   const temporal=(b.ibi-avg)/Math.max(.3,avg);
   const morphological=(b.amp-amp)*1.45+(b.width-width)*3.3+(b.rise-rise)*3.0;
   const mutation=clamp(Math.round(temporal*9+morphological*2.3),-3,3);
   const energy=clamp(.48+.55*b.amp/Math.max(.3,amp),.25,1.3);
   const rest=b.ibi>avg*1.065 && i%3===2;
   return {step:clamp(scaffold[i]+mutation,-4,5),energy,rest,delay:clamp(b.ibi/avg,.82,1.22)};
  });
  if(!this.theme.length){this.theme=shape;return;}
  // Slow inheritance: first seed remains recognisable. New PPG impulses modify it gradually.
  this.theme=this.theme.map((m,i)=>({
   step:clamp(Math.round(m.step*.76+shape[i].step*.24),-4,5),
   energy:mix(m.energy,shape[i].energy,.2),rest:m.rest&&shape[i].rest,
   delay:mix(m.delay,shape[i].delay,.18)
  }));
 }
 formSettings(){
  const mode=this.mode;
  return mode==='sleep'?{bars:4,rest:.53,gesture:20,padGain:.054,melGain:.056,attack:1.8,release:8.5}:
   mode==='meditate'?{bars:2,rest:.33,gesture:12,padGain:.069,melGain:.078,attack:1.1,release:6}:
   mode==='wake'?{bars:2,rest:.17,gesture:7,padGain:.067,melGain:.095,attack:.32,release:3.2}:
   {bars:2,rest:.09,gesture:4,padGain:.064,melGain:.115,attack:.04,release:1.8};
 }
 chooseInteraction(){
  const coherent=this.phaseCoherence;
  const complexity=this.mem.complex.ready?this.mem.complex.value:0;
  const count=this.organisms.filter(p=>!p.dying).length;
  // Independence is an *artistic* consequence of verified PPG variety and of the chosen goal.
  if(this.mode==='sleep')this.interaction='solo';
  else if(this.mode==='meditate')this.interaction=complexity>.13&&count>=3?'dialogue':'solo';
  else if(this.mode==='wake')this.interaction=complexity>.13&&count>=3?'dialogue':'ensemble';
  else this.interaction=complexity>.13&&count>=4?'dialogue':'ensemble';
  const alive=this.organisms.filter(p=>!p.dying&&p.energy>.08);
  if(alive.length){
   const sorted=alive.slice().sort((a,b)=>{
    const sa=a.energy*.8+a.fade*.3+(a.parent?0:.07);
    const sb=b.energy*.8+b.fade*.3+(b.parent?0:.07);
    return sb-sa||a.id-b.id;
   });
   this.leaderId=sorted[(Math.floor(this.bar/4))%Math.min(2,sorted.length)].id;
  }
 }
 getChord(){
  if(this.harmony.enabled&&this.harmony.chord(this.currentChordIndex))return this.harmony.chord(this.currentChordIndex);
  const path=this.feedback.enabled?(SomaAdaptive.PATHS[this.mode][this.feedback.level]||HARMONIC_PATHS[this.mode]):HARMONIC_PATHS[this.mode];
  return path[this.currentChordIndex];
 }
 midiInChord(target,chord,lo,hi,passing=false){
  const key=this.root+(chord.keyShift||0),anchor=key+chord.r;
  const pool=[];
  for(let o=-24;o<=60;o+=12)for(const n of chord.tones){const v=anchor+o+n;if(v>=lo&&v<=hi)pool.push(v);}
  if(passing){
   const scale=this.harmony.enabled?SomaHarmony.SCALES[this.mode]:SCALES[this.mode];
   for(let o=-24;o<=60;o+=12)for(const n of scale){const v=key+o+n;if(v>=lo&&v<=hi)pool.push(v);}
  }
  if(!pool.length)return clamp(Math.round(target),lo,hi);
  pool.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b);
  return pool[0];
 }
 voiceChord(chord){
  // Four actual notes (including sevenths or ninths), smooth independent parts.
  // Common tones are favored; parallel perfect 5ths and octaves are soft-penalized.
  const anchor=this.root+(chord.keyShift||0)+chord.r;
  const targets=this.previousVoicing||[53,60,67,74];
  const deg=chord.tones.length>=5?[0,1,3,4]:chord.tones.length>=4?[0,1,2,3]:[0,1,2,0];
  const ranges=[[48,65],[54,71],[60,78],[66,86]];
  const groups=deg.map((idx,i)=>{
   const a=[];for(let o=-24;o<=60;o+=12){const n=anchor+chord.tones[idx]+o;
    if(n>=ranges[i][0]&&n<=ranges[i][1])a.push(n);}
   return a.sort((a,b)=>Math.abs(a-targets[i])-Math.abs(b-targets[i])).slice(0,4);
  });
  let best=null,fitness=Infinity;
  for(const a of groups[0])for(const b of groups[1])for(const c of groups[2])for(const d of groups[3]){
   const v=[a,b,c,d];
   if(!(a<b&&b<c&&c<d)||d-a>32)continue;
   let cost=0;for(let k=0;k<4;k++){
    const leap=Math.abs(v[k]-targets[k]);cost+=leap+(leap>5?(leap-5)*1.3:0);
    if(v[k]===targets[k])cost-=2.4;
   }
   if(this.previousVoicing){for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
    const old=Math.abs(targets[j]-targets[i])%12,now=Math.abs(v[j]-v[i])%12;
    const da=v[i]-targets[i],db=v[j]-targets[j];
    if(da&&db&&Math.sign(da)===Math.sign(db)&&(old===7||old===0)&&now===old)cost+=22;
   }}
   cost+=Math.abs((d-a)-20)*.07;
   if(cost<fitness){fitness=cost;best=v;}
  }
  if(!best){const fallback=[53,60,67,74];best=fallback.map((v,i)=>this.midiInChord(v,chord,ranges[i][0],ranges[i][1]));}
  this.previousVoicing=best;
  this.harmony.lastVoicing=best.slice();
  return best;
 }
 addVoice({organism=null,pitch,kind='motif',gain=.09,attack=.2,hold=1.4,release=2.6,pan=.5,brightness=.7}){
  if(!this.signature||this.time-this.lastReliable>3.5)return;
  // Reserve polyphony for the shared harmony and bass; steal a fading foreground voice
  // rather than omitting a structural chord when a dense passage fills the pool.
  const reserve=kind==='motif'?7:kind==='pulse'?12:0;
  if(this.voices.length>=VOICE_CAP-reserve){
   if(kind==='motif'||kind==='pulse')return;
   let ix=-1,cost=1e20;
   for(let i=0;i<this.voices.length;i++){
    const v=this.voices[i];
    const c=v.env*(v.kind==='harmony'?9:v.kind==='bass'?12:1)+
      (v.age<v.attack?3:0)-v.age*.003;
    if(c<cost){cost=c;ix=i;}
   }
   if(ix>=0){
    const old=this.voices.splice(ix,1)[0];
    old.hold=old.age;old.releaseCoeff=Math.exp(-1/(this.fs*.06));
    this.retiringVoices.push(old);if(this.retiringVoices.length>6)this.retiringVoices.shift();
   }
  }
  const p=organism||this.organisms[0]||null;
  let material=p?.material??1;
  const freq=midiHz(pitch);
  if(freq<20||freq>18000||!Number.isFinite(freq))return;
  const id=++this.noteCount;
  const v={id,source:p?.id||0,midi:pitch,hz:freq,material,
   phases:[this.rng.next(),this.rng.next(),this.rng.next()],age:0,env:0,
   attack:Math.max(.015,attack),hold:Math.max(.1,hold),release:Math.max(.16,release),
   releaseCoeff:Math.exp(-1/(this.fs*Math.max(.16,release))),
   gain:Math.max(0,Math.min(.25,gain)),pan:clamp(pan,.05,.95),brightness:clamp(brightness,.15,1.5),
   leftPan:Math.cos(clamp(pan,.05,.95)*Math.PI*.5),rightPan:Math.sin(clamp(pan,.05,.95)*Math.PI*.5),
   noise:0,friction:p?.friction??.1,slowRate:.18+.15*this.bioComplex,kind};
  this.voices.push(v);
  this.noteEvents.push({time:this.time,pitch,source:v.source,kind,bar:this.bar+1,chord:this.currentChord?.name||'',chordIndex:this.currentChordIndex,tonic:this.root+(this.currentChord?.keyShift||0),keyShift:this.currentChord?.keyShift||0,pivot:!!this.currentChord?.pivot,pathLevel:this.feedback.level});
  if(this.noteEvents.length>50)this.noteEvents.shift();
 }
 advanceHarmony(){
  if(!this.signature)return;
  const newIndex=Math.floor(this.bar/this.formSettings().bars)%4;
  this.currentChordIndex=newIndex;
  this.currentChord=this.getChord();this.harmonic=newIndex;
  const chord=this.currentChord,style=this.formSettings();
  const alive=this.organisms.filter(p=>!p.dying);
  const progenitor=alive.find(p=>p.id===this.leaderId)||alive[0]||null;
  const voicing=this.voiceChord(chord);
  const dur=this.musicBeatSec*4*this.formSettings().bars;
  const extra=this.mode==='sleep'?1.4:this.mode==='meditate'?1.1:.72;
  for(let i=0;i<voicing.length;i++){
   // Actual pitch-common notes are held through changes, avoiding an unnecessary reattack.
   const existing=this.harmony.enabled?this.voices.find(v=>v.kind==='harmony'&&v.midi===voicing[i]&&v.env>.12&&v.age<v.hold+Math.min(v.release,3.2)):null;
   if(existing){existing.hold=Math.max(existing.hold,existing.age+dur*.82);existing.release=Math.max(existing.release,style.release*extra);this.tiedTones++;continue;}
   this.addVoice({organism:alive[i%Math.max(1,alive.length)]||progenitor,pitch:voicing[i],
    kind:'harmony',gain:style.padGain*(i===0?1:.76)*this.onset.energyShape(this.time,this.mode,this.feedback),
    attack:style.attack*(chord.pivot?1.5:1)*(.8+.22*i),hold:Math.max(.8,dur*.83),release:style.release*extra,
    pan:.21+i*.19,brightness:(.37+.21*this.bioComplex)*(chord.pivot?.86:1)});
  }
  // The bass is always part of the composed harmony, not a separate perpetual sinusoid.
  let bass=this.root+(chord.keyShift||0)+chord.r-12;
  while(bass<31)bass+=12;while(bass>51)bass-=12;
  this.addVoice({organism:progenitor,pitch:bass,kind:'bass',gain:style.padGain*1.65*this.onset.energyShape(this.time,this.mode,this.feedback),
   attack:this.mode==='activate'?.025:.5,hold:dur*.95,release:style.release*1.6,
   pan:.5,brightness:.42});
  // The population's continuous resonances revoice by overlapping stable tones.
  for(const p of this.organisms)this.pickPitch(p,false);
 }
 composeTick(){
  if(!this.signature||this.time-this.lastReliable>3.5)return;
  const abs=this.musicTick++,tick=abs%16;
  const bar=Math.floor(abs/16);
  if(bar!==this.bar||abs===0){
   this.bar=bar;this.form=Math.floor(this.bar/4)%4;
   if(this.bar%4===0){this.rebuildTheme();this.chooseInteraction();}
   if(this.bar>0 && this.bar%(this.formSettings().bars*4)===0){
    this.feedback.boundary(this.time,this.pulseResponse,{missing:this.time-this.lastReliable>5,acousticInstability:this.micLinked&&this.env.onset>.65});
   }
   if(this.harmony.enabled&&(this.bar%(this.formSettings().bars*4)===0||!this.harmony.current.length)){
    const dna=SomaHarmony.profile(this.bioCells);
    this.harmony.plan(dna,this.feedback,this.time-this.lastReliable<4&&this.quality>=.76,this.time);
   }
   if(this.bar%this.formSettings().bars===0||!this.currentChord)this.advanceHarmony();
  }
  if(!this.currentChord||!this.organisms.length||!this.theme.length)return;
  // The melodic foreground is PPG-derived, but has its own musical time and can REST.
  const s=this.formSettings(),alive=this.organisms.filter(p=>!p.dying&&p.energy>.07);
  const calm=this.mode==='sleep'||this.mode==='meditate';
  const evolution=this.feedback.enabled?this.feedback.level:0;
  // Bounded orchestration shift only: PPG-derived motif and original timing remain primary.
  const motifGainScale=calm?1-.055*evolution:1+.035*evolution;
  if(!alive.length)return;
  let active=[];
  const leader=alive.find(p=>p.id===this.leaderId)||alive[0];
  if(this.interaction==='solo')active=[leader];
  else if(this.interaction==='dialogue'){
   const peers=alive.filter(p=>p.role!==0);
   const pool=peers.length?peers:alive;
   active=[pool[Math.floor(this.bar/2+tick/8)%pool.length]];
  }else{
   // A shared cell motif can be voiced by several lineages on the same strong beat.
   const count=this.mode==='activate'?3:2;
   active=alive.filter(p=>p.role!==0).slice(0,count);
   if(!active.length)active=[leader];
  }
  const phraseStep=this.form;
  const density=this.mode==='activate'?1:this.mode==='wake'?.78:this.mode==='meditate'?.47:.25;
  let used=0;
  for(const p of active){
   if(abs<p.nextGestureTick)continue;
   const idx=p.cellStep++%8,bi=(idx+Math.abs(p.motifOffset))%8;
   const m=this.theme[bi];
   const gapScale=(this.interaction==='ensemble'&&this.mode==='activate')?.68:1;
   let gap=Math.max(2,Math.round(s.gesture*m.delay*gapScale + (p.role===0?3:0)));
   // Pauses carry biological ancestry, but musical form may extend them deliberately.
   const deliberateRest=(this.mode==='sleep'&&idx%3===2)||(this.mode==='meditate'&&phraseStep===3&&idx%4===3);
   p.nextGestureTick=abs+gap;
   if(m.rest||deliberateRest || (idx%8===6&&this.form===3))continue;
   if(this.interaction==='ensemble'&&used>=2)continue;
   // Whole-tone contour from PPG; harmonic strong beats are chord tones.
   let contour=m.step+p.motifOffset+(this.form===2?Math.round(m.step*.35):0);
   if(this.form===3)contour=Math.round(contour*.65); // recognisable transformed return
   const desired=this.root+(this.currentChord.keyShift||0)+27+contour*2+(p.role===1?-7:0);
   const accented=(tick%8===0),passing=!accented&&(this.mode==='wake'||this.mode==='activate')&&this.form!==3;
   const pitch=this.midiInChord(desired,this.currentChord,57,87,passing);
   const velocity=m.energy*(accented?1.09:.8)*(this.form===2?1.08:1);
   const duration=this.mode==='sleep'?this.musicBeatSec*4:this.mode==='meditate'?this.musicBeatSec*2.8:this.mode==='wake'?this.musicBeatSec*1.35:this.musicBeatSec*.75;
   this.addVoice({organism:p,pitch,kind:'motif',gain:s.melGain*velocity*density*motifGainScale*this.onset.energyShape(this.time,this.mode,this.feedback),
    attack:s.attack*(this.mode==='activate'?.7:1),hold:duration,release:s.release,
    pan:p.pan,brightness:.58+this.bioComplex*.42});
   used++;
  }
  if(this.mode==='activate'&&tick%4===0&&this.voices.length<VOICE_CAP-4){
   const bassPitch=this.midiInChord(this.root+(this.currentChord.keyShift||0)+this.currentChord.r-12,this.currentChord,30,52);
   this.addVoice({organism:leader,pitch:bassPitch,kind:'pulse',gain:(.05+.035*this.bioComplex)*this.onset.energyShape(this.time,this.mode,this.feedback),
    attack:.018,hold:this.musicBeatSec*.22,release:.31,pan:.5,brightness:.45});
  }
 }
 onMusicTick(){
  if(!this.scoreStarted){this.scoreStarted=true;this.musicTick=0;this.bar=0;this.form=0;
   this.previousVoicing=null;this.currentChord=null;this.rebuildTheme();this.chooseInteraction();}
  const inputIbi=this.mem.ibi12.ready?this.mem.ibi12.value:.82;
  // Matching first, slow goal-dependent exploration later. No instantaneous
  // tempo jump toward an allegedly activating or sedating musical tempo.
  const desired=this.onset.tempoTarget(this.time,inputIbi,this.mode,this.feedback);
  this.musicBeatSec=mix(this.musicBeatSec,desired,.055);
  this.composeTick();
 }

 updateEcology(dt){
  // ENVIRONMENT SCALE: microphone ambient ~9 s; weather ~18 min, time-of-day slow.
  this.symUpdateClock+=dt;
  this.responseClock+=dt;
  if(this.responseClock>=1){this.responseClock=0;
   if(this.onset.update(this.time,this.pulseResponse,this.mode,this.time-this.lastReliable,this.source))this.activateIdentity();
   if(this.onset.ready)this.feedback.observe(this.time,this.pulseResponse,{
   missing:this.time-this.lastReliable>5||this.quality<.76,
   acousticInstability:this.micLinked&&(this.env.onset>.66||this.acousticImpulse>.75)
  });}
  if(this.symUpdateClock>=.8){this.symUpdateClock=0;this.updateSympathetic();}
  const e=this.envSmooth,w=this.weatherTarget;
  const aa=1-Math.exp(-dt/9),ab=1-Math.exp(-dt/4),aw=1-Math.exp(-dt/1080);
  e.ambient+=aa*(this.env.ambient-e.ambient);
  e.brightness+=ab*(this.env.centroid-e.brightness);
  e.voice+=ab*(this.env.voiceLike-e.voice);
  e.weatherCloud+=aw*(w.cloud-e.weatherCloud);
  e.weatherWind+=aw*(w.wind-e.weatherWind);
  e.weatherRain+=aw*(w.rain-e.weatherRain);
  e.weatherNight+= (1-Math.exp(-dt/240))*(w.night-e.weatherNight);
  this.acousticImpulse*=Math.exp(-dt/.9);
  const settings=SETTINGS[this.mode];const good=this.onset.ready&&this.time-this.lastReliable<2.6&&this.quality>=.58;
  const desired=clamp(Math.round(settings.target+this.bioComplex*8),2,12);
  this.targetPop=good?desired:0;
  // A long signal interruption fades the ecosystem without acquiring fictional biological material.
  if(!good){for(const p of this.organisms){p.dying=true;}}
  else this.resource=clamp(this.resource+dt*(.013+.02*this.bioComplex),.1,1.2);
  let coherenceCos=0,coherenceSin=0;
  for(const p of this.organisms){coherenceCos+=Math.cos(p.phase);coherenceSin+=Math.sin(p.phase);}
  const N=Math.max(1,this.organisms.length);
  const meanPhase=Math.atan2(coherenceSin,coherenceCos);
  this.phaseCoherence=Math.sqrt(coherenceCos*coherenceCos+coherenceSin*coherenceSin)/N;
  let spent=0;
  for(const p of this.organisms){
   const coupling=.24+1.15*(1-this.bioComplex);
   p.phase+=dt*(p.omega + coupling*Math.sin(meanPhase-p.phase)*this.phaseCoherence);
   p.age+=dt;
   p.recentPulse=(p.recentPulse||0)*Math.exp(-dt/3.2);
   // Energy budget: mild feeding, spectral competition, metabolic dissipation.
   let competition=0;
   for(const other of this.organisms)if(other!==p)competition+=Math.exp(-Math.abs(Math.log2(Math.max(1,p.freq)/Math.max(1,other.freq)))*9)*.009;
   const absorption=(good?.014+.025*this.bioNovelty:0)*(1-.5*p.hardness);
   const metabolic=.008+(.004*p.hardness)+competition;
   p.energy=clamp(p.energy+dt*(absorption-metabolic),0,1.2);
   if(p.age>p.life || p.energy<.06 || (this.organisms.length>desired+1&&p.role!==0))p.dying=true;
   if(p.dying)p.fade=clamp(p.fade-dt/(p.role===0?9:6));
   const attack=smooth(p.age/(p.role===0?5:4));
   const release=smooth((p.life-p.age)/Math.min(9,p.life*.25));
   const breathe=.15+.85*(.5+.5*Math.sin(p.phase));
   p.modulation=breathe;
   // persistent ambience changes the INTERNAL spectral material, not PPG genealogy.
   p.spec=.65+.35*Math.cos(p.phase*.57+p.gene*.01);
   p.spec=clamp(p.spec + this.envMix*.34*(e.brightness-.3)+this.weatherMix*.31*e.weatherWind +.12*this.acousticImpulse,.12,1.35);
   p.env=attack*release*p.fade*clamp(p.energy*1.15)*(.08+.92*breathe)*(1+.14*p.recentPulse);
   const minH=clamp(p.hardness+.11*this.bioComplex);
   const sonicRoom=1-this.envMix*.12*e.ambient-this.weatherMix*.09*e.weatherCloud;
   p.amp=mix(p.amp,p.env*settings.energy*(p.role===0?.26:(p.role===1?.17:.11))*sonicRoom,.12);
   p.revoice=clamp(p.revoice+dt/2.6);
   p.symFade=clamp(p.symFade+dt/2.6);
   // The environment can only color energy already articulated by this PPG organism.
   p.symLevel+=clamp(dt/1.5,0,1)*(p.symTarget-p.symLevel);
   spent+=metabolic*dt;
  }
  this.resource=clamp(this.resource-spent*.025,0,1.2);
  const before=this.organisms.length;
  this.organisms=this.organisms.filter(p=>p.fade>.005&&p.age<p.life+8);
  this.deaths+=before-this.organisms.length;
  // Culling occurs at the slow ecological rate; old notes finish their acoustic release.
  this.voices=this.voices.filter(v=>v.age<v.hold+v.release*7&&v.env>.000035 || v.age<v.attack);
  this.retiringVoices=this.retiringVoices.filter(v=>v.age<v.hold+.45&&v.env>.000035);
  if(good&&this.organisms.length<desired&&this.time-this.lastBirth>Math.max(3.4,11-this.bioComplex*18)&&this.beat>=3){this.born(false);}
  // Harmony and theme changes are exclusively scheduled by the common musical score.
 }
 report(force=false){
  if(!force&&this.reportClock<.40)return;this.reportClock=0;
  const agents=this.organisms.map(p=>({id:p.id,parent:p.parent,material:p.material,role:p.role,pan:p.pan,age:p.age,life:p.life,pitch:Math.round(69+12*Math.log2(Math.max(1,p.freq)/440)),
   energy:p.energy,amplitude:p.amp,hardness:p.hardness,phase:p.phase,fade:p.fade}));
  const data={type:'status',t:this.time,beats:this.beat,mode:this.mode,source:this.source,hr:this.quality>=.58?60/this.latest.ibi:0,
   q:this.quality,novelty:this.bioNovelty,complex:this.bioComplex,organisms:agents,pop:agents.length,target:this.targetPop,
   births:this.births,deaths:this.deaths,coherence:this.phaseCoherence,root:this.root,harmonic:this.harmonic,
   signature:this.signature,hash:this.hash,mem:[this.mem.ibi2.value,this.mem.ibi12.value,this.mem.ibi90.value,this.mem.ibi900.value],
   direct:!this.mutePulse?(this.onset.ready?clamp(1-smooth((this.time-this.onset.readyAt-8)/43)):1):0,loss:this.time-this.lastReliable,
   env:{...this.env},envSmooth:{...this.envSmooth},micGrains:this.micGrainCount,envMix:this.envMix,weatherMix:this.weatherMix,
   ambientHarmony:{enabled:this.ambientEnabled,amount:this.ambientAmount,
    detected:this.micLinked&&this.time-this.ambientLastAt<1.2?this.ambientTones:[],
    active:this.organisms.filter(p=>p.symLevel>.025&&p.amp>.0001).map(p=>({id:p.id,hz:p.symHz,level:p.symLevel})),
    source:this.micLinked?'real microphone':'off'},
   sonic:{materialBrightness:clamp(this.envMix*this.envSmooth.brightness*.65+this.weatherMix*this.envSmooth.weatherWind*.35),
     transientExcitation:this.acousticImpulse,textureDensity:clamp(this.envMix*this.envSmooth.ambient*.45+this.weatherMix*this.envSmooth.weatherRain*.4),
     roomDepth:clamp(.35+this.weatherMix*this.envSmooth.weatherCloud*.23+this.weatherMix*this.envSmooth.weatherNight*.3)},
   audioPeak:this.metricPk,stereo:this.metricLR/Math.sqrt(Math.max(1e-14,this.metricLL*this.metricRR)),
   harmonicNavigation:{...this.harmony.status(),tiedTones:this.tiedTones},
   onset:this.onset.status(this.time,this.mode,this.mem.ibi12.value||this.latest.ibi,this.feedback),
   adaptive:{...this.feedback.status(),baseline:this.pulseResponse.baseline,source:this.source==='sim'?'SIMULATO (nessuna risposta umana)': 'CSV PPG (osservazionale)',accepted:this.pulseResponse.total,rejected:this.pulseResponse.rejected},
   score:{started:this.scoreStarted,bar:this.bar+1,form:FORM_NAMES[this.form],chord:this.currentChord?.name||'—',key:this.harmony.enabled?this.harmony.keyName():null,pivot:!!this.currentChord?.pivot,
     interaction:this.interaction,leader:this.leaderId,pathLevel:this.feedback.enabled?this.feedback.level:0,voices:this.voices.length,events:this.noteCount,
     theme:this.theme.map(m=>m.step),recent:this.noteEvents.slice(-6),pitchChanges:this.pitchChanges,
     beatSeconds:this.musicBeatSec}};
  this.port.postMessage(data);
  this.metricPk=0;this.metricLL=0;this.metricRR=0;this.metricLR=0;this.metricN=0;
 }
 process(inputs,outputs){
  const out=outputs[0],l=out[0],r=out[1]||out[0];if(!this.running){l.fill(0);r.fill(0);return true;}
  const dt=1/this.fs;
  // Fast micro-acoustic onset detector runs on AUDIO THREAD even when browser UI timers throttle.
  // Input is analysed, NEVER routed straight to output.
  if(this.micLinked && inputs[0]?.[0]?.length){
   const raw=inputs[0][0];let sq=0;for(let j=0;j<raw.length;j++)sq+=raw[j]*raw[j];
   const level=Math.sqrt(sq/raw.length),bdt=raw.length/this.fs;
   this.fastMicFloor+=clamp(bdt/(level>this.fastMicFloor*1.35?16:3),0,.08)*(Math.min(level,this.fastMicFloor*1.4)-this.fastMicFloor);
   const sudden=level-this.fastMicPrevious;
   if(level>Math.max(.009,this.fastMicFloor*2.8)&&sudden>Math.max(.003,this.fastMicFloor*.72)&&this.time-this.fastMicLast>.36){
    this.fastMicLast=this.time;
    const strength=clamp(sudden/(this.fastMicFloor+.025));this.acousticImpulse=Math.max(this.acousticImpulse,strength*this.envMix);
    if(this.signature)for(let j=0;j<this.organisms.length;j+=3)this.organisms[j].recentPulse=clamp((this.organisms[j].recentPulse||0)+.2*strength);
   }
   this.fastMicPrevious=level;
  }
  for(let i=0;i<l.length;i++){
   if(this.source==='csv'){
    while(this.csvIndex<this.csv.length&&this.csv[this.csvIndex].t<=this.time){this.acceptPulse(this.csv[this.csvIndex++]);}
   }else if(this.time>=this.nextBeat){this.simulateBeat();}
   this.controlClock+=dt;this.reportClock+=dt;
   if(this.signature&&this.time-this.lastReliable<3.5&&this.time>=this.nextMusicTick){
    this.onMusicTick();this.nextMusicTick+=Math.max(.06,this.musicBeatSec*.25);
   }
   if(this.controlClock>=.065){this.updateEcology(this.controlClock);this.controlClock=0;}
   let left=0,right=0;
   for(const p of this.organisms){
    if(p.amp<.00009)continue;
    const f=Math.max(25,p.freq),ratios=RATIOS[p.material];
    let w=0,ph=p.phaseAudio;
    // Retain rich inharmonic materials but balance their upper partials by mode.
    // Sleep/meditation: less upper-band masking and gentler spectral evolution;
    // activation: audible brightness / contrast, bounded at the final master.
    const upperShade=this.mode==='sleep'?.53:this.mode==='meditate'?.67:this.mode==='wake'?.85:1;
    for(let k=0;k<3;k++){
     const partial=f*ratios[k]*(1+.00027*p.spec*(k+1));
     if(partial>=this.fs*.46)continue; // reject aliased partials rather than folding them down
     ph[k]+=partial*dt;if(ph[k]>=1)ph[k]-=Math.floor(ph[k]);
     const high=(k===0?1:(k===1?.52:.30)) * (1+(p.hardness-.40)*k*.67) * (k===0?1:(.49+.72*p.spec+.10*p.recentPulse));
     const loss=(k===0?1:Math.exp(-p.damping*p.age*.027*k));
     w+=sine(ph[k])*high*loss*(k===0?1:upperShade);
    }
    p.noise+=.012*((this.rng.next()*2-1)-p.noise);
    // Weather is long-term shading. Microphone noise floor affects friction lightly.
    const texture=p.friction*p.noise*(.35+this.envMix*.65*this.envSmooth.ambient+this.weatherMix*.35*this.envSmooth.weatherRain);
    const transientShade=this.mode==='sleep'?.25:this.mode==='meditate'?.4:this.mode==='wake'?.75:1;
    w+=.03*transientShade*this.acousticImpulse*(p.role===0?.2:1)*p.spec*sine(ph[0]*1.67);
    // Discrete note-to-note changes are realised as overlap of two steady pitches.
    if(p.oldHz>0&&p.revoice<1&&p.oldPhases){
     let old=0;
     for(let k=0;k<3;k++){
      p.oldPhases[k]+=p.oldHz*ratios[k]*dt;
      if(p.oldPhases[k]>=1)p.oldPhases[k]-=Math.floor(p.oldPhases[k]);
      if(p.oldHz*ratios[k]<this.fs*.46)old+=sine(p.oldPhases[k])*(k===0?1:k===1?.45:.22)* (k===0?1:upperShade);
     }
     const x=smooth(p.revoice);w=w*x+old*(1-x);
    }
    // Sympathetic oscillator has a constant pitch, shares the organism's
    // physiological envelope and pan, and goes silent if that organism dies.
    if(p.symHz>0&&p.symLevel>.00005){
     p.symPhase+=p.symHz*dt;if(p.symPhase>=1)p.symPhase-=Math.floor(p.symPhase);
     let resonance=sine(p.symPhase);
     if(p.symOldHz>0&&p.symFade<1){
      p.symOldPhase+=p.symOldHz*dt;
      if(p.symOldPhase>=1)p.symOldPhase-=Math.floor(p.symOldPhase);
      const x=smooth(p.symFade);
      resonance=resonance*x+sine(p.symOldPhase)*(1-x);
     }
     w+=.40*p.symLevel*resonance;
    }
    w=(w*.34+texture)*p.amp*(this.signature?.42:1);
    let pan=clamp(p.pan+.11*Math.sin(p.phase*.41));
    // constant power, with stable centred low register.
    if(p.role===0)pan=.5;
    const ca=Math.cos(pan*Math.PI*.5),sa=Math.sin(pan*Math.PI*.5);
    left+=w*ca;right+=w*sa;
   }
   // Stable-frequency notes: overlapping attacks and releases replace glissandi.
   for(let vi=0;vi<this.voices.length+this.retiringVoices.length;vi++){
    const v=vi<this.voices.length?this.voices[vi]:this.retiringVoices[vi-this.voices.length];
    v.age+=dt;
    if(v.age<v.attack)v.env=clamp(v.env+dt/v.attack);
    else if(v.age>v.hold)v.env*=v.releaseCoeff;
    if(v.env<.000035)continue;
    const ratios=RATIOS[v.material],ph=v.phases;
    let wave=0;
    const voiceShade=this.mode==='sleep'?.57:this.mode==='meditate'?.72:this.mode==='wake'?.88:1;
    const lateAir=1-.25*clamp((v.age-v.attack)/Math.max(.3,v.hold+v.release),0,1);
    for(let k=0;k<3;k++){
     const f=v.hz*ratios[k];
     if(f>=this.fs*.46)continue;
     ph[k]+=f*dt;if(ph[k]>=1)ph[k]-=Math.floor(ph[k]);
     wave+=sine(ph[k])*(k===0?1:k===1?.47*v.brightness:.19*v.brightness)*(k===0?1:voiceShade*lateAir);
    }
    v.noise+=(this.rng.signed()-v.noise)*.015;
    const breath=.82+.18*Math.sin(v.age*v.slowRate+v.id);
    const signal=(wave*.55+v.noise*.025*v.friction)*v.env*v.gain*breath;
    left+=signal*v.leftPan;right+=signal*v.rightPan;
   }
   // OPTIONAL micro-granulation: processed shards, never direct microphone monitor.
   if(this.micGrains.length){
    for(let k=this.micGrains.length-1;k>=0;k--){
     const g=this.micGrains[k],n=g.samples.length,pos=Math.floor(g.idx);
     if(pos>=n-2){this.micGrains.splice(k,1);continue;}
     const f=g.idx-pos,x=g.samples[pos]*(1-f)+g.samples[pos+1]*f;
     const progress=g.idx/n;
     const env=.5-.5*Math.cos(TAU*progress);
     g.low+=.014*(x-g.low);
     const filtered=(x-g.low)*env*g.gain;
     left+=filtered*Math.cos(g.pan*Math.PI*.5);
     right+=filtered*Math.sin(g.pan*Math.PI*.5);
     g.idx+=g.rate;
    }
   }
   // Only descendants of a verified initial profile are allowed into the score.
   // Match then cross-fade over 23 s, leaving the direct pulse audible first.
   const musicalGain=this.onset.musicMix(this.time);
   left*=musicalGain;right*=musicalGain;
   // Audible biological origin is initially foregrounded, then gracefully recedes.
   if(this.direct>1e-5){
    this.directPhase+=dt;
    const pulseWidth=this.latest.width||.22,pulseRise=this.latest.rise||.11;
    const slow=24/(.35+2*pulseWidth),fast=80/(.55+4.8*pulseRise);
    const excitation=(Math.exp(-this.directPhase*slow)-Math.exp(-this.directPhase*fast))*this.direct;
    left+=excitation*.34;right+=excitation*.34;
    this.direct*=.9997;
   }
   const input=(left+right)*.5;
   let wetL=0,wetR=0;
   for(let j=0;j<this.combs.length;j++){
    const b=this.combs[j],k=this.ptrs[j],v=b[k];
    this.damp[j]+=.15*(v-this.damp[j]);
    const reverbTime=(this.mode==='sleep'?.80:.73)+.045*this.weatherMix*this.envSmooth.weatherCloud+.018*this.weatherMix*this.envSmooth.weatherNight;
    b[k]=input*(j%2?.15:.17)+this.damp[j]*clamp(reverbTime,0,.87);
    this.ptrs[j]=(k+1)%b.length;
    if(j%2===0)wetL+=v;else wetR+=v;
   }
   left=left*.79+wetL*.35;right=right*.79+wetR*.35;
   // A decorrelated side field for material harmonics, with sub energy in the middle.
   const mid=(left+right)*.5,side=(left-right)*.5;
   this.sideLow+=clamp(760/this.fs,0,.1)*(mid-this.sideLow);
   const highMid=mid-this.sideLow;
   const delayed=this.sideBuffer[this.sideIndex];this.sideBuffer[this.sideIndex]=highMid;
   this.sideIndex=(this.sideIndex+1)%this.sideBuffer.length;
   const diff=(highMid-delayed)*.33;
   left=mid+side*1.35+diff;right=mid-side*1.35-diff;
   // Mode-aware gentle saturation; still bounded. Not a calibrated SPL or true-peak limiter.
   const drive=this.mode==='sleep'?2.05:this.mode==='meditate'?2.35:this.mode==='wake'?2.70:3.0;
   const a=Math.tanh(left*drive)*.84,b=Math.tanh(right*drive)*.84;
   l[i]=Number.isFinite(a)?a:0;r[i]=Number.isFinite(b)?b:0;
   this.metricPk=Math.max(this.metricPk,Math.abs(l[i]),Math.abs(r[i]));this.metricLL+=l[i]*l[i];this.metricRR+=r[i]*r[i];this.metricLR+=l[i]*r[i];this.metricN++;
   this.time+=dt;
  }
  this.report();return true;
 }
}
function mod12(n){return ((n%12)+12)%12;}
registerProcessor('soma-ecology',SomaEcology);
