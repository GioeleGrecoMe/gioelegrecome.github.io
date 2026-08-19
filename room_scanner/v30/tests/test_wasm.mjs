import fs from 'node:fs';
const bytes=fs.readFileSync(new URL('../wasm/slam_core.wasm',import.meta.url)),{instance}=await WebAssembly.instantiate(bytes,{}),e=instance.exports;
if(typeof e.max_width!=='function'||typeof e.max_height!=='function')throw new Error('WASM limits are not exported');
function frame(w,h,shift=0){const mem=new Uint8Array(e.memory.buffer,e.input_ptr(),w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const xx=Math.max(0,x-shift);mem[y*w+x]=((xx*17+y*11)^((xx>>3)*53)^((y>>3)*29))&255;}return e.process_frame(w,h,500,12);}
const a=frame(128,96),b=frame(128,96,3),m=e.match_count();if(a<10||b<10||m<3)throw new Error(`weak WASM features ${a}/${b}, matches ${m}`);
const pw=Math.min(270,e.max_width()),ph=Math.min(480,e.max_height());const portrait=frame(pw,ph);if(portrait<8)throw new Error(`weak portrait output ${portrait} at ${pw}x${ph}`);
console.log(`PASS wasm_frontend features=${b} matches=${m} portrait=${portrait}`);
