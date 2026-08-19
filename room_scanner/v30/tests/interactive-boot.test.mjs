import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);const read=p=>fs.readFileSync(new URL(p,root),'utf8');
test('core has no heavy static imports before UI binding',()=>{const a=read('js/app.js');for(const x of ["from './camera.js'","from './storage/db.js'","from './xr/xr_calibration.js'","from './slam/wasm_frontend.js'","from './gaussian/renderer.js'"])assert.doesNotMatch(a,new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(a,/function lazy\(path\)/);});
test('core marks UI interactive before detached background initialization',()=>{const a=read('js/app.js'),bind=a.indexOf('bind();'),mark=a.indexOf("dataset.v30Interactive='1'"),bg=a.indexOf('void initBackground()');assert.ok(bind>=0&&mark>bind,'bind must precede interactive mark');assert.ok(bg>mark,'background init must start after interactive mark');});
test('calibration buttons are bound independently',()=>{const a=read('js/app.js');for(const id of ['calibAddPinBtn','calibUndoPinBtn','calibFinishBtn','calibCancelBtn'])assert.match(a,new RegExp(`on\\('${id}'`));assert.match(a,/ui-missing-control/);});
test('diagnostics and service worker are not startup gates',()=>{const a=read('js/app.js');assert.match(a,/setTimeout\(async\(\)=>\{/);assert.match(a,/serviceWorker\.register/);assert.match(a,/void initBackground\(\)/);const b=read('js/boot.js');assert.doesNotMatch(b,/self_test|serviceWorker|indexedDB|boot_preflight/);});
