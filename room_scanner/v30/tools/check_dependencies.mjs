import fs from 'node:fs';import path from 'node:path';import process from 'node:process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),refs=[];
function add(base,r){if(!r||/^(?:https?:|data:|blob:|#)/.test(r))return;const clean=r.split('?')[0].split('#')[0];if(!clean)return;refs.push(path.resolve(base,clean));}
for(const rel of ['room_scanner_v30.html','index.html']){const t=fs.readFileSync(path.join(root,rel),'utf8');for(const m of t.matchAll(/(?:src|href)=["']([^"']+)["']/g))add(root,m[1]);}
function walk(d){let o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);o=e.isDirectory()?o.concat(walk(p)):o.concat(p);}return o;}
for(const f of walk(path.join(root,'js')).concat(walk(path.join(root,'workers'))).filter(x=>/\.js$/.test(x))){const t=fs.readFileSync(f,'utf8'),base=path.dirname(f);for(const m of t.matchAll(/(?:from\s*|import\s*\(|import\s+)["'`]([^"'`]+)["'`]/g))if(m[1].startsWith('.'))add(base,m[1]);}
const cfg=fs.readFileSync(path.join(root,'js/config.js'),'utf8');for(const key of ['mvsWorker','gaussianWorker','wasmCore','serviceWorker','buildInfo']){const m=cfg.match(new RegExp(`${key}:'([^']+)'`));if(m)add(root,m[1]);}
const missing=[...new Set(refs)].filter(f=>!fs.existsSync(f));if(missing.length){console.error('FAIL dependency-closure');for(const f of missing)console.error(' -',path.relative(root,f));process.exit(1)}console.log(`PASS dependency-closure · ${new Set(refs).size} riferimenti locali risolti`);
