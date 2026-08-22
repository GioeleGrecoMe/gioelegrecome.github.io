import test from 'node:test';import assert from 'node:assert/strict';
import {SwitchableAlvaEdgeModel} from '../js/probabilistic/alva_switchable_edges.js';
const pose=(x=0,y=0)=>({p:[x,y,0],q:[0,0,0,1]});
const frame=(id,p)=>({frameId:id,posePrior:p,poseEstimate:{p:[...p.p],q:[...p.q]},poseCov:{diag:[.001,.001,.001,.0001,.0001,.0001]},trackingMode:'alvaar-wasm'});

test('independent photo-direction contradiction can selectively collapse Alva translation',()=>{const A=frame('a',pose(0,0)),B=frame('b',pose(.2,0)),m=new SwitchableAlvaEdgeModel([A,B]);B.poseEstimate=pose(0,.2);const c=new Map([['a',1],['b',1]]),rgb=new Map([['a',1],['b',1]]),imp=new Map([['a',.3],['b',.3]]);for(let i=0;i<5;i++)m.update([A,B],{rgbFrameSupport:rgb,poseImprovement:imp,translationContradiction:c});const e=m.edges[0];assert.ok(e.translationSwitch<.2,e);assert.ok(e.rotationSwitch>.7,e);});

test('Alva translation magnitude mismatch is weaker than direction mismatch',()=>{const A=frame('a',pose(0,0)),B=frame('b',pose(.2,0)),scale=new SwitchableAlvaEdgeModel([A,B]),wrongDir=new SwitchableAlvaEdgeModel([A,B]);const Bscale=frame('b',pose(.2,0));Bscale.poseEstimate=pose(.4,0);const Bdir=frame('b',pose(.2,0));Bdir.poseEstimate=pose(0,.2);for(let i=0;i<3;i++){scale.update([A,Bscale]);wrongDir.update([A,Bdir]);}assert.ok(scale.edges[0].translationSwitch>wrongDir.edges[0].translationSwitch*1.8,{scale:scale.edges[0],wrongDir:wrongDir.edges[0]});});
