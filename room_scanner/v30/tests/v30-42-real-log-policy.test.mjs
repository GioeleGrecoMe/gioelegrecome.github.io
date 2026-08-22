import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRgbConsensusPolicy} from '../js/probabilistic/rgb_consensus_policy.js';

test('real V30.41 pre-commit RGB state is classified as collapsed and cannot commit',()=>{
  const p=evaluateRgbConsensusPolicy({edges:24,active:0,weak:4,rejected:20,mean:0.04401778788209259});
  assert.equal(p.collapsed,true);assert.equal(p.commitReady,false);
});

test('real V30.41 reconcile state still cannot authorize committed dense geometry',()=>{
  const p=evaluateRgbConsensusPolicy({edges:24,active:0,weak:16,rejected:8,mean:0.1973697081627729});
  assert.equal(p.collapsed,false);assert.equal(p.commitReady,false);
});

test('moderately distributed RGB consensus can authorize commit without requiring every edge active',()=>{
  const p=evaluateRgbConsensusPolicy({edges:24,active:4,weak:14,rejected:6,mean:.31});
  assert.equal(p.collapsed,false);assert.equal(p.commitReady,true);
});
