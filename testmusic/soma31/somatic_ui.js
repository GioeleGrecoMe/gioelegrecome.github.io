/* SOMA 31 / 10 — physiological onset visibility. */
'use strict';
function somaticUpdate(d){
 const o=d.onset;
 if(!o)return;
 const phases={listening:'Ascolto del corpo · nessuna musica',emerging:'Emersione del tema PPG',active:'Navigazione adattiva'};
 const phase=phases[o.phase]||o.phase;
 const progress=o.ready?Math.max(0,Math.min(1,o.musicGain)):(o.progress||0);
 const pc=Math.round(progress*100);
 $('startPhase').textContent=phase;
 $('startProgress').style.width=pc+'%';
 $('startExplanation').textContent=o.reason;
 $('onsetStage').textContent=phase;
 $('onsetProgress').style.width=pc+'%';
 $('onsetWhy').textContent=o.reason;
 const b=o.baseline;
 $('onsetBpm').textContent=b?`${b.bpm.toFixed(1)} BPM · ${Math.round(b.ibi*1000)} ms`:'non disponibile';
 $('onsetVariability').textContent=b?`PRV ${b.prv===null?'—':b.prv.toFixed(0)+' ms'} · IBI MAD ${Math.round(b.ibiMad*1000)} ms`:'non disponibile';
 $('onsetConfidence').textContent=b?`${Math.round(o.confidence*100)}% · mobilità compositiva ${Math.round(o.initialMobility*100)}%`:'non valutabile';
 const mode={sleep:'Sonno: discesa musicale graduale',meditate:'Meditazione: quiete e stabilità',wake:'Risveglio: apertura moderata',activate:'Attivazione: energia graduale'};
 $('onsetGoal').textContent=mode[d.mode]||d.mode;
 $('onsetPulseTempo').textContent=Number.isFinite(o.pulseBpm)?o.pulseBpm.toFixed(1)+' BPM':'—';
 $('onsetMusicTempo').textContent=d.score?.started?(60/d.score.beatSeconds).toFixed(1)+' BPM':'in attesa';
 $('onsetTargetTempo').textContent=o.ready?o.targetBpm.toFixed(1)+' BPM':'in attesa';
 $('onsetBlend').textContent=`musica ${Math.round(o.musicGain*100)}% · impulso diretto ${Math.round(d.direct*100)}%`;
 $('startSourceWarning').textContent=d.source==='sim'?'PPG SIMULATO: dimostra il comportamento, non una reazione umana.':
   'PPG DA CSV: riflette una registrazione reale, ma la riproduzione non può reagire fisiologicamente alla musica che sta ascoltando ora.';
 $('onsetInterpretation').textContent=d.source==='sim'?'L’eccitazione è un indice compositivo del segnale simulato; non è uno stato emotivo umano.':
   'Il matching musicale segue la registrazione. Solo con un PPG live e misure valide si potrà studiare una risposta al suono.';
 if(!o.ready){
  $('stageName').textContent=phase;
  $('lineage').textContent=`${d.adaptive?.accepted||0} impulsi validi · ${d.adaptive?.rejected||0} scartati · nessuna armonia prima della baseline`;
  $('scoreHarmony').textContent='Solo battito · acquisizione del profilo';
  $('scoreForm').textContent=o.reason;
 }else if(o.phase==='emerging'){
  $('stageName').textContent=`Emersione · mix ${Math.round(o.musicGain*100)}%`;
 }
}
const previousOnsetUpdate=updateStatus;
updateStatus=function(d){previousOnsetUpdate(d);somaticUpdate(d);};
