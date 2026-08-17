const fs=require('fs'),assert=require('assert');const h=fs.readFileSync('room_scanner_v12.html','utf8'),g=fs.readFileSync('v14_cells.js','utf8');
const funcs=s=>[...s.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(x=>x[1]); for(const [n,s] of [['html',h],['core',g]]){const a=funcs(s);assert.equal(a.length,new Set(a).size,`${n} duplicate funcs`)}
const listeners=[...h.matchAll(/\$\('([^']+)'\)\.addEventListener\('([^']+)'/g)].map(m=>m[1]+':'+m[2]);assert.equal(listeners.length,new Set(listeners).size,'duplicate direct listeners');
assert(fs.statSync('room_scanner_v12.html').size<110000); assert(fs.statSync('v14_cells.js').size<35000);
console.log('audit ok',{html:fs.statSync('room_scanner_v12.html').size,core:fs.statSync('v14_cells.js').size,listeners:listeners.length});
