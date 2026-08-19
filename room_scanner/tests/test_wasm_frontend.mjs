import fs from 'node:fs/promises';
const bytes=await fs.readFile(new URL('../wasm/slam_core.wasm',import.meta.url));
const {instance}=await WebAssembly.instantiate(bytes,{}),e=instance.exports,mem=e.memory;
function frame(shift){const w=320,h=240,g=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const xx=x-shift;const a=((Math.floor(xx/18)+Math.floor(y/18))&1)?220:35;const dot=((xx%47+47)%47<5&&(y%43)<5)?35:0;g[y*w+x]=Math.max(0,Math.min(255,a+dot));}return {w,h,g};}
function run(f){new Uint8Array(mem.buffer,e.input_ptr(),f.w*f.h).set(f.g);const n=e.process_frame(f.w,f.h,900,14),m=e.match_count();return {n,m};}
e.reset();const a=run(frame(0)),b=run(frame(4));if(a.n<40)throw new Error(`too few features ${a.n}`);if(b.m<15)throw new Error(`too few matches ${b.m}`);console.log('PASS wasm_frontend',a,b);
