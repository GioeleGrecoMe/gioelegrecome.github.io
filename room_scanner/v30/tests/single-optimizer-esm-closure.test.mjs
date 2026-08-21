import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VERSION='30.40.0';
const rootRel='js/probabilistic/single_optimizer_runtime.js';
const importRe=/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function stripQuery(s){return s.split(/[?#]/,1)[0];}
function walk(rel,seen=new Set()){
  if(seen.has(rel))return seen;
  seen.add(rel);
  const abs=path.join(ROOT,rel);
  assert.ok(fs.existsSync(abs),`missing ESM dependency: ${rel}`);
  const src=fs.readFileSync(abs,'utf8');
  for(const m of src.matchAll(importRe)){
    const spec=m[1];
    if(!spec.startsWith('.'))continue;
    assert.match(spec,new RegExp(`\\?v=${VERSION.replaceAll('.','\\.')}(?:$|&)`),`${rel} has unversioned static import ${spec}`);
    const child=path.normalize(path.join(path.dirname(rel),stripQuery(spec))).replaceAll('\\','/');
    walk(child,seen);
  }
  return seen;
}

test('single optimizer transitive ESM closure is build-tagged and present',()=>{
  const seen=walk(rootRel);
  assert.ok(seen.size>=12,`closure unexpectedly small: ${seen.size}`);
  for(const required of [
    'js/probabilistic/joint_optimizer.js',
    'js/probabilistic/live_optimization_gate.js',
    'js/probabilistic/reliability_feedback.js',
    'js/reconstruction/submap_fusion.js',
    'js/dense/fusion_core.js',
    'js/slam/math.js'
  ]) assert.ok(seen.has(required),`closure did not reach ${required}`);
});

test('single optimizer root imports as a real ESM graph',async()=>{
  const href=pathToFileURL(path.join(ROOT,rootRel)).href+`?v=${VERSION}`;
  const mod=await import(href);
  assert.equal(typeof mod.SingleOptimizerRuntime,'function');
});

test('lazy loader evicts rejected imports and probes optimizer closure',()=>{
  const src=fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8');
  assert.match(src,/moduleCache\.delete\(path\)/);
  assert.match(src,/critical-module-closure-probe/);
  assert.match(src,/single_optimizer_runtime\.js/);
});
