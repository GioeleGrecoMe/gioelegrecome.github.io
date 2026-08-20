import fs from 'node:fs';
import vm from 'node:vm';
const workerPath = new URL('../room_scanner/v30/workers/deep_depth_worker.js', import.meta.url);
let src = fs.readFileSync(workerPath, 'utf8');
src += `\n;globalThis.__diag={sampledByteSignature,sampledFloatSignature,depthSpatialStats,stripeDiagnosis,compareDepthMaps,readOutput};`;
const context={console,performance:{now:()=>0},navigator:{},postMessage(){},self:{},Uint8ClampedArray,Uint16Array,Float32Array,Int32Array,Math,Number,Array,Object,String,Set,Map,Error,TypeError,Infinity,NaN};
vm.createContext(context);vm.runInContext(src,context,{filename:'deep_depth_worker.js'});
const d=context.__diag;
function assert(ok,msg){if(!ok)throw new Error(msg);}
const a=new Uint8ClampedArray(4*4*4);for(let i=0;i<a.length;i++)a[i]=(i*17)&255;
const b=a.slice();b[8]^=127;
assert(d.sampledByteSignature(a,4,4)!==d.sampledByteSignature(b,4,4),'frame fingerprint must react to changed camera bytes');
const smooth=new Float32Array(8*8);for(let y=0;y<8;y++)for(let x=0;x<8;x++)smooth[y*8+x]=x+y;
const columns=new Float32Array(8*8);for(let y=0;y<8;y++)for(let x=0;x<8;x++)columns[y*8+x]=x%2?10:0;
const ss=d.stripeDiagnosis(d.depthSpatialStats(smooth,8,8));const cs=d.stripeDiagnosis(d.depthSpatialStats(columns,8,8));
assert(!ss.suspicious,'normal 2-D gradient should not be flagged as stripes');
assert(cs.suspicious&&cs.orientation==='vertical-columns','vertical column raster must be detected');
const cmp=d.compareDepthMaps(smooth,smooth.slice());assert(cmp.comparable&&Math.abs(cmp.correlation-1)<1e-6,'identical maps must correlate 1');
console.log(JSON.stringify({frameHashA:d.sampledByteSignature(a,4,4),frameHashB:d.sampledByteSignature(b,4,4),smoothStripe:ss,columnStripe:cs,identicalComparison:cmp},null,2));
