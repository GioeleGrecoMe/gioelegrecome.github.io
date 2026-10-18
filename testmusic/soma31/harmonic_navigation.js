/* SOMA 30: PPG-grounded tonal navigation. Harmonic grammar, not physiological diagnosis.
   Pure JS shared by AudioWorklet and deterministic tests. No audio-rate allocations. */
const SomaHarmony=(()=>{
 const limit=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 const mod=(v,n)=>((v%n)+n)%n;
 const SCALES={wake:[0,2,4,5,7,9,11],meditate:[0,2,3,5,7,9,10],sleep:[0,2,3,5,7,8,10],activate:[0,2,4,5,7,9,11]};
 const SYMBOL=['Do','Do♯','Re','Mi♭','Mi','Fa','Fa♯','Sol','La♭','La','Si♭','Si'];
 function profile(pulses){
  const x=pulses.filter(b=>b.q>=.75&&Number.isFinite(b.ibi)&&b.ibi>=.38&&b.ibi<=1.65).slice(-16);
  if(x.length<8)return null;
  const avg=(name)=>x.reduce((s,b)=>s+b[name],0)/x.length;
  const ibi=avg('ibi'),amp=avg('amp'),width=avg('width'),rise=avg('rise');
  const dev=Math.sqrt(x.reduce((s,b)=>s+(b.ibi-ibi)**2,0)/x.length);
  const diffs=x.slice(1).reduce((s,b,i)=>s+Math.abs(b.ibi-x[i].ibi),0)/Math.max(1,x.length-1);
  const spread=x.reduce((s,b)=>s+Math.abs(b.amp-amp)*.6+Math.abs(b.width-width)*1.7,0)/x.length;
  const slope=(x.at(-1).ibi-x[0].ibi)/Math.max(.4,ibi);
  const tempo=limit((ibi-.48)/.78),morph=limit((amp-.3)/.86),shape=limit((width-.11)/.23);
  const variability=limit((dev+diffs*.55)/.13);
  // Every dimension comes from reliable PPG; no seed, clock or random key assignment.
  const hue=limit(.34*tempo+.25*morph+.20*shape+.15*variability+.06*limit((rise-.05)/.20));
  const color=limit(.38*variability+.27*shape+.22*limit(spread/.1)+.13*morph);
  return {count:x.length,ibi,amp,width,rise,variability,color,hue,
   slope:limit(slope*7,-1,1),pc:Math.min(11,Math.floor(hue*12))};
 }
 function diatonic(mode,degree,ext=4,key=0){
  const scale=SCALES[mode],d=mod(degree,7),r=scale[d];let tones=[];
  for(let k=0;k<ext;k++){
   const idx=d+2*k;
   tones.push(scale[idx%7]+12*Math.floor(idx/7)-r);
  }
  const quality=tones[2]===6?'dim':tones[2]===8?'aug':tones[1]===4?'maj':tones[1]===3?'min':'other';
  const label=['I','II','III','IV','V','VI','VII'][d];
  // Relaxation anchors: open added ninth without a compulsory minor seventh.
  const openTonic=d===0&&(mode==='sleep'||mode==='meditate')&&ext>=4;
  if(openTonic)tones=[0,3,7,14];
  const name=`${SYMBOL[mod(key+r,12)]} ${quality}${openTonic?'(add9)':ext===5?'9':ext===4?'7':''}`;
  return {r,tones,name,degree:d,quality,function:label,mode,keyShift:0,pivot:false};
 }
 function chordPC(chord,root){return chord.tones.slice(0,3).map(x=>mod(root+chord.r+x,12)).sort((a,b)=>a-b);}
 function equals(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
 function pivotBetween(mode,oldRoot,newRoot,preference){
  const options=[];
  for(let a=0;a<7;a++)for(let b=0;b<7;b++){
   const c0=diatonic(mode,a,3,oldRoot),c1=diatonic(mode,b,3,newRoot);
   if(equals(chordPC(c0,oldRoot),chordPC(c1,newRoot))){
    let rating=(b===3?6:b===1?5:b===5?4:b===0?2:1)+(a===3?1:0)+((preference+b)%3)*.03;
    options.push({chord:c1,oldDegree:a,newDegree:b,rating});
   }
  }
  options.sort((a,b)=>b.rating-a.rating||a.newDegree-b.newDegree);
  if(!options.length)return null;
  const pick=options[Math.min(options.length-1,Math.floor(preference*options.length*.45))];
  return {...pick.chord,pivot:true,oldDegree:pick.oldDegree,function:`PIVOT ${pick.oldDegree+1}→${pick.newDegree+1}`};
 }
 class Navigator{
  constructor(mode='meditate'){this.reset(mode);}
  reset(mode){this.mode=mode;this.enabled=true;this.base=null;this.offset=0;this.cycle=-1;this.current=[];
   this.journal=[];this.lastMoveCycle=-99;this.recent='In attesa del PPG';this.pending=false;this.lastFingerprint=null;this.modulations=0;this.lastVoicing=null;}
  initialise(bio){if(!bio)return false;if(this.base===null){this.base=36+bio.pc;this.lastFingerprint=bio;this.recent='Tonica derivata da IBI e morfologia PPG';return true;}return false;}
  get root(){return this.base===null?41:this.base;}
  keyName(offset=this.offset){return SYMBOL[mod(this.root+offset,12)]+((this.mode==='wake'||this.mode==='activate')?' maggiore':this.mode==='meditate'?' dorico':' minore');}
  signalScore(bio){return bio?Math.round((bio.color*.68+bio.variability*.32)*8):0;}
  plan(bio,feedback={},reliable=true,time=0){
   if(this.base===null||!bio)return;
   this.cycle++;
   const level=feedback.enabled?feedback.level||0:0;
   const adverse=(feedback.decision==='sfavorevole'||feedback.decision==='ritorno'||(feedback.manualVote==='tooIntense'&&time-feedback.manualTime<240));
   const confident=feedback.confidence>=.42;
   let target=this.offset,why='evoluzione interna della progressione';
   const pace={sleep:2,meditate:2,wake:2,activate:2}[this.mode];
   // Allow exploration only after coherent dwell, except protective returns.
   const due=this.cycle>=pace&&this.cycle-this.lastMoveCycle>=pace&&reliable;
   if(this.enabled&&due){
    if(adverse&&confident&&this.offset!==0){target=this.offset>0?this.offset-5:this.offset+5;why='ritorno prudente per risposta avversa';}
    else if(!adverse){
     const motion=limit(.5+bio.slope*.17+bio.variability*.25);
     const direction=(motion+bio.hue*.29+this.cycle*.11)%1>.49?1:-1;
     // A fifth in pitch class, chosen in the nearest registration; one circle step only.
     const candidates=direction>0?[this.offset+7,this.offset-5]:[this.offset-7,this.offset+5];
     const permitted=candidates.filter(v=>Math.abs(v)<=10);
     const safe=permitted.sort((a,b)=>Math.abs(a)-Math.abs(b))[0];
     if(safe!==undefined){target=safe;why='modulazione di quinta guidata da IBI, forma e variabilità PPG';}
    }
   }
   const palette=this.signalScore(bio);
   const localKey=this.root+target;
   // Phrase forms are musical, but which functions/extensions are chosen depends on the PPG.
   const variant=mod(palette+this.cycle+Math.round(bio.slope*2),4);
   const calm=this.mode==='sleep'||this.mode==='meditate';
   const active=this.mode==='activate';
   const neutral=calm?[0,5,3,0]:[0,5,1,4];
   const choices=this.mode==='sleep'?[[0,5,3,0],[0,2,3,0],[0,3,5,0],[0,5,2,0]]:
    calm?[[0,5,3,0],[0,2,3,0],[0,3,1,0],[0,5,1,0]]:
    [[0,5,1,4],[0,2,3,4],[0,3,1,4],[0,5,3,4]];
   const degrees=choices[variant]||neutral;
   const toneExt=(degree,i)=>{
    if(this.mode==='sleep')return i===0||i===3?4:3;
    if(this.mode==='meditate')return degree===0?5:4;
    if(active)return bio.color>.34||level>=1?5:4;
    return bio.color>.32&&i===2?5:4;
   };
   let path=degrees.map((d,i)=>diatonic(this.mode,d,toneExt(d,i),localKey));
   // Activation starts with a bright major centre, progressing through harmonic
   // tension and release. This is compositional valence, not predicted emotion.
   // Major dominant as directed tension; resolve at the next tonic.
   if(active&&path[3].degree===4){path[3].tones[1]=4;path[3].name=SYMBOL[mod(localKey+7,12)]+' 7 (dominante)';}
   if(target!==this.offset){
    const pivot=pivotBetween(this.mode,this.root+this.offset,localKey,bio.color);
    if(pivot){
     path=[pivot,diatonic(this.mode,(variant%2?3:(this.mode==='sleep'?5:1)),calm?3:4,localKey),diatonic(this.mode,this.mode==='sleep'?3:4,active?4:3,localKey),diatonic(this.mode,0,calm?4:5,localKey)];
     if(active){path[2].tones[1]=4;path[2].name+=' · dominante maggiore';}
     this.offset=target;this.modulations++;this.lastMoveCycle=this.cycle;
     why+=` · ${pivot.name} condiviso dalle due tonalità`;
    }else why='Nessun accordo-pivot comune, modulazione rinviata';
   }
   for(const c of path){c.keyShift=this.offset;c.mode=this.mode;}
   this.current=path;this.recent=why;this.lastFingerprint=bio;
   this.journal.push({cycle:this.cycle+1,atKey:this.keyName(),why,progression:path.map(c=>c.name),pivot:!!path[0].pivot,features:{hue:bio.hue,color:bio.color,variability:bio.variability,ibi:bio.ibi}});
   if(this.journal.length>30)this.journal.shift();
  }
  chord(i){return this.current[mod(i,4)]||null;}
  status(){return {enabled:this.enabled,base:this.base,offset:this.offset,key:this.keyName(),mode:this.mode,cycle:this.cycle+1,
   modulations:this.modulations,why:this.recent,progression:this.current.map(c=>c.name),lastFingerprint:this.lastFingerprint,journal:this.journal.slice(-9),lastVoicing:this.lastVoicing};}
 }
 return {Navigator,profile,pivotBetween,diatonic,chordPC,SCALES};
})();
