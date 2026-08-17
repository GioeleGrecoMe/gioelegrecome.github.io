#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),info=JSON.parse(fs.readFileSync(path.join(root,'build_info.json'),'utf8'));
let fail=0;const ok=(c,m)=>{if(c)console.log('PASS',m);else{console.error('FAIL',m);fail++}};
ok(info.appBuild==='V12.1.4'&&info.deployRev==='1214-audit-batch-memory-20260817','build_info allineato alla pagina');
ok(/room-scanner-v1214-core/.test(sw)&&/room-scanner-v1214-assets/.test(sw),'cache service worker versionate V12.1.4');
ok(!/v1009|V10\.0\.9|room-acoustic-v1009/i.test(sw),'service worker non mantiene identità V10');
ok(/room_scanner_v12\.html/.test(sw)&&/depth_ai_worker\.js/.test(sw),'core cache punta alla V12 e al worker corrente');
ok(!/depth_anything_v2_small_q4\.onnx/.test((sw.match(/const CORE=\[[^;]+/s)||[''])[0]||''),'modello ONNX non viene precaricato durante install');
ok(/isHeavyAsset/.test(sw)&&/cacheFirst/.test(sw),'ONNX/WASM sono cache on-demand');
ok(fs.existsSync(path.join(root,'UNCHANGED_DEPENDENCIES.txt')),'manifest dipendenze invariate presente');
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');ok(/V12\.1\.4/.test(readme)&&!/Room Scanner V12\.1\.3/.test(readme),'README di deploy allineato a V12.1.4');
ok(fs.existsSync(path.join(root,'AUDIT_V12_1_4.md'))&&fs.existsSync(path.join(root,'UPLOAD_V12_1_4.txt')),'audit e istruzioni upload inclusi');
if(fail)process.exit(1);console.log('\nTutti i test package V12.1.4 sono passati.');
