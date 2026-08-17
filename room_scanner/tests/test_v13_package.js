'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');const root=path.join(__dirname,'..');
for(const f of ['room_scanner_v12.html','v13_geometry.js','sw.js','build_info.json','README_V13_0_0.md','AUDIT_V13_0_0.md'])assert.ok(fs.existsSync(path.join(root,f)),`missing ${f}`);
const bi=JSON.parse(fs.readFileSync(path.join(root,'build_info.json'),'utf8'));assert.equal(bi.version,'13.0.0');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');assert.match(sw,/room-scanner-v13\.0\.0-rigid-room/);assert.match(sw,/v13_geometry\.js/);assert.ok(!/models\/depth_anything.*c\.add/.test(sw));
console.log('V13 package tests: PASS');
