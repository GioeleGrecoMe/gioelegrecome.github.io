import test from 'node:test';
import assert from 'node:assert/strict';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';

const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240};
const frame=(id,x,{authority=true}={})=>({frameId:id,id,at:x,pose:{p:[x,0,0],q:[0,0,0,1]},K,width:320,height:240,gray:new Uint8Array(320*240),rgba:new Uint8ClampedArray(320*240*4),features:[],alvaPoseAuthority:authority});

test('post-scan PnP evidence attaches landmarks without creating a synthetic Alva edge',()=>{
  const graph=new ProbabilisticFactorGraph({maxFrames:12});graph.addFrame(frame('a',0));graph.addFrame(frame('b',.1));
  graph.landmarkFactors.push({id:'L1',refFrameId:'a',point:[0,0,2],descriptor:Array.from({length:20},(_,i)=>i),probability:.9,measurements:[{frameId:'a',u:160,v:120,probability:.9},{frameId:'b',u:150,v:120,probability:.8}]});
  graph.addFrame(frame('recovered',.05,{authority:false}));
  const linked=graph.addReferenceRelocalization('recovered',{observations:[{landmarkId:'L1',u:158,v:120,probability:.82}]});
  assert.equal(linked.attached,1);assert.equal(graph.alvaFactors.length,1,'recovery frame must not add an Alva relative factor');
  assert.ok(graph.landmarkFactors[0].measurements.some(x=>x.frameId==='recovered'&&x.recoveryPnP));
});
