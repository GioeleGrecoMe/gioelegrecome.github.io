'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'room_scanner_v12.html'),'utf8'),geo=fs.readFileSync(path.join(root,'v14_cells.js'),'utf8');
const funcs=s=>[...s.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(m=>m[1]);
for(const [name,src] of [['html',html],['core',geo]]){const f=funcs(src);assert.equal(f.length,new Set(f).size,`${name} duplicate functions`)}
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'duplicate ids');
const listeners=[...html.matchAll(/\$\('([^']+)'\)\.addEventListener\('([^']+)'/g)].map(m=>`${m[1]}::${m[2]}`);assert.equal(listeners.length,new Set(listeners).size,'duplicate direct listeners');
assert.equal((html.match(/requestSession\('immersive-ar'/g)||[]).length,1);
assert.equal((html.match(/getUserMedia/g)||[]).length,0);assert.equal((html.match(/ImageCapture/g)||[]).length,0);assert.equal((html.match(/setInterval\(/g)||[]).length,0);
assert.ok(html.length<90000,`HTML unexpectedly large: ${html.length}`);assert.ok(geo.length<30000,`core unexpectedly large: ${geo.length}`);
console.log(`V14 audit tests: PASS · HTML funcs ${funcs(html).length} · core funcs ${funcs(geo).length} · IDs ${ids.length} · listeners ${listeners.length}`);
