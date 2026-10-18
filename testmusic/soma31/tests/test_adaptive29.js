const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'../adaptive_feedback.js'),'utf8');
const context={Math,Number,Array,Float32Array,console};vm.createContext(context);vm.runInContext(src+'\nthis.SOMA=SomaAdaptive',context);
const {PulseWindow,Controller,compare,PATHS}=context.SOMA;
function approx(a,b,tol=.01){assert(Math.abs(a-b)<tol,`${a} != ${b}`);}
for(const mode of ['meditate','sleep','wake','activate']){
 assert.equal(PATHS[mode].length,3);for(const path of PATHS[mode].slice(1)){
  assert.equal(path.length,4);for(const chord of path){assert(chord.tones.length>=3);assert(chord.tones.every(n=>Number.isFinite(n)&&n>=0&&n<=14));}
 }
}
let p=new PulseWindow();for(let i=0;i<65;i++)p.add(i*.85,.85+.008*Math.sin(i),.95,.7,.24);
assert(p.baseline && p.total===65);assert(p.stats(54,40).bpm>65);
let n=p.total;assert.equal(p.add(56,1.63,.95,.7,.24),false);assert(p.rejected>0);assert.equal(p.total,n);
let q=new PulseWindow();for(let i=0;i<33;i++)q.add(i*.8,.8,.4,.7,.24);
assert.equal(q.baseline,null);assert.equal(q.stats(25,40),null);
const baseline={bpm:73,prv:20,quality:.95,amp:.7,width:.2,count:40,span:39};
const same={...baseline,bpm:71,prv:21};
assert(compare('sleep',baseline,same,baseline).score>0);
assert(compare('meditate',baseline,{...same,bpm:80},baseline).score<0);
assert(compare('wake',baseline,{...same,bpm:75},baseline).score>0);
assert(compare('activate',baseline,{...same,bpm:92},baseline).score<0);
assert.equal(compare('sleep',baseline,{...same,amp:1.4},baseline).confidence,0);
assert.equal(compare('sleep',baseline,{...same,quality:.5},baseline).confidence,0);
for(const mode of ['sleep','meditate','wake','activate']){
 const c=new Controller(mode);const pulses={baseline,stats:()=>({...baseline,bpm:mode==='wake'||mode==='activate'?75:71,prv:22,t:200})};
 c.observe(45,pulses,{missing:true});assert.equal(c.decision,'pausa');
 c.observe(50,pulses,{});assert.equal(c.decision,'osservazione');
 c.observe(100,pulses,{acousticInstability:true});assert.equal(c.decision,'pausa');
 c.observe(120,pulses,{});c.observe(140,pulses,{});
 assert(c.history.length>0); // independently spaced delayed reviews
 c.boundary(160,pulses,{});c.boundary(300,pulses,{});c.boundary(440,pulses,{});
 assert(c.level>=0&&c.level<=2);
 c.setEnabled(false);assert.equal(c.boundary(600,pulses,{}),false);
}
// Force repeated adverse trials: rollback at musical boundary with reliable evidence.
const ctrl=new Controller('sleep');ctrl.reference=baseline;ctrl.latest={...baseline,bpm:82};ctrl.level=2;
ctrl.bestLevel=0;ctrl.epochAt=0;ctrl.evaluations=[-.8,-.7];ctrl.confidence=.9;ctrl.cycles=3;
assert(ctrl.boundary(200,{baseline},{}));assert.equal(ctrl.level,0);assert.equal(ctrl.decision,'ritorno');
// No migration if metric not reliable, even with strongly positive scores.
const ctrl2=new Controller('activate');ctrl2.reference=baseline;ctrl2.latest=baseline;ctrl2.evaluations=[.8,.8];ctrl2.confidence=.1;ctrl2.cycles=4;
assert.equal(ctrl2.boundary(240,{baseline},{}),false);assert.equal(ctrl2.level,0);
console.log('PASS adaptive29: 4 musical trajectories; PPG baseline, PRV, quality gating, delayed assessment, inhibition, direction of scores, bounded exploration and rollback');
