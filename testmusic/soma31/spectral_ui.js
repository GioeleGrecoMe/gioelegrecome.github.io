/* SOMA 28 - Developer spectral visualizations and final audio chain.
 * browser AnalyserNode FFT plots in dBFS; never claim ear SPL or ISO-226 phon calibration.
 */
const SP={room:new SomaSpectral.RoomField(),roomState:null,
  outputTimer:null,analyser:null,analyserR:null,fft:null,fftR:null,td:null,tdR:null,history:new Float32Array(324*128).fill(-120),
  columns:324,bands:128,fieldHz:SomaSpectral.frequencies(128,65,12500),
  lastOutput:null,care:.75,init:false};
const spectralModes={
 sleep:{name:'Sonno',low:-1.1,presence:-2.8,air:-4.2,cut:11300,threshold:-26,ratio:2.8,attack:.018,release:.50},
 meditate:{name:'Meditazione',low:-.65,presence:-2.0,air:-2.7,cut:14700,threshold:-24,ratio:2.5,attack:.013,release:.42},
 wake:{name:'Risveglio',low:0,presence:-.9,air:-.7,cut:18500,threshold:-22,ratio:2.3,attack:.010,release:.29},
 activate:{name:'Attivazione',low:.7,presence:-.6,air:.45,cut:19000,threshold:-18,ratio:2.0,attack:.008,release:.20}
};
function configureSpectralAudio(){
 const ctx=UI.ctx;
 const filter=(type,frequency,Q=1)=>{const n=ctx.createBiquadFilter();n.type=type;n.frequency.value=frequency;n.Q.value=Q;return n;};
 UI.subFilter=filter('highpass',32,.65);
 UI.lowShelf=filter('lowshelf',145,.75);
 UI.presenceFilter=filter('peaking',2950,.76);
 UI.airShelf=filter('highshelf',5600,.7);
 UI.airCut=filter('lowpass',17000,.72);
 UI.dynamics=ctx.createDynamicsCompressor();UI.dynamics.knee.value=19;
 UI.dynamics.threshold.value=-24;UI.dynamics.ratio.value=2.5;
 UI.dynamics.attack.value=.013;UI.dynamics.release.value=.4;
 UI.node.connect(UI.subFilter);UI.subFilter.connect(UI.lowShelf);
 UI.lowShelf.connect(UI.presenceFilter);UI.presenceFilter.connect(UI.airShelf);
 UI.airShelf.connect(UI.airCut);UI.airCut.connect(UI.dynamics);
 UI.dynamics.connect(UI.master);
 // Analyse channels separately: mono downmix could hide stereo anti-phase energy.
 // The AnalyserNodes are signal-transparent and are in the monitored stereo path.
 UI.outSplitter=ctx.createChannelSplitter(2);UI.outMerger=ctx.createChannelMerger(2);
 const configureAnalyser=()=>{const a=ctx.createAnalyser();a.fftSize=8192;
  a.minDecibels=-115;a.maxDecibels=-8;a.smoothingTimeConstant=.38;return a;};
 UI.outAnalyser=configureAnalyser();UI.outAnalyserR=configureAnalyser();
 UI.master.connect(UI.outSplitter);
 UI.outSplitter.connect(UI.outAnalyser,0,0);UI.outSplitter.connect(UI.outAnalyserR,1,0);
 UI.outAnalyser.connect(UI.outMerger,0,0);UI.outAnalyserR.connect(UI.outMerger,0,1);
 UI.outMerger.connect(ctx.destination);
 UI.stream=ctx.createMediaStreamDestination();UI.master.connect(UI.stream);
 SP.analyser=UI.outAnalyser;SP.analyserR=UI.outAnalyserR;
 SP.fft=new Float32Array(SP.analyser.frequencyBinCount);SP.fftR=new Float32Array(SP.analyserR.frequencyBinCount);
 SP.td=new Float32Array(SP.analyser.fftSize);SP.tdR=new Float32Array(SP.analyserR.fftSize);SP.init=true;
 applySpectralProfile();
 if(!SP.outputTimer)SP.outputTimer=setInterval(drawOutputSpectra,125);
}
function applySpectralProfile(){
 const c=UI.ctx,p=spectralModes[UI.mode]||spectralModes.meditate;
 $('spectralProfile').textContent=p.name+' · '+(UI.mode==='activate'?'accenti netti e contenuti':'transizioni e armoniche temperate');
 if(!c||!UI.presenceFilter){$('eqReadout').textContent='EQ attiva dopo Ascolta';return;}
 const now=c.currentTime,tau=.65,amount=SP.care;
 const set=(param,v)=>{param.cancelScheduledValues(now);param.setTargetAtTime(v,now,tau);};
 set(UI.lowShelf.gain,p.low*amount);set(UI.presenceFilter.gain,p.presence*amount);
 set(UI.airShelf.gain,p.air*amount);set(UI.airCut.frequency,p.cut);
 set(UI.dynamics.threshold,p.threshold);set(UI.dynamics.ratio,p.ratio);
 set(UI.dynamics.attack,p.attack);set(UI.dynamics.release,p.release);
 $('eqReadout').textContent=`sub ${signed(p.low*amount)} dB · presenza ${signed(p.presence*amount)} dB · aria ${signed(p.air*amount)} dB · soglia comp. ${p.threshold} dBFS`;
}
function signed(n){return (n>=0?'+':'')+n.toFixed(1);}
$('spectralCare').oninput=()=>{SP.care=+$('spectralCare').value/100;
 $('spectralCareOut').textContent=$('spectralCare').value+'%';applySpectralProfile();};
