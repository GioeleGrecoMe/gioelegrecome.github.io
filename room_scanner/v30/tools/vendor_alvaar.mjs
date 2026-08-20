/**
 * Download and physically vendor the official AlvaAR dist bundle.
 * Run from v30/: npm run vendor:alva
 *
 * The downloaded file is validated before it replaces vendor/alva_ar.js:
 * - realistic size for the official single-file dist bundle
 * - required public API markers
 * - importable ES module exposing AlvaAR.Initialize
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {inspectAlvaSource} from '../js/slam/alva_runtime_loader.js';

const sources=[
  'https://raw.githubusercontent.com/alanross/AlvaAR/main/dist/alva_ar.js',
  'https://alanross.github.io/AlvaAR/dist/alva_ar.js',
  'https://cdn.jsdelivr.net/gh/alanross/AlvaAR@main/dist/alva_ar.js'
];
const out=new URL('../vendor/alva_ar.js',import.meta.url);

async function download(url){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),45000);
  try{
    const r=await fetch(url,{redirect:'follow',signal:c.signal,headers:{'user-agent':'room-scanner-v30-vendor-script'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const text=await r.text();
    const check=inspectAlvaSource(text);
    if(!check.ok)throw new Error(`invalid bundle: ${check.reason}`);
    return {text,check};
  }finally{clearTimeout(timer);}
}

let failure=[];
for(const source of sources){
  try{
    const {text,check}=await download(source);
    await fs.writeFile(out,text,'utf8');
    const sha=crypto.createHash('sha256').update(text).digest('hex');
    console.log(`PASS vendor:alva · ${check.bytes} bytes · sha256 ${sha} · ${source}`);
    process.exit(0);
  }catch(err){failure.push(`${source}: ${err?.message||err}`);}
}
console.error('FAIL vendor:alva · '+failure.join(' | '));
process.exit(1);
