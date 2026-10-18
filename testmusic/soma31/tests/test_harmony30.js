'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../harmonic_navigation.js'),'utf8');
const H=vm.runInNewContext(src+'\nSomaHarmony',{});
const PC=x=>(x%12+12)%12;
function signals(ibi=.81,amp=.70,width=.22,variability=.02){return Array.from({length:16},(_,i)=>({ibi:ibi+variability*Math.sin(i*.65),amp:amp+.03*Math.sin(.37*i),width:width+.01*Math.cos(.46*i),rise:.115+.01*Math.sin(i*.41),q:.96}));}
const pa=H.profile(signals(.80,.72,.22,.009)),pb=H.profile(signals(.80,.55,.27,.085)),pc=H.profile(signals(.62,.88,.15,.05));
assert(pa&&pb&&pc);assert(new Set([pa.pc,pb.pc,pc.pc]).size>=2, 'different PPG should influence key');
for(const mode of ['wake','sleep','meditate','activate']){
 for(const move of [-7,-5,5,7]){
  const pivot=H.pivotBetween(mode,40,40+move,.4);
  assert(pivot,`pivot exists for ${mode} ${move}`);
  const old=H.diatonic(mode,pivot.oldDegree,3,40);
  assert.deepEqual([...H.chordPC(pivot,40+move)],[...H.chordPC(old,40)],`real common triad ${mode} ${move}`);
 }
 const nav=new H.Navigator(mode);assert(nav.initialise(pa));assert(nav.root===36+pa.pc);
 for(let cycle=0;cycle<16;cycle++){
  nav.plan(pb,{enabled:true,level:2,decision:'favorevole',confidence:.9},true);
  assert.equal(nav.current.length,4);
  for(const c of nav.current){assert(c.tones.length>=3&&c.tones.every(Number.isFinite));assert.equal(c.keyShift,nav.offset);}
 }
 assert(nav.modulations>0,`${mode} should not repeat initial key forever`);
 assert(nav.journal.length>0);
 const prev=nav.offset;
 nav.plan(pb,{enabled:true,level:2,decision:'sfavorevole',confidence:.9},true);
 assert(Math.abs(nav.offset)<=Math.abs(prev),'adverse feedback must never move further from home key');
 const count=nav.modulations;
 nav.plan(pb,{enabled:true,level:2,decision:'favorevole',confidence:.9},false);
 assert.equal(nav.modulations,count,'no migration with missing PPG');
 console.log(mode,nav.keyName(),nav.modulations,'successful near-key modulations');
}
console.log('profiles',JSON.stringify({pa,pb,pc}));
