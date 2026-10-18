/* SOMA 30 / 09: explainable tonal path, reliable signal provenance, A/B. */
'use strict';
function harmonicUpdate(d){
 const h=d.harmonicNavigation;if(!h)return;
 $('harmonyKey').textContent=h.base===null?'In attesa del DNA PPG':`${h.key} · origine ${h.base} MIDI`;
 $('harmonyPlan').textContent=h.progression.length?h.progression.map((v,i)=>`${i+1}. ${v}`).join('   →   '):'Tonalità in preparazione';
 $('harmonyDecision').textContent=h.why;
 $('harmonyCycles').textContent=`${Math.max(0,h.cycle)} cicli · ${h.modulations} modulazioni verso tonalità vicine`;
 const f=h.lastFingerprint;
 $('harmonyPPG').textContent=f?`IBI ${Math.round(f.ibi*1000)} ms · variabilità ${Math.round(f.variability*100)}% · ampiezza ${f.amp.toFixed(2)} · larghezza ${Math.round(f.width*1000)} ms · colore ${Math.round(f.color*100)}%`: 'Ancora meno di otto impulsi attendibili';
 $('harmonyVoicing').textContent=h.lastVoicing?.length?`Voci reali MIDI: ${h.lastVoicing.join(' · ')} · ${d.score?.pivot?'accordo-pivot attivo':`${h.tiedTones||0} note comuni prolungate`}`:'Quattro voci in attesa';
 $('harmonyHistory').textContent=h.journal.slice(-7).reverse().map(x=>`Ciclo ${x.cycle} · ${x.atKey}${x.pivot?' · PIVOT':''}\n${x.progression.join(' → ')}`).join('\n\n')||'In attesa di una frase PPG';
}
$('harmonicEnabled').onchange=()=>send({type:'harmonicNavigationControl',enabled:$('harmonicEnabled').checked});
const beforeHarmonic=updateStatus;
updateStatus=function(d){beforeHarmonic(d);harmonicUpdate(d);};
