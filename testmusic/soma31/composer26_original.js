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
 getChord(){return HARMONIC_PATHS[this.mode][this.currentChordIndex];}
 midiInChord(target,chord,lo,hi,passing=false){
  const anchor=this.root+chord.r;
  const pool=[];
  for(let o=-24;o<=60;o+=12){
   for(const n of chord.tones){const v=anchor+o+n;if(v>=lo&&v<=hi)pool.push(v);}
  }
  if(passing){
   const scale=SCALES[this.mode];
   for(let o=-24;o<=60;o+=12)for(const n of scale){const v=this.root+o+n;if(v>=lo&&v<=hi)pool.push(v);}
  }
  if(!pool.length)return clamp(Math.round(target),lo,hi);
  pool.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b);
  return pool[0];
 }
 voiceChord(chord){
  // Exhaustive, small nearest-voice search across available inversions and extensions.
  // We do not assume every chord admits ideal 4-part classical voice leading.
  const anchor=this.root+chord.r;
  const targets=this.previousVoicing||[56,63,70];
  const groups=chord.tones.slice(0,3).map(t=>{
   const list=[];
   for(let oct=-12;oct<=60;oct+=12){const pitch=anchor+t+oct;if(pitch>=51&&pitch<=80)list.push(pitch);}
   return list;
  });
  let best=null,fitness=1e30;
  for(const a of groups[0])for(const b of groups[1])for(const c of groups[2]){
   const v=[a,b,c].sort((x,y)=>x-y);
   if(v[0]===v[1]||v[1]===v[2]||v[2]-v[0]>23)continue;
   let cost=0;for(let k=0;k<3;k++){
    const leap=Math.abs(v[k]-targets[k]);cost+=leap+(leap>7?(leap-7)*1.9:0);
   }
   cost+=Math.abs(v[2]-v[0]-13)*.09;
   if(cost<fitness){fitness=cost;best=v;}
  }
  if(!best)best=[56,63,70].map(x=>this.midiInChord(x,chord,51,80));
  this.previousVoicing=best;return best;
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
  this.noteEvents.push({time:this.time,pitch,source:v.source,kind,bar:this.bar+1,chord:this.currentChord?.name||'',chordIndex:this.currentChordIndex,tonic:this.root});
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
  for(let i=0;i<voicing.length;i++)this.addVoice({
   organism:alive[i%Math.max(1,alive.length)]||progenitor,pitch:voicing[i],
   kind:'harmony',gain:style.padGain*(i===0?1:.82),
   attack:style.attack*(.8+.25*i),hold:Math.max(.8,dur*.83),release:style.release*extra,
   pan:.26+i*.23,brightness:.40+.25*this.bioComplex
  });
  // The bass is always part of the composed harmony, not a separate perpetual sinusoid.
  let bass=this.root+chord.r-12;
  while(bass<31)bass+=12;while(bass>51)bass-=12;
  this.addVoice({organism:progenitor,pitch:bass,kind:'bass',gain:style.padGain*1.65,
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
   if(this.bar%this.formSettings().bars===0||!this.currentChord)this.advanceHarmony();
  }
  if(!this.currentChord||!this.organisms.length||!this.theme.length)return;
  // The melodic foreground is PPG-derived, but has its own musical time and can REST.
  const s=this.formSettings(),alive=this.organisms.filter(p=>!p.dying&&p.energy>.07);
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
   const desired=this.root+27+contour*2+(p.role===1?-7:0);
   const accented=(tick%8===0),passing=!accented&&(this.mode==='wake'||this.mode==='activate')&&this.form!==3;
   const pitch=this.midiInChord(desired,this.currentChord,57,87,passing);
   const velocity=m.energy*(accented?1.09:.8)*(this.form===2?1.08:1);
   const duration=this.mode==='sleep'?this.musicBeatSec*4:this.mode==='meditate'?this.musicBeatSec*2.8:this.mode==='wake'?this.musicBeatSec*1.35:this.musicBeatSec*.75;
   this.addVoice({organism:p,pitch,kind:'motif',gain:s.melGain*velocity*density,
    attack:s.attack*(this.mode==='activate'?.7:1),hold:duration,release:s.release,
    pan:p.pan,brightness:.58+this.bioComplex*.42});
   used++;
  }
  if(this.mode==='activate'&&tick%4===0&&this.voices.length<VOICE_CAP-4){
   const bassPitch=this.midiInChord(this.root+this.currentChord.r-12,this.currentChord,30,52);
   this.addVoice({organism:leader,pitch:bassPitch,kind:'pulse',gain:.05+.035*this.bioComplex,
    attack:.018,hold:this.musicBeatSec*.22,release:.31,pan:.5,brightness:.45});
  }
 }
 onMusicTick(){
  if(!this.scoreStarted){this.scoreStarted=true;this.musicTick=0;this.bar=0;this.form=0;
   this.previousVoicing=null;this.currentChord=null;this.rebuildTheme();this.chooseInteraction();}
  const inputIbi=this.mem.ibi12.ready?this.mem.ibi12.value:.82;
  const desired=this.mode==='sleep'?clamp(inputIbi*1.62,1.12,1.48):
   this.mode==='meditate'?clamp(inputIbi*1.07,.77,1.06):
   this.mode==='wake'?clamp(inputIbi*.89,.62,.89):clamp(inputIbi*.63,.39,.58);
  this.musicBeatSec=mix(this.musicBeatSec,desired,.055);
  this.composeTick();
 }
