/* SOMA 28 - diagnostic spectra. No SPL / phon measurement without physical calibration.
 * Pure, no microphone sample retention. FFT magnitudes are browser dBFS.
 */
const SomaSpectral = (() => {
 'use strict';
 const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
 const frequencies=(n,lo=90,hi=9000)=>Array.from({length:n},(_,i)=>lo*Math.pow(hi/lo,i/(n-1)));
 const median=a=>{const x=Array.from(a).sort((p,q)=>p-q);return x[Math.floor(x.length/2)];};
 const weightedA=f=>{ // IEC-style A frequency weighting, visualization ONLY (not a phon contour)
  const s=f*f;
  const num=(12200*12200)*s*s;
  const den=(s+20.6*20.6)*Math.sqrt((s+107.7*107.7)*(s+737.9*737.9))*(s+12200*12200);
  return 20*Math.log10(num/den)+2.0;
 };
 function logBands(db,fs,freq){
  if(!db?.length||!Number.isFinite(fs)||fs<=0)return new Float32Array(freq.length).fill(-110);
  const hzBin=fs/(2*db.length),result=new Float32Array(freq.length);
  for(let i=0;i<freq.length;i++){
   const lower=i===0?freq[i]/Math.sqrt(freq[1]/freq[i]):Math.sqrt(freq[i-1]*freq[i]);
   const upper=i===freq.length-1?freq[i]*Math.sqrt(freq[i]/freq[i-1]):Math.sqrt(freq[i]*freq[i+1]);
   const a=Math.max(1,Math.ceil(lower/hzBin)),b=Math.min(db.length-1,Math.floor(upper/hzBin));
   let power=0,n=0;
   if(a>b){const k=clamp(Math.round(freq[i]/hzBin),1,db.length-1);result[i]=Number.isFinite(db[k])?db[k]:-110;continue;}
   for(let k=a;k<=b;k++){let v=db[k];if(Number.isFinite(v)){power+=Math.pow(10,clamp(v,-140,10)/10);n++;}}
   result[i]=n?10*Math.log10(power/n+1e-14):-110;
  }
  return result;
 }
 class RoomField{
  constructor(n=58){this.freq=frequencies(n);this.reset();}
  reset(){this.fast=null;this.long=null;this.age=0;this.last=null;this.frames=0;this.diff=99;}
  feed(db,fs,rms,at){
   if(!Number.isFinite(at))return this.state();
   const dt=this.last===null?.12:clamp(at-this.last,.025,.5);this.last=at;
   if(!(rms>.0013))return this.state(); // Silence doesn't mean the room transfer is flat.
   const raw=logBands(db,fs,this.freq);
   const baseline=median(raw);
   const relative=Float32Array.from(raw,v=>clamp(v-baseline,-32,32));
   if(!this.fast){this.fast=relative.slice();this.long=relative.slice();this.age=dt;this.frames=1;return this.state();}
   const af=1-Math.exp(-dt/1.4),al=1-Math.exp(-dt/18);
   for(let i=0;i<relative.length;i++){
    this.fast[i]+=af*(relative[i]-this.fast[i]);
    this.long[i]+=al*(relative[i]-this.long[i]);
   }
   this.age+=dt;this.frames++;
   this.diff=Math.sqrt(this.fast.reduce((s,v,i)=>s+(v-this.long[i])**2,0)/this.fast.length);
   return this.state();
  }
  state(){
   // Convergence = consistent *recorded ambient spectrum*, not identified acoustic impulse response.
   const stability=(!this.fast||this.age<12)?0:clamp((4.5-this.diff)/3.6)*clamp((this.age-12)/18);
   return {freq:this.freq,instant:this.fast,stable:this.long,age:this.age,diff:this.diff,stability,converged:stability>.78&&this.age>=23,frames:this.frames};
  }
 }
 return {RoomField,frequencies,logBands,weightedA,clamp};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=SomaSpectral;