function resetRoomSpectrum(){SP.room.reset();SP.roomState=null;drawRoomSpectrum();}
$('roomReset').onclick=()=>{resetRoomSpectrum();eventLog('Memoria spettrale ambientale azzerata.','scene');};
function feedRoomSpectrum(db,fs,rms){SP.roomState=SP.room.feed(db,fs,rms,performance.now()/1000);drawRoomSpectrum();}
function sx(f,l,r,w){return l+Math.log(f/80)/Math.log(12500/80)*w;}
function labelHz(f){return f>=1000?(f/1000)+'k':String(f);}
function gridPlot(g,w,h,l,t,b,loY,hiY){
 const pw=w-l-15,ph=h-t-b;
 g.clearRect(0,0,w,h);g.fillStyle='#09161d';g.fillRect(0,0,w,h);
 g.font='19px ui-sans-serif,system-ui'; // overwritten below; keep label consistent in device-independent CSS pixels
 g.font='11px ui-sans-serif,system-ui';g.textAlign='center';
 for(const f of [100,200,500,1000,2000,5000,10000]){
  const x=sx(f,l,0,pw);g.strokeStyle='rgba(133,175,178,.15)';g.beginPath();g.moveTo(x,t);g.lineTo(x,t+ph);g.stroke();
  g.fillStyle='#91b0ae';g.fillText(labelHz(f),x,h-8);
 }
 for(let j=0;j<=4;j++){
  const value=hiY-(hiY-loY)*j/4,y=t+ph*j/4;
  g.strokeStyle='rgba(133,175,178,.15)';g.beginPath();g.moveTo(l,y);g.lineTo(l+pw,y);g.stroke();
  g.textAlign='right';g.fillStyle='#91b0ae';g.fillText(Math.round(value)+'',l-8,y+4);g.textAlign='center';
 }
 return {l,t,pw,ph};
}
function drawRoomSpectrum(){
 const el=$('roomResponseCanvas'),g=el.getContext('2d'),w=el.width,h=el.height;
 const axes=gridPlot(g,w,h,48,17,30,-30,30);
 const st=SP.roomState||SP.room.state();
 const path=(values,color,width)=>{if(!values)return;g.strokeStyle=color;g.lineWidth=width;g.beginPath();
  values.forEach((v,i)=>{const x=sx(st.freq[i],axes.l,0,axes.pw),y=axes.t+(30-SomaSpectral.clamp(v,-30,30))*axes.ph/60;
   if(i===0)g.moveTo(x,y);else g.lineTo(x,y);});g.stroke();};
 path(st.instant,'#ddbe87',1.55);path(st.stable,'#6fc7b2',2.6);
 if(E.micOn)for(const tone of E.tonalTones){const x=sx(tone.hz,axes.l,0,axes.pw);
  if(x<axes.l||x>axes.l+axes.pw)continue;
  g.strokeStyle='rgba(178,162,223,.7)';g.setLineDash([4,5]);g.beginPath();g.moveTo(x,axes.t);g.lineTo(x,axes.t+axes.ph);g.stroke();g.setLineDash([]);
 }
 const state=E.micOn?(st.converged?'impronta stabilizzata':st.age<12?'apprendimento':st.diff>3.2?'ambiente variabile':'verso la stabilizzazione'):'microfono spento';
 $('roomProgress').textContent=state;
 $('roomConvergence').textContent='Stabilizzazione: '+(st.age>=12?Math.round(st.stability*100)+'% · Δ '+st.diff.toFixed(1)+' dB':'in osservazione');
 $('roomHistory').textContent='Memoria: '+st.age.toFixed(0)+' s · '+st.frames+' finestre';
 $('roomProvenance').textContent=E.micOn?'FFT da microfono reale, nessun test attivo':'Nessun dato passivo attuale';
}
const logBounds=(f,start=65,end=12500)=>Math.log(f/start)/Math.log(end/start);
function palette(v){
 v=SomaSpectral.clamp((v+102)/65);
 if(v<.4)return [Math.round(9+v*40),Math.round(22+v*93),Math.round(31+v*115)];
 if(v<.75){const q=(v-.4)/.35;return [Math.round(25+q*105),Math.round(60+q*130),Math.round(89+q*90)];}
 const q=(v-.75)/.25;return [Math.round(130+q*105),Math.round(190+q*31),Math.round(179-q*80)];
}
function drawStft(){
 const canvas=$('outStftCanvas'),g=canvas.getContext('2d');
 const w=canvas.width,h=canvas.height,l=49,t=11,pw=w-l-16,ph=h-41;
 g.fillStyle='#0b1820';g.fillRect(0,0,w,h);
 const tmp=drawStft.tmp||(drawStft.tmp=document.createElement('canvas'));
 if(tmp.width!==SP.columns||tmp.height!==SP.bands){tmp.width=SP.columns;tmp.height=SP.bands;}
 const tg=tmp.getContext('2d'),pixels=tg.createImageData(SP.columns,SP.bands);
 for(let y=0;y<SP.bands;y++){
  const z=SP.bands-1-y,off=z*SP.columns;
  for(let x=0;x<SP.columns;x++){
   const [r,gg,b]=palette(SP.history[off+x]),idx=(y*SP.columns+x)*4;
   pixels.data[idx]=r;pixels.data[idx+1]=gg;pixels.data[idx+2]=b;pixels.data[idx+3]=255;
  }
 }
 tg.putImageData(pixels,0,0);g.imageSmoothingEnabled=true;g.drawImage(tmp,l,t,pw,ph);
 g.font='11px ui-sans-serif,system-ui';g.fillStyle='#8eafaf';g.textAlign='right';
 for(const f of [100,250,500,1000,2000,5000,10000]){
  const y=t+ph*(1-logBounds(f));
  g.strokeStyle='rgba(157,197,191,.12)';g.beginPath();g.moveTo(l,y);g.lineTo(l+pw,y);g.stroke();
  g.fillText(labelHz(f),l-7,y+3);
 }
 g.textAlign='center';for(let i=0;i<=4;i++){const x=l+pw*i/4;g.fillText(`${Math.round((i-4)*40.5/4)}s`,x,h-8);}
}
function drawOutputSpectra(){
 if(!SP.init||!SP.analyser||!UI.ctx||UI.ctx.state!=='running')return;
 SP.analyser.getFloatFrequencyData(SP.fft);SP.analyserR.getFloatFrequencyData(SP.fftR);
 SP.analyser.getFloatTimeDomainData(SP.td);SP.analyserR.getFloatTimeDomainData(SP.tdR);
 const fs=UI.ctx.sampleRate;
 const bandsL=SomaSpectral.logBands(SP.fft,fs,SP.fieldHz);
 const bandsR=SomaSpectral.logBands(SP.fftR,fs,SP.fieldHz);
 // Stereo power sum: avoids artificial cancellation from an L+R downmix.
 const bands=Float32Array.from(bandsL,(db,i)=>10*Math.log10((Math.pow(10,db/10)+Math.pow(10,bandsR[i]/10))*.5+1e-14));
 const bins=SP.columns,N=SP.bands;
 // Shift a 35 s waterfall, 1 column per ~125 ms; actual temporal history ~40.5 s.
 for(let i=0;i<N;i++){
  const off=i*bins;SP.history.copyWithin(off,off+1,off+bins);SP.history[off+bins-1]=bands[i];
 }
 drawStft();drawFinalSpectrum(bands);
 let sum=0,pk=0;
 for(let i=0;i<SP.td.length;i++){const x=SP.td[i],y=SP.tdR[i];sum+=x*x+y*y;pk=Math.max(pk,Math.abs(x),Math.abs(y));}
 const rms=Math.sqrt(sum/(SP.td.length*2)),db=x=>20*Math.log10(x+1e-12);
 const sub=bandAverage(bands,SP.fieldHz,75,180),mid=bandAverage(bands,SP.fieldHz,280,1400),presence=bandAverage(bands,SP.fieldHz,2400,5400);
 const hi=presence-mid,low=sub-mid;
 $('outMeters').textContent=`RMS ${db(rms).toFixed(1)} dBFS · picco campione ${db(pk).toFixed(1)} dBFS`;
 $('outBalance').textContent=`2.4–5.4k vs 0.3–1.4k: ${signed(hi)} dB · sub vs medi: ${signed(low)} dB`;
 $('outputStatus').textContent=pk>=.98?'Picchi campione prossimi a 0 dBFS — verifica il livello':
    `STFT attiva · ${Math.round(fs/1000)} kHz · 8192 punti`;
}
function bandAverage(bands,f,lo,hi){let s=0,n=0;
 for(let i=0;i<bands.length;i++)if(f[i]>=lo&&f[i]<=hi){s+=Math.pow(10,Math.max(-130,bands[i])/10);n++;}
 return n?10*Math.log10(s/n+1e-13):-120;
}
function drawFinalSpectrum(bands){
 const c=$('outSpectrumCanvas'),g=c.getContext('2d'),w=c.width,h=c.height;
 const a=gridPlot(g,w,h,49,14,30,-110,-20);
 const curve=(weight,col)=>{
  g.lineWidth=weight?1.3:2;g.strokeStyle=col;g.beginPath();
  bands.forEach((d,i)=>{
   const f=SP.fieldHz[i],v=d+(weight?SomaSpectral.weightedA(f):0);
   const x=sx(f,a.l,0,a.pw),y=a.t+SomaSpectral.clamp((-20-v)/90)*a.ph;
   if(i===0)g.moveTo(x,y);else g.lineTo(x,y);
  });g.stroke();
 };
 curve(false,'#90caca');curve(true,'#d0af7e');
}
// Initial placeholders render even with mic disabled / audio stopped.
drawRoomSpectrum();drawStft();drawFinalSpectrum(new Float32Array(SP.fieldHz.length).fill(-120));
