import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('app import precedes full asset diagnostics',()=>{
  const b=read('js/boot.js'),app=b.indexOf("await import('./app.js')"),diag=b.lastIndexOf('scheduleDiagnostics();');
  assert.ok(app>=0&&diag>=0&&app<diag,'app.js must load before diagnostics');
  assert.doesNotMatch(b,/^import\s+\{?checkRuntimeAssets/m,'preflight must not be a static boot dependency');
});
test('core marks UI interactive immediately after bind',()=>{
  const a=read('js/app.js'),bind=a.indexOf('bind();'),mark=a.indexOf("dataset.v30Interactive='1'"),db=a.indexOf('new V30Database().open()');
  assert.ok(bind>=0&&mark>bind&&mark-bind<500,'interactive marker must immediately follow bind');assert.ok(db>mark,'IndexedDB must start after interactive marker');
});
test('preflight requests are bounded and parallel',()=>{const p=read('js/boot_preflight.js');assert.match(p,/AbortController/);assert.match(p,/Promise\.all\(paths\.map/);assert.match(read('js/boot.js'),/import\('\.\/boot_preflight\.js'\)/);});
test('pre-module recovery controls exist',()=>{const h=read('room_scanner_v30.html');assert.match(h,/hardRefresh/);assert.match(h,/interactive-timeout/);assert.match(h,/js\/boot\.js\?v=30\.10\.2/);});
test('missing one control cannot abort all event bindings',()=>{const a=read('js/app.js');assert.match(a,/ui-missing-control/);assert.match(a,/const on=\(id,type,handler,options\)=>/);assert.doesNotMatch(a,/\$\('[A-Za-z0-9]+'\)\.addEventListener/);});
