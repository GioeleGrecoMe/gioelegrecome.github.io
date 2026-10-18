/* SOMA 27 - passive ambient tonal tracking, no recording and no room-mode claims.
 * Work with FFT magnitudes in dBFS; audio and pitch inference stay local.
 * Pure module shared by the embedded browser script and Node regression tests.
 */
const SomaTonal = (() => {
 'use strict';
 const clamp = (x,a=0,b=1) => Math.min(b,Math.max(a,x));
 const cents = (a,b) => 1200*Math.log2(a/b);
 class Tracker {
  constructor(){this.tracks=[];this.lastTime=null;this.frame=0;}
  reset(){this.tracks=[];this.lastTime=null;this.frame=0;}
  peaks(spectrum,fs,rms){
   if(!(rms>.0013)||!Number.isFinite(rms))return [];
   const step=fs/(2*spectrum.length), min=Math.ceil(95/step), max=Math.min(spectrum.length-11,Math.floor(1250/step));
   const result=[];
   let strongest=-120;
   for(let i=min;i<=max;i++)if(Number.isFinite(spectrum[i])&&spectrum[i]>strongest)strongest=spectrum[i];
   if(strongest<-71)return [];
   for(let i=min;i<=max;i++){
    const d=spectrum[i];
    if(!Number.isFinite(d)||d<-69||d<strongest-25||d<spectrum[i-1]||d<=spectrum[i+1])continue;
    // Exclude the central lobe ( +/- 3 bins) from the local noise estimate.
    const neighbors=[];
    for(let j=i-12;j<=i+12;j++){
     if(j<1||j>=spectrum.length||Math.abs(j-i)<=3)continue;
     if(Number.isFinite(spectrum[j]))neighbors.push(spectrum[j]);
    }
    if(neighbors.length<8)continue;
    neighbors.sort((a,b)=>a-b);
    const floor=neighbors[Math.floor(neighbors.length/2)];
    const prominence=d-floor;
    if(prominence<10)continue;
    // 3-point quadratic spectral interpolation; valid for isolated peaks.
    const lo=spectrum[i-1],hi=spectrum[i+1];
    const denominator=lo-2*d+hi;
    const off=Math.abs(denominator)>1e-6?clamp(.5*(lo-hi)/denominator,-.5,.5):0;
    const hz=(i+off)*step;
    if(!(hz>=95&&hz<=1250))continue;
    const confidence=clamp((prominence-9)/17)*clamp((d+69)/32);
    if(confidence<.16)continue;
    result.push({hz,confidence,db:d,prominence});
   }
   result.sort((a,b)=>b.confidence-a.confidence||b.db-a.db);
   // Prevent redundant peaks from one spectral lobe / its immediate sidelobes.
   const unique=[];
   for(const p of result){if(unique.every(q=>Math.abs(cents(p.hz,q.hz))>43))unique.push(p);if(unique.length>=8)break;}
   return unique;
  }
  feed(spectrum,fs,rms,seconds){
   if(!Number.isFinite(seconds))return [];
   const dt=this.lastTime===null?.11:clamp(seconds-this.lastTime,.02,.5);
   this.lastTime=seconds;this.frame++;
   const candidates=this.peaks(spectrum,fs,rms);
   for(const track of this.tracks)track.seen=false;
   for(const p of candidates){
    let match=null,best=Infinity;
    for(const track of this.tracks){
     if(track.seen)continue;
     const d=Math.abs(cents(p.hz,track.hz));
     const tolerance=Math.max(26,1200*Math.log2((track.hz+fs/spectrum.length)/track.hz));
     if(d<tolerance&&d<best){match=track;best=d;}
    }
    if(!match){
     this.tracks.push({hz:p.hz,confidence:p.confidence,age:dt,hits:1,miss:0,seen:true});
    }else{
     match.hz*=Math.pow(p.hz/match.hz,.12); // estimate only, never frequency-modulate an existing oscillator
     match.confidence+=.20*(p.confidence-match.confidence);
     if(match.miss>.35){match.age=0;match.hits=0;} // require uninterrupted stability
     match.age+=dt;match.hits++;match.miss=0;match.seen=true;
    }
   }
   for(const track of this.tracks)if(!track.seen)track.miss+=dt;
   this.tracks=this.tracks.filter(t=>t.miss<1.5);
   return this.tones();
  }
  tones(){
   return this.tracks.filter(t=>t.age>=1.6&&t.hits>=10&&t.miss<.8&&t.confidence>.22)
    .sort((a,b)=>b.confidence-a.confidence).slice(0,3)
    .map(t=>({hz:+t.hz.toFixed(2),confidence:+(t.confidence*clamp((t.age-1.15)/1.2)*clamp((.8-t.miss)/.8)).toFixed(3),stable:+t.age.toFixed(1)}));
  }
 }
 return {Tracker,cents};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=SomaTonal;
