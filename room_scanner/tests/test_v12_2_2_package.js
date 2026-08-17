#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const root=path.join(__dirname,'..');
let fail=0;const ok=(c,m,d='')=>{if(c)console.log('PASS',m,d);else{console.error('FAIL',m,d);fail++}};
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),bi=JSON.parse(fs.readFileSync(path.join(root,'build_info.json'),'utf8'));
ok(bi.appBuild==='V12.2.2'&&bi.deployRev==='1222-object-obb-manager-20260817','build_info coerente V12.2.2');
ok(/room-scanner-v1222-core/.test(sw)&&/room-scanner-v1222-assets/.test(sw),'cache service worker dedicate V12.2.2');
ok(/version:'V12\.2\.2'/.test(sw)&&/1222-object-obb-manager-20260817/.test(sw),'service worker espone build corretta');
ok(/networkFirst\(req,CORE_CACHE\)/.test(sw),'HTML/worker/build-info network-first');
ok(/isHeavyAsset/.test(sw)&&/cacheFirst\(req\)/.test(sw),'ONNX/WASM cache on-demand');
ok(fs.existsSync(path.join(root,'room_scanner_v12.html')),'HTML presente');
if(fail)process.exit(1);console.log('\nTutti i test package V12.2.2 sono passati.');
