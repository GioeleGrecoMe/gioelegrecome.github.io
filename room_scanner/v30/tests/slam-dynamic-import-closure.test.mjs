import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const VERSION='30.38.1';

test('SLAM lazy module and its static dependency closure are shipped coherently', async()=>{
  const engine=path.join(ROOT,'js/slam/slam_engine.js');
  const bootstrap=path.join(ROOT,'js/slam/alva_metric_bootstrap.js');
  const math=path.join(ROOT,'js/slam/math.js');
  const uncertainty=path.join(ROOT,'js/probabilistic/pose_uncertainty.js');
  for(const file of [engine,bootstrap,math,uncertainty])assert.equal(fs.existsSync(file),true,`missing ${path.relative(ROOT,file)}`);
  const src=fs.readFileSync(engine,'utf8');
  assert.match(src,new RegExp(`\\./math\\.js\\?v=${VERSION.replaceAll('.','\\.')}`));
  assert.match(src,new RegExp(`\\./alva_metric_bootstrap\\.js\\?v=${VERSION.replaceAll('.','\\.')}`));
  assert.match(src,new RegExp(`\\.\\./probabilistic/pose_uncertainty\\.js\\?v=${VERSION.replaceAll('.','\\.')}`));
  const mod=await import(`${pathToFileURL(engine).href}?v=${VERSION}&test=1`);
  assert.equal(typeof mod.SlamEngine,'function');
  assert.equal(typeof mod.alvaMatrixToPose,'function');
});

test('lazy loader logs and retries dynamic module fetch failures',()=>{
  const app=fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8');
  assert.match(app,/dynamic-module-import-failed/);
  assert.match(app,/dynamic-module-import-retry-failed/);
  assert.match(app,/cache:'no-store'/);
  assert.match(app,/retry=\$\{Date\.now\(\)\}/);
});
