/* SOMA 29 — auditable conservative response-to-music controller.
 * Response is an observational PPG trend, NOT causal proof, emotional diagnosis,
 * clinical HRV or an identified sleep stage. No external dependencies / no allocations in audio loop.
 */
const SomaAdaptive=(()=>{
 const sat=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:NaN;};
 const PATHS={
  meditate:[
   null,
   [{name:'i(add9)',r:0,tones:[0,3,7,14]},{name:'VImaj9',r:8,tones:[0,4,7,11,14]},{name:'iv6(add9)',r:5,tones:[0,3,7,9,14]},{name:'i(sus2)',r:0,tones:[0,2,7,14]}],
   [{name:'i(add9)',r:0,tones:[0,3,7,14]},{name:'i(add11)',r:0,tones:[0,3,5,7]},{name:'VImaj7',r:8,tones:[0,4,7,11]},{name:'i(add9)/5',r:0,tones:[0,3,7,14]}]
  ],
  sleep:[
   null,
   [{name:'i(add9)',r:0,tones:[0,3,7,14]},{name:'i(sus2)',r:0,tones:[0,2,7,14]},{name:'iv(add9)',r:5,tones:[0,3,7,14]},{name:'i(add9)/5',r:0,tones:[0,3,7,14]}],
   [{name:'i(add9)',r:0,tones:[0,3,7,14]},{name:'i(add11)',r:0,tones:[0,3,5,7]},{name:'i(sus2)',r:0,tones:[0,2,7,14]},{name:'i(add9)/5',r:0,tones:[0,3,7,14]}]
  ],
  wake:[
   null,
   [{name:'Imaj9',r:0,tones:[0,4,7,11,14]},{name:'IVmaj9',r:5,tones:[0,4,7,11,14]},{name:'ii7',r:2,tones:[0,3,7,10]},{name:'Vsus4',r:7,tones:[0,5,7,10]}],
   [{name:'Imaj9',r:0,tones:[0,4,7,11,14]},{name:'iii7',r:4,tones:[0,3,7,10]},{name:'IVmaj9',r:5,tones:[0,4,7,11,14]},{name:'V7',r:7,tones:[0,4,7,10]}]
  ],
  activate:[
   null,
   [{name:'i(add9)',r:0,tones:[0,3,7,14]},{name:'bVImaj7',r:8,tones:[0,4,7,11]},{name:'bVII(add9)',r:10,tones:[0,4,7,14]},{name:'V7sus4',r:7,tones:[0,5,7,10]}],
   [{name:'i(add9,11)',r:0,tones:[0,3,5,7,14]},{name:'bVImaj9',r:8,tones:[0,4,7,11,14]},{name:'bIImaj7',r:1,tones:[0,4,7,11]},{name:'V7(b9)',r:7,tones:[0,4,7,10,13]}]
  ]
 };
 class PulseWindow{
  constructor(){this.samples=[];this.baseline=null;this.total=0;this.rejected=0;this.lastGoodTime=-1e9;}
  add(t,ibi,q,amp,width){
   if(!(Number.isFinite(t)&&Number.isFinite(ibi)&&Number.isFinite(q)&&Number.isFinite(amp)&&Number.isFinite(width))||q<.76||ibi<.38||ibi>1.65){this.rejected++;return false;}
   const tail=this.samples.slice(-7).map(s=>s.ibi);
   if(tail.length>=5&&Math.abs(ibi-med(tail))>Math.max(.13,med(tail)*.24)){this.rejected++;return false;}
   if(this.samples.length&&t<=this.samples[this.samples.length-1].t){this.rejected++;return false;}
   this.samples.push({t,ibi,q,amp,width});this.total++;this.lastGoodTime=t;
   while(this.samples.length>0&&t-this.samples[0].t>200)this.samples.shift();
   if(!this.baseline&&this.total>=26){const obs=this.stats(t,35);if(obs&&obs.count>=23)this.baseline={...obs,t};}
   return true;
  }
  stats(t,seconds=40){
   const arr=this.samples.filter(s=>s.t>=t-seconds&&s.t<=t);
   if(arr.length<15||arr[arr.length-1].t-arr[0].t<15||t-arr[arr.length-1].t>5)return null;
   const mean=arr.reduce((s,p)=>s+p.ibi,0)/arr.length;
   const diffs=[];for(let i=1;i<arr.length;i++){
    // Gaps in reliable PPG data cannot be treated as adjacent normal-normal intervals.
    if(arr[i].t-arr[i-1].t>Math.max(arr[i].ibi,arr[i-1].ibi)*1.9)continue;
    const delta=arr[i].ibi-arr[i-1].ibi;diffs.push(delta*delta);
   }
   const prv=diffs.length>=12?1000*Math.sqrt(diffs.reduce((a,b)=>a+b,0)/diffs.length):NaN;
   return {bpm:60/mean,prv:Number.isFinite(prv)?prv:null,quality:arr.reduce((s,p)=>s+p.q,0)/arr.length,
    amp:med(arr.map(s=>s.amp)),width:med(arr.map(s=>s.width)),count:arr.length,span:arr.at(-1).t-arr[0].t,t};
  }
  reset(){this.samples=[];this.baseline=null;this.total=0;this.rejected=0;this.lastGoodTime=-1e9;}
 }
 function compare(mode,reference,recent,personal){
  if(!reference||!recent||!personal)return {score:0,label:'no reference',confidence:0};
  if(recent.quality<.79||recent.count<20||recent.span<22||Math.abs(recent.amp-reference.amp)>Math.max(.20,.5*reference.amp)||Math.abs(recent.width-reference.width)>.12)return {score:0,label:'data unstable',confidence:0};
  const d=recent.bpm-reference.bpm;
  const prvRel=recent.prv!==null&&reference.prv!==null&&recent.prv>4&&reference.prv>4 ? sat(Math.log(recent.prv/reference.prv),-.5,.5):0;
  let reward;
  if(mode==='sleep')reward=-d/5+prvRel*.19;
  else if(mode==='meditate')reward=-d/6+prvRel*.23;
  else if(mode==='wake')reward=(d>=0?Math.min(d,3)/4:-Math.min(-d,5)/5)+prvRel*.08;
  else reward=(d>=0?Math.min(d,4)/5:-Math.min(-d,5)/5)+prvRel*.05;
  // Safety-first guard against over-arousal or sudden deviations.
  if((mode==='sleep'||mode==='meditate')&&d>5)reward=Math.min(reward,-.8);
  if((mode==='wake'||mode==='activate')&&(d>8||recent.bpm>Math.max(106,personal.bpm+17)))reward=Math.min(reward,-.9);
  if(Math.abs(d)>14)reward=Math.min(reward,-1);
  return {score:sat(reward,-1,1),confidence:sat((recent.quality-.70)/.25)*sat((recent.count-14)/22),
   delta:d,prvDelta:prvRel,label:'observational PPG trend'};
 }
 class Controller{
  constructor(mode='meditate'){this.reset(mode);}
  reset(mode){this.mode=mode;this.enabled=true;this.level=0;this.bestLevel=0;this.epoch=0;
   this.epochAt=0;this.reference=null;this.lastEvaluation=-1e9;this.lastBoundary=-1e9;this.lastMigration=-1e9;
   this.evaluations=[];this.score=0;this.confidence=0;this.delta=0;this.prvDelta=0;
   this.decision='attesa';this.reason='Raccolta della linea di base PPG';this.history=[];
   this.tried=[0,0,0];this.good=[0,0,0];this.bad=[0,0,0];this.cycles=0;this.transitions=0;
   this.latest=null;this.blockedReason='';this.pending=null;this.manualVote=null;this.manualTime=-1e9;}
  userFeedback(value,t){if(!['comfortable','tooIntense'].includes(value))return;
   this.manualVote=value;this.manualTime=t;this.history.push({t,level:this.level,score:0,dBpm:0,prv:null,decision:value==='tooIntense'?'ascoltatore: troppo intenso':'ascoltatore: confortevole'});
   if(this.history.length>70)this.history.shift();
   if(value==='tooIntense'){this.decision='attenzione';this.reason='Intervento esplicito: ridurre intensità e ritornare a una armonia familiare';}
   else{this.decision='preferenza';this.reason='Preferenza dell’ascoltatore annotata; mantenere monitoraggio PPG';}
  }
  setEnabled(v){this.enabled=!!v;if(!this.enabled){this.pending=null;this.decision='pausa';this.reason='Adattamento disabilitato; progressione invariata';}}
  status(){return {enabled:this.enabled,level:this.level,bestLevel:this.bestLevel,epoch:this.epoch,score:this.score,confidence:this.confidence,
   delta:this.delta,prvDelta:this.prvDelta,decision:this.decision,reason:this.reason,history:this.history.slice(-15),
   cycles:this.cycles,transitions:this.transitions,blocked:this.blockedReason,reference:this.reference,latest:this.latest};}
  observe(t,pulse,ctx={}){
   const recent=pulse.stats(t,40);this.latest=recent;
   if(!this.enabled)return;
   if(!pulse.baseline){this.decision='attesa';this.reason='Linea di base personale non ancora attendibile';return;}
   if(ctx.missing){this.decision='pausa';this.reason='PPG assente o non attendibile';this.evaluations=[];return;}
   if(ctx.acousticInstability){this.decision='pausa';this.reason='Evento acustico ambientale: risposta non attribuibile';this.evaluations=[];return;}
   if(!recent||recent.count<20||recent.quality<.79){this.decision='pausa';this.reason='Finestra PPG insufficiente';this.evaluations=[];return;}
   if(!this.reference){this.reference=recent;this.epochAt=t;this.decision='osservazione';this.reason='Prima finestra di riferimento';return;}
   // First several seconds after a harmonic move are not assigned to a response score.
   if(t-this.epochAt<38){this.decision='osservazione';this.reason='Risposta differita: nessun giudizio immediato';return;}
   if(t-this.lastEvaluation<16)return;
   this.lastEvaluation=t;
   const v=compare(this.mode,this.reference,recent,pulse.baseline);
   this.score=v.score;this.confidence=v.confidence;this.delta=v.delta||0;this.prvDelta=v.prvDelta||0;
   if(v.confidence<.42){this.decision='incerto';this.reason='Qualità, morfologia o continuità non sufficienti';return;}
   this.evaluations.push(v.score);if(this.evaluations.length>4)this.evaluations.shift();
   const avg=this.evaluations.reduce((a,b)=>a+b,0)/this.evaluations.length;
   // Two assessments and a deadband; no reward merely for listening to the same chord.
   if(this.evaluations.length<2){this.decision='osservazione';this.reason='Attesa di una seconda finestra indipendente';return;}
   if(avg>=.26){this.good[this.level]++;this.bestLevel=this.level;this.decision='favorevole';this.reason='Tendenza PPG compatibile con obiettivo (non prova causale)';}
   else if(avg<=-.32){this.bad[this.level]++;this.decision='sfavorevole';this.reason='Tendenza PPG opposta all’obiettivo, considerare ritorno';}
   else{this.decision='neutro';this.reason='Risposta indistinguibile da una variazione debole';}
   this.history.push({t,level:this.level,score:+avg.toFixed(3),dBpm:+this.delta.toFixed(2),prv:recent.prv,decision:this.decision});
   if(this.history.length>70)this.history.shift();
  }
  boundary(t,pulse,ctx={}){
   if(!this.enabled)return false;
   this.cycles++;
   if(this.manualVote==='tooIntense'&&this.level===0&&t-this.manualTime<240){
    this.decision='protezione';this.reason='Preferenza esplicita: nessuna nuova esplorazione per alcuni minuti';return false;
   }
   if(this.manualVote==='tooIntense'&&this.level>0){
    const old=this.level;this.level=Math.max(0,this.bestLevel<this.level?this.bestLevel:this.level-1);this.manualVote=null;
    this.epoch++;this.epochAt=t;this.lastMigration=t;this.reference=this.latest||this.reference;
    this.evaluations=[];this.score=0;this.confidence=0;this.transitions++;this.decision='ritorno';
    this.reason=`Feedback soggettivo: ritorno ${old} → ${this.level} al confine di ciclo`;return true;
   }
   if(!pulse.baseline||!this.reference||!this.latest||ctx.missing||ctx.acousticInstability||this.confidence<.42){
    this.decision='pausa';this.reason='Nessun cambio armonico senza evidenza affidabile';return false;
   }
   if(t-this.epochAt<65||t-this.lastMigration<60){this.reason='Persistenza: ascolto delle risposte lente';return false;}
   let next=this.level;
   const repeatedBad=this.evaluations.length>=2&&this.evaluations.slice(-2).every(s=>s<-.32);
   const repeatedGood=this.evaluations.length>=2&&this.evaluations.slice(-2).every(s=>s>.26);
   // Rollbacks return to safer familiar configuration; never promote under adverse feedback.
   if(repeatedBad){next=this.level>0?Math.max(0,this.bestLevel<this.level?this.bestLevel:this.level-1):0;this.decision='ritorno';}
   else if(this.level<2 && this.cycles>=2 && ((repeatedGood&&this.cycles>=3)||(this.evaluations.length>=2&&this.evaluations.slice(-2).every(s=>Math.abs(s)<.26)&&this.cycles>=4))){
    next=this.level+1;this.decision='esplorazione';
   }
   if(next===this.level){this.reason=repeatedGood?'Ripetizione stabile: risposta favorevole':'Persistenza o dati neutri: mantenere armonia';return false;}
   const previous=this.level;
   this.level=next;this.transitions++;this.tried[next]++;this.epoch++;this.epochAt=t;this.lastMigration=t;
   this.reference=this.latest;this.evaluations=[];this.score=0;this.confidence=0;
   this.reason=`${previous} → ${next}: ${this.decision}; cambiamento solo al confine di ciclo`;return true;
  }
 }
 return {PATHS,PulseWindow,Controller,compare};
})();
