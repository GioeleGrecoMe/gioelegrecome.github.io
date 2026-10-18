/* SOMA 31 — acquisition gate and physiology-matched musical onset.
 * The gates are engineering decisions, not clinical definitions of arousal.
 * Real-time PPG is NOT implemented; CSV is historical replay, not causal feedback.
 */
const SomaOnset=(()=>{
 const sat=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
 const ease=x=>{x=sat(x);return x*x*(3-2*x);};
 const med=a=>{const x=a.slice().sort((a,b)=>a-b);return x.length?x[Math.floor(x.length/2)]:NaN;};
 class Gate{
  constructor(){this.reset();}
  reset(){this.phase='listening';this.ready=false;this.readyAt=null;this.goalAt=0;this.baseline=null;
   this.progress=0;this.reason='Attendo 38 s e almeno 30 impulsi PPG attendibili';this.badCount=0;
   this.confidence=0;this.initialMobility=0;this.current=null;this.lastGoal='meditate';}
  // Conservative onset: no invented organism or composed harmony until a 30 s
  // contiguous and reasonably stationary valid PPG window exists.
  update(t,pulse,mode,age,source){
   this.lastGoal=mode;
   const recent=pulse.stats(t,40);
   this.current=recent;
   if(this.ready){
    if(this.phase==='emerging'&&t-this.readyAt>=26)this.phase='active';
    return false;
   }
   const count=pulse.total,seen=pulse.samples;
   const span=recent?.span||0,valid=recent?.count||0;
   this.progress=sat(Math.min(t/38,count/30,span/30,valid/27));
   if(!recent||t<38||count<30||span<30||valid<27){
    this.reason=`Raccolta del profilo: ${count}/30 battiti · ${Math.floor(Math.min(t,38))}/38 s · ${Math.floor(span)}/30 s di finestra`;
    return false;
   }
   if(age>2.6||recent.quality<.84){this.reason='Qualità insufficiente o segnale interrotto; ascolto del battito';return false;}
   const intervals=seen.filter(s=>s.t>=t-40).map(s=>s.ibi);
   const median=med(intervals);
   const mad=med(intervals.map(v=>Math.abs(v-median)));
   const morph=seen.filter(s=>s.t>=t-40);
   const amp=med(morph.map(s=>s.amp));
   const ampMad=med(morph.map(s=>Math.abs(s.amp-amp)));
   // High variability alone is not automatically an artifact. Only extreme
   // discontinuity or implausible morphology prevents initialisation.
   if(!(Number.isFinite(median)&&median>=.38&&median<=1.65) || mad>median*.24 || ampMad>Math.max(.25,amp*.52)){
    this.reason='Finestra instabile: attendo misure più coerenti';return false;
   }
   this.ready=true;this.readyAt=t;this.goalAt=t;this.phase='emerging';this.confidence=sat((recent.quality-.78)/.20)*sat(valid/38);
   this.baseline={...recent,ibi:60/recent.bpm,ibiMedian:median,ibiMad:mad,ampMad,
    source:source==='sim'?'simulated':'CSV replay'};
   // A compositional mobility index, NOT a diagnosed sympathetic activation.
   // It uses instantaneous pulse rate, robust IBI variation and pulse shape.
   const pulseSpeed=sat((recent.bpm-52)/68);
   const temporal=sat((mad/median)/.15);
   const shape=sat(ampMad/Math.max(.1,amp)/.35);
   this.initialMobility=sat(.50*pulseSpeed+.32*temporal+.18*shape);
   this.reason='Profilo iniziale stabilizzato; il tema PPG emerge gradualmente';
   return true;
  }
  goalChange(t){if(this.ready)this.goalAt=t;}
  musicMix(t){if(!this.ready)return 0;return ease((t-this.readyAt-3)/23);}
  // Musical activation != induced heart-rate change. This target is a gently
  // evolving musical pulse that stays tethered to the actual measured pulse.
  tempoTarget(t,observedIbi,mode,feedback){
   if(!this.ready)return Math.max(.38,observedIbi||.8);
   const base=this.baseline.bpm;
   const obs=sat(60/Math.max(.35,observedIbi||this.baseline.ibi),40,145);
   const goal={sleep:-.085,meditate:-.045,wake:.045,activate:.075}[mode]||0;
   const elapsed=Math.max(0,t-Math.max(this.readyAt,this.goalAt));
   const stage=ease((elapsed-24)/185);
   const diff=feedback?.delta||0;
   const reliable=feedback?.confidence>=.42;
   const manual=feedback?.manualVote==='tooIntense'&&t-feedback.manualTime<240;
   const contrary=reliable&&feedback?.score<-.28;
   const influence=manual?.08:(contrary?.16:1);
   // Do not prescribe extra acceleration when the observed baseline is already high.
   const highRateCaution=goal>0?sat((112-base)/22):1;
   const drift=base*goal*stage*influence*highRateCaution;
   const tracking=.8-.53*ease((elapsed-30)/100);
   const targetBpm=sat(base+tracking*(obs-base)+drift,Math.max(38,base-11),Math.min(134,base+11));
   return 60/targetBpm;
  }
  // Spectral density evolves after the PPG matching stage; in activation an
  // energetic opening is delayed, rather than present from the first note.
  energyShape(t,mode,feedback){
   if(!this.ready)return 0;
   const stage=ease((t-this.readyAt-4)/95);
   const base=.69+.22*this.initialMobility;
   const movement=(mode==='activate'?.22:mode==='wake'?.12:mode==='sleep'?-.10:-.045)*stage;
   const contrary=feedback?.confidence>=.42&&feedback.score<-.28;
   const manuallyBlocked=feedback?.manualVote==='tooIntense'&&t-feedback.manualTime<240;
   return sat(base+(contrary||manuallyBlocked?Math.min(0,movement):movement),.48,1.15);
  }
  status(t,mode,observedIbi,feedback){
   return {phase:this.phase,ready:this.ready,progress:this.progress,reason:this.reason,
    baseline:this.baseline,confidence:this.confidence,initialMobility:this.initialMobility,
    musicGain:this.musicMix(t),goal:mode,
    targetBpm:60/this.tempoTarget(t,observedIbi,mode,feedback),
    pulseBpm:observedIbi>0?60/observedIbi:null,
    elapsed:this.ready?Math.max(0,t-this.readyAt):0,
    source:this.baseline?.source||'not established'};
  }
 }
 return {Gate};
})();
