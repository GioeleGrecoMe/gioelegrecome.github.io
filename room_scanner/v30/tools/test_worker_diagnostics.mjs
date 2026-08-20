import fs from 'node:fs';
import vm from 'node:vm';
const workerPath = new URL('../workers/deep_depth_worker.js', import.meta.url);
let src = fs.readFileSync(workerPath, 'utf8');
src += `\n;globalThis.__diag={sampledByteSignature,sampledFloatSignature,depthSpatialStats,stripeDiagnosis,depthQualityDiagnosis,compareDepthMaps,readOutput,modelSourceKey,prepareInput,adaptiveInputGeometry};`;
const context={console,performance:{now:()=>0},navigator:{},postMessage(){},self:{},Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Float32Array,Float64Array,Int32Array,Math,Number,Array,Object,String,Set,Map,Error,TypeError,Infinity,NaN};
vm.createContext(context);vm.runInContext(src,context,{filename:'deep_depth_worker.js'});
const d=context.__diag;
function assert(ok,msg){if(!ok)throw new Error(msg);}
const dptPortrait=d.adaptiveInputGeometry(320,480,224);
assert(dptPortrait.width===224&&dptPortrait.height===336,'fast DPT resize must preserve portrait aspect with a true 224px short side');
const a=new Uint8ClampedArray(4*4*4);for(let i=0;i<a.length;i++)a[i]=(i*17)&255;
const b=a.slice();b[8]^=127;
assert(d.sampledByteSignature(a,4,4)!==d.sampledByteSignature(b,4,4),'frame fingerprint must react to changed camera bytes');
const smooth=new Float32Array(8*8);for(let y=0;y<8;y++)for(let x=0;x<8;x++)smooth[y*8+x]=x+y;
const columns=new Float32Array(8*8);for(let y=0;y<8;y++)for(let x=0;x<8;x++)columns[y*8+x]=x%2?10:0;
const oneAxisRamp=new Float32Array(32*24);for(let y=0;y<24;y++)for(let x=0;x<32;x++)oneAxisRamp[y*32+x]=1+x*.03;
const noise=new Float32Array(64*64);let seed=123456789;for(let i=0;i<noise.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise[i]=(seed&0xffff)/65535;}
const ss=d.stripeDiagnosis(d.depthSpatialStats(smooth,8,8));const cs=d.stripeDiagnosis(d.depthSpatialStats(columns,8,8));
assert(!ss.suspicious,'normal 2-D gradient should not be flagged as stripes');
const ramp=d.stripeDiagnosis(d.depthSpatialStats(oneAxisRamp,32,24));
assert(!ramp.suspicious&&ramp.columnExplained>.95&&ramp.columnCycles<1.1,'a monotonic slanted plane must not be mistaken for periodic banding');
assert(cs.suspicious&&cs.orientation==='vertical-columns','vertical column raster must be detected');
// Reproduce the phone failure more faithfully: broad vertical bands with rich
// high-frequency variation inside every band. A pure dx/dy test can miss this,
// but column-explained variance must still reject it.
const bw=112,bh=168,broadBands=new Float32Array(bw*bh);
for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){
  const band=(Math.floor(x/14)%2)*5;
  broadBands[y*bw+x]=band+.55*Math.sin(y*1.73)+.22*Math.sin((x*3+y*5)*.91);
}
const bs=d.stripeDiagnosis(d.depthSpatialStats(broadBands,bw,bh));
assert(bs.suspicious&&bs.columnExplained>.58&&bs.columnCycles>3,'broad phone-like vertical banding must be rejected by axis-explained variance plus repeated cycles');
const nq=d.depthQualityDiagnosis(d.depthSpatialStats(noise,64,64));
assert(nq.incoherent&&nq.suspicious,'isotropic random depth must be rejected even without stripes');
const cmp=d.compareDepthMaps(smooth,smooth.slice());assert(cmp.comparable&&Math.abs(cmp.correlation-1)<1e-6,'identical maps must correlate 1');
const read=await d.readOutput({predicted_depth:{dims:[1,2,3],type:'float32',data:new Float32Array([1,2,3,4,5,6])}},{width:3,height:2},{outputNames:['predicted_depth']});
assert(read.width===3&&read.height===2,'output HxW must come from the ONNX tensor');
assert(read.rawDepth[0]===1&&read.rawDepth[5]===6,'output must use the first row-major batch plane');
const keyA=d.modelSourceKey({id:'uploaded',bytes:new Uint8Array([1,2,3,4]).buffer});
const keyB=d.modelSourceKey({id:'uploaded',bytes:new Uint8Array([1,2,3,5]).buffer});
assert(keyA!==keyB,'different uploaded model bytes must not reuse the same ONNX session');
class FakeTensor{constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}}
const pixels=new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]);
const prepared=await d.prepareInput(pixels,2,2,{type:'float32'},{width:2,height:2},null,{Tensor:FakeTensor},true);
assert(prepared.inputRasterDiagnostic.tensorNchwPreview[0]===255&&prepared.inputRasterDiagnostic.tensorNchwPreview[1]===0,'NCHW preview must retain the top-left red pixel');
assert(prepared.inputRasterDiagnostic.tensorNchwPreview[4]===0&&prepared.inputRasterDiagnostic.tensorNchwPreview[5]===255,'NCHW preview must retain row-major top-right green pixel');
const resized=await d.prepareInput(pixels,2,2,{type:'float32'},{width:4,height:4},null,{Tensor:FakeTensor,fromImage(){throw new Error('must not be called');}},true);
assert(resized.preprocessBackend==='manual-rgba-nchw-bilinear','manual NCHW preprocessing must be the only production path');
assert(resized.inputRasterDiagnostic.tensorNchwPreview.length===4*4*4,'manual resize must produce the requested full tensor raster');
console.log(JSON.stringify({dptPortrait,frameHashA:d.sampledByteSignature(a,4,4),frameHashB:d.sampledByteSignature(b,4,4),smoothStripe:ss,oneAxisRamp:ramp,columnStripe:cs,broadBandStripe:bs,noiseQuality:nq,rowMajorOutput:[...read.rawDepth],nchwPreviewFirstPixels:[...prepared.inputRasterDiagnostic.tensorNchwPreview.slice(0,8)],modelKeysDiffer:keyA!==keyB,identicalComparison:cmp},null,2));
