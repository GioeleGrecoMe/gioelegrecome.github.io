import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const failures=[];

function walk(dir){
  const out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.name==='node_modules') continue;
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

const files=walk(root);
for(const file of files){
  if(path.resolve(file)===path.resolve(import.meta.filename ?? fileURLToPath(import.meta.url))) continue;
  if(!/\.(?:js|mjs|html|json|md|txt)$/.test(file)) continue;
  const text=fs.readFileSync(file,'utf8');
  if(text.includes('../room_scanner/v30/') || text.includes('/room_scanner_v30_10_patch/')){
    failures.push(`${path.relative(root,file)}: riferimento alla vecchia gerarchia`);
  }
}

const info=JSON.parse(fs.readFileSync(path.join(root,'build_info.json'),'utf8'));
if(info.version!=='30.10.0') failures.push(`build_info.json: versione ${info.version} != 30.10.0`);
const html=fs.readFileSync(path.join(root,'room_scanner_v30.html'),'utf8');
if(!html.includes('V30.10.0')) failures.push('room_scanner_v30.html: badge V30.10.0 mancante');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
if(!sw.includes('room-scanner-v30.10.0-shell')) failures.push('sw.js: cache namespace V30.10.0 mancante');

if(failures.length){
  console.error('FAIL v30-layout');
  for(const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`PASS v30-layout · ${files.length} file sotto una sola radice v30/`);
