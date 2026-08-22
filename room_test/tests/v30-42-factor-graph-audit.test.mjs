import test from 'node:test';
import assert from 'node:assert/strict';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';

test('photo-edge import audit exposes unresolved panorama constraints and survives persistence',()=>{
  const g=new ProbabilisticFactorGraph();
  g.frames=[{frameId:'a'},{frameId:'b'}];g.reindex();
  const n=g.addPhotoEdges([
    {aId:'a',bId:'b',visualConfidence:.8,matches:[]},
    {aId:'a',bId:'missing',visualConfidence:.9,matches:[]}
  ]);
  assert.equal(n,1);assert.equal(g.summary().photoEdgeInput,2);assert.equal(g.summary().photoEdgeUnresolved,1);assert.equal(g.summary().photoEdgeImportFraction,.5);
  const h=ProbabilisticFactorGraph.fromState(g.exportState());
  assert.equal(h.summary().photoEdgeInput,2);assert.equal(h.summary().photoEdgeUnresolved,1);assert.equal(h.summary().photoEdgeImportFraction,.5);
});
