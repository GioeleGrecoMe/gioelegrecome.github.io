import test from 'node:test';
import assert from 'node:assert/strict';
import {createProbabilisticDepthAtlas,addDepthObservation,resolveProbabilisticDepthAtlas,hann01,overlapHannWeight} from '../js/reconstruction/probabilistic_depth_atlas.js';

test('probabilistic depth fusion preserves two incompatible surfaces instead of averaging them',()=>{
  const s=createProbabilisticDepthAtlas(1);
  for(let i=0;i<7;i++)addDepthObservation(s,0,.22+(i%2)*.002,.012,1);
  for(let i=0;i<5;i++)addDepthObservation(s,0,.78+(i%2)*.003,.014,.9);
  const r=resolveProbabilisticDepthAtlas(s),z=r.depth[0];
  assert.ok(Math.abs(z-.22)<.03,{z});assert.ok(Math.abs(z-.5)>.18,{z});assert.ok(r.ambiguity[0]>.05,r.ambiguity[0]);
});

test('compatible depth observations tighten the posterior rather than creating a seam mode',()=>{
  const s=createProbabilisticDepthAtlas(1);addDepthObservation(s,0,.50,.05,.7);const a=resolveProbabilisticDepthAtlas(s).sigma[0];for(let i=0;i<8;i++)addDepthObservation(s,0,.502+(i%3-1)*.002,.025,.9);const r=resolveProbabilisticDepthAtlas(s);assert.ok(r.sigma[0]<a,{before:a,after:r.sigma[0]});assert.ok(Math.abs(r.depth[0]-.502)<.01,r.depth[0]);
});

test('Hann feathering is applied only inside RGB overlap and keeps lone-source coverage',()=>{
  assert.equal(overlapHannWeight(0,30,100,60,1),1);assert.ok(overlapHannWeight(50,30,100,60,2)>.98);assert.ok(overlapHannWeight(1,30,100,60,2)<.15);assert.equal(hann01(0),0);assert.ok(Math.abs(hann01(1)-1)<1e-12);
});
