import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);const read=p=>fs.readFileSync(new URL(p,root),'utf8');
test('minimal boot imports the versioned core and depth diagnostic',()=>{const b=read('js/boot.js');for(const m of ['app.js','deep_diagnostic_controller.js'])assert.match(b,new RegExp(`import\\('\\./${m.replace('.', '\\.')}\\?v=30.26.0'\\)`));assert.doesNotMatch(b,/deep_live_controller/);for(const x of ['boot_preflight','V30Database','serviceWorker.register','gaussian_metric_tap'])assert.doesNotMatch(b,new RegExp(x));});
test('HTML registers a normal service worker without a stale-controller gate',()=>{const h=read('room_scanner_v30.html');assert.match(h,/register\('sw\.js',\{scope:'\.\/',updateViaCache:'none'\}\)/);assert.match(h,/controllerchange/);assert.match(h,/loadModule\(\)/);for(const stale of ['roomscan-v30-sw-clean-attempt','new MessageChannel','GET_VERSION','getRegistrations'])assert.doesNotMatch(h,new RegExp(stale));const s=read('sw.js');assert.match(s,/const VERSION = '30.26.0'/);assert.match(s,/event\.data\?\.type === 'GET_VERSION'/);});
test('service worker is atomic and network-first for versioned runtime assets',()=>{const s=read('sw.js');assert.match(s,/throw new Error\(`V30 shell missing/);assert.match(s,/async function networkFirst/);assert.match(s,/new Request\(request, \{ cache: 'no-store' \}\)/);assert.match(s,/pathname\.endsWith\('\.onnx'\)/);assert.doesNotMatch(s,/Cache-first for versioned static assets/);});

test('AlvaAR official runtime is managed by its dedicated validated cache without gating shell install',()=>{
  const s=read('sw.js'),loader=read('js/slam/alva_runtime_loader.js');
  assert.match(s,/alva_runtime_loader\.js/);
  assert.doesNotMatch(s,/SHELL=\[[^\]]*dist\/alva_ar\.js/s);
  assert.match(loader,/room-scanner-alvaar-official-v1/);
  assert.match(loader,/ALVA_EXPECTED_MIN_BYTES/);
  assert.match(loader,/inspectAlvaSource/);
  assert.match(loader,/cachesImpl/);
});
