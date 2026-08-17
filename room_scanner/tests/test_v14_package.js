'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');const root=path.join(__dirname,'..');
for(const f of ['room_scanner_v12.html','v14_cells.js','sw.js','build_info.json','README_V14_0_1.md','AUDIT_V14_0_1.md'])assert.ok(fs.existsSync(path.join(root,f)),`missing ${f}`);
const bi=JSON.parse(fs.readFileSync(path.join(root,'build_info.json'),'utf8'));assert.equal(bi.version,'14.0.1');assert.match(bi.architecture,/capture stations/);
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');assert.match(sw,/room-scanner-v14\.0\.1-room-cells-capturefix/);assert.match(sw,/v14_cells\.js/);assert.ok(!/models\/depth_anything.*c\.add/.test(sw),'heavy model must not be install-precached');
console.log('V14 package tests: PASS');
