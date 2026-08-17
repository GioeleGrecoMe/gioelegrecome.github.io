#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),info=JSON.parse(fs.readFileSync(path.join(root,'build_info.json'),'utf8'));
let fail=0;const ok=(c,m)=>{if(c)console.log('PASS',m);else{console.error('FAIL',m);fail++}};
ok(info.appBuild==='V12.1.5'&&info.deployRev==='1215-persistent-structure-deep-projection-20260817','build_info allineato a V12.1.5');
ok(/room-scanner-v1215-core/.test(sw)&&/room-scanner-v1215-assets/.test(sw),'cache service worker versionate V12.1.5');
ok(/version:'V12\.1\.5'/.test(sw)&&/1215-persistent-structure-deep-projection-20260817/.test(sw),'service worker espone build V12.1.5');
ok(!/v1214|V12\.1\.4|v1009|V10\.0\.9/i.test(sw),'service worker non mantiene identita/cache precedenti');
ok(/room_scanner_v12\.html/.test(sw)&&/depth_ai_worker\.js/.test(sw),'core cache contiene pagina e worker corrente');
const core=(sw.match(/const CORE=\[[^;]+/s)||[''])[0]||'';ok(!/depth_anything_v2_small_q4\.onnx/.test(core),'modello ONNX non pre-caricato durante install');
ok(/isHeavyAsset/.test(sw)&&/cacheFirst/.test(sw),'ONNX/WASM cache on-demand preservata');
ok(/persistent structural semantics/i.test(info.processing),'build_info descrive il processing semantico persistente');
for(const f of ['README.md','README_V12_1_5.md','AUDIT_V12_1_5.md','UPLOAD_V12_1_5.txt','UNCHANGED_DEPENDENCIES.txt'])ok(fs.existsSync(path.join(root,f)),`${f} presente`);
const readme=fs.readFileSync(path.join(root,'README_V12_1_5.md'),'utf8');ok(/single Deep image cannot create an authoritative wall/i.test(readme)&&/at least three views/i.test(readme),'README documenta vincoli Deep strutturali');
ok(!fs.existsSync(path.join(root,'README_V12_1_4.md'))&&!fs.existsSync(path.join(root,'AUDIT_V12_1_4.md')),'documenti V12.1.4 obsoleti rimossi dal package');
if(fail)process.exit(1);console.log('\nTutti i test package V12.1.5 sono passati.');
