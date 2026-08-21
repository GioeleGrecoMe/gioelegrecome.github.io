import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('minimal boot imports core first and keeps diagnostics optional',()=>{
  const b=read('js/boot.js');
  assert.match(b,/import\('\.\/app\.js\?v=30\.40\.0'\)/);
  assert.match(b,/import\('\.\/deep_diagnostic_controller\.js\?v=30\.40\.0'\)/);
  assert.match(b,/optional-diagnostics-module-error/);
  assert.match(b,/pre\.coreLoaded=true/);
  assert.doesNotMatch(b,/deep_live_controller/);
  for(const x of ['boot_preflight','V30Database','serviceWorker.register','gaussian_metric_tap'])assert.doesNotMatch(b,new RegExp(x));
});

test('HTML uses an atomic service-worker controller handshake before modules',()=>{
  const h=read('room_scanner_v30.html');
  for(const token of ['waitForAtomicController','GET_VERSION','published-coherent','refreshStyles','atomicBootRecoveryBtn','boot.recover=hardRecover'])assert.match(h,new RegExp(token));
  assert.match(h,/register\(`sw\.js\?build=\$\{VERSION\}`/);
  assert.match(h,/info\?\.version===VERSION/);
  assert.doesNotMatch(h,/reloadForNewController/);
  assert.doesNotMatch(h,/controllerchange',reloadForNewController/);
});

test('service worker activates without a blocking precache and is network-first',()=>{
  const s=read('sw.js');
  assert.match(s,/const VERSION = '30\.40\.0'/);
  assert.match(s,/const CACHE = `room-scanner-v\$\{VERSION\}-shell`/);
  assert.match(s,/event\.waitUntil\(self\.skipWaiting\(\)\)/);
  assert.match(s,/self\.clients\.claim\(\)/);
  assert.match(s,/async function networkFirst/);
  assert.match(s,/new Request\(request, \{ cache: 'no-store' \}\)/);
  assert.match(s,/event\.data\?\.type === 'GET_VERSION'/);
  assert.match(s,/pathname\.endsWith\('\.onnx'\)/);
  assert.doesNotMatch(s,/V30 shell missing/);
  assert.doesNotMatch(s,/const SHELL = \[/);
});

test('force update clears only shell caches, preserving model/runtime caches and IndexedDB',()=>{
  const app=read('js/app.js');
  assert.match(app,/CLEAR_V30_SHELL/);
  assert.match(app,/\^room-scanner-v\.\*-shell\$/);
  assert.doesNotMatch(app,/startsWith\('room-scanner-alvaar'\)/);
  assert.doesNotMatch(app,/indexedDB\.deleteDatabase/);
});
