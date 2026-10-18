/* SOMA 29 developer / biological response observability. */
'use strict';
const adaptiveChart={points:[]};
function drawAdaptive(){
 const cv=$('adaptTrend'),g=cv.getContext('2d'),W=cv.width,H=cv.height,l=51,r=18,t=20,b=34;
 g.clearRect(0,0,W,H);g.fillStyle='#0a1a21';g.fillRect(0,0,W,H);
 const recent=adaptiveChart.points.slice(-100),usable=recent.filter(v=>Number.isFinite(v.bpm));
 const minT=recent.length?recent[0].t:0,maxT=recent.length?recent.at(-1).t:120,span=Math.max(70,maxT-minT);
 const low=usable.length?Math.max(40,Math.floor(Math.min(...usable.map(v=>v.bpm))-5)):55;
 const high=usable.length?Math.min(175,Math.ceil(Math.max(...usable.map(v=>v.bpm))+5)):105;
 const y=v=>t+(high-v)/Math.max(2,high-low)*(H-t-b),x=v=>l+(v.t-minT)/span*(W-l-r);
 g.font='12px ui-sans-serif,system-ui';g.lineWidth=1;
 for(let i=0;i<=4;i++){const v=low+(high-low)*i/4,yy=y(v);g.strokeStyle='rgba(130,175,170,.15)';g.beginPath();g.moveTo(l,yy);g.lineTo(W-r,yy);g.stroke();g.fillStyle='#9bb7b4';g.textAlign='right';g.fillText(v.toFixed(0),l-10,yy+4);}
 for(let i=0;i<=4;i++){const xx=l+(W-l-r)*i/4;g.strokeStyle='rgba(130,175,170,.09)';g.beginPath();g.moveTo(xx,t);g.lineTo(xx,H-b);g.stroke();g.fillStyle='#9bb7b4';g.textAlign='center';g.fillText(((i-4)*span/4).toFixed(0)+' s',xx,H-11);}
 const draw=(series,col)=>{g.lineWidth=2.6;g.strokeStyle=col;g.beginPath();let started=false;for(const v of recent){if(!Number.isFinite(v[series])){started=false;continue;}const xx=x(v),yy=y(v[series]);if(!started)g.moveTo(xx,yy);else g.lineTo(xx,yy);started=true;}g.stroke();};
 draw('bpm','#7dd1bc');draw('base','#d9b48c');
 if(!usable.length){g.textAlign='center';g.fillStyle='#8db1b3';g.fillText('In attesa di finestre PPG affidabili',W/2,H/2);}
 g.fillStyle='#8db1b3';g.textAlign='left';g.fillText('BPM PPG',l,t-5);
}
function adaptiveUpdate(d){
 if(!d?.adaptive)return;
 const a=d.adaptive,base=a.baseline,newest=a.latest;
 const names={sleep:['ancoraggio','pedale profondo','quiete modale'],meditate:['centro','risonanze aperte','centro espanso'],wake:['apertura','movimento','nuove funzioni'],activate:['impulso','esplorazione','tensione controllata']};
 const stage=(names[d.mode]||names.meditate)[a.level];
 $('adaptiveState').textContent=`${stage} · livello ${a.level}/2 · ${a.decision}`;
 $('adaptiveReason').textContent=a.reason;
 $('adaptiveSource').textContent=`${a.source} · ${a.accepted} impulsi utilizzati · ${a.rejected} scartati`;
 $('adaptiveBaseline').textContent=base?base.bpm.toFixed(1)+' BPM · PRV-RMSSD '+(base.prv===null?'—':base.prv.toFixed(0)+' ms'):'in apprendimento';
 $('adaptiveRecent').textContent=newest?newest.bpm.toFixed(1)+' BPM · PRV-RMSSD '+(newest.prv===null?'—':newest.prv.toFixed(0)+' ms'):'finestra non disponibile';
 $('adaptiveScore').textContent=a.confidence>=.42?`${a.score>=0?'+':''}${a.score.toFixed(2)} · confidenza ${Math.round(a.confidence*100)}%`:'non valutabile';
 $('adaptiveDecision').textContent=`${a.transitions} migrazioni · ${a.cycles} cicli armonici · riferimento ${a.reference?a.reference.bpm.toFixed(1)+' BPM':'assente'}`;
 $('adaptiveSignal').textContent=`PPG ${Math.round(d.q*100)}% · microfono ${E.micOn?E.features.scene||'attivo':'spento'} · ambiente ${E.micOn?E.features.onset?.toFixed(2)||'0':'—'} · spettro uscita ${SP.init?'monitorato':'non attivo'}`;
 $('adaptiveCaution').textContent=d.source==='sim'?'SIMULAZIONE: il punteggio non dimostra un effetto della musica su un organismo reale.':
  'Trend PRV osservazionale: non identifica emozioni, fasi di sonno o un effetto causale.';
 const point={t:d.t,bpm:newest?.bpm||null,base:base?.bpm||null};
 if(!adaptiveChart.points.length||d.t<adaptiveChart.points.at(-1).t||d.t-adaptiveChart.points.at(-1).t>1.1){
  if(adaptiveChart.points.length&&d.t<adaptiveChart.points.at(-1).t)adaptiveChart.points.length=0;
  adaptiveChart.points.push(point);if(adaptiveChart.points.length>150)adaptiveChart.points.shift();drawAdaptive();
 }
 const log=a.history.slice(-6).reverse();
 $('adaptiveHistory').textContent=log.length?log.map(x=>`${x.t.toFixed(0)}s · livello ${x.level} · ${x.decision} · ${x.score>=0?'+':''}${x.score.toFixed(2)} · Δ ${x.dBpm.toFixed(1)} BPM`).join('\n'):'Nessuna risposta validata; ascolto iniziale in corso.';
}
$('adaptComfort').onclick=()=>{send({type:'userFeedback',value:'comfortable'});if(UI.master&&UI.ctx)UI.master.gain.setTargetAtTime(.78,UI.ctx.currentTime,2);$('adaptiveReason').textContent='Preferenza personale: confortevole.';};
$('adaptIntense').onclick=()=>{send({type:'userFeedback',value:'tooIntense'});if(UI.master&&UI.ctx)UI.master.gain.setTargetAtTime(Math.min(.58,UI.master.gain.value),UI.ctx.currentTime,1.5);$('adaptiveReason').textContent='Preferenza personale: troppo intenso. Riduzione graduale del livello digitale.';};
$('adaptiveEnabled').onchange=()=>send({type:'adaptiveControl',enabled:$('adaptiveEnabled').checked});
const originalUpdate=updateStatus;
updateStatus=function(d){originalUpdate(d);adaptiveUpdate(d);};
drawAdaptive();
