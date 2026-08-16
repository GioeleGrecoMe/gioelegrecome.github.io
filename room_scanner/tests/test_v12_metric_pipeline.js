'use strict';
/* Contract test for the V12 gate. It intentionally tests the acceptance
   primitive without a browser: regression must choose a metric transform only
   from WebXR anchors and the page must retain the native/multi-view/plane gate
   before a Deep point can become a surfel. */
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('room_scanner_v12.html','utf8');
for(const token of [
  'V12.0.0', 'function regression(a)', 'function supportOtherView(k,p)',
  "if(!nativeOK&&!multi&&!plane){rejected++;continue}",
  "S.manualPhotoPending=true", 'captureCamera(frame,pose,true)',
  "new Worker(`./depth_ai_worker.js?rsbuild=${REV}`)",
  'schema:\'room-scanner-v12-raw\'', 'function captureNativeOnly(frame,pose)',
  'function updateMeshes(frame)'
]) if(!src.includes(token)) throw new Error('missing V12 contract: '+token);
if(/\b(?:MobileSAM|SAM)\b/.test(src)) throw new Error('V12 must not carry a SAM segmentation path');
function extract(name){const start=src.indexOf('function '+name+'(');if(start<0)throw new Error('function missing '+name);let p=src.indexOf('{',start),d=0;for(let i=p;i<src.length;i++){if(src[i]==='{')d++;else if(src[i]==='}'&&!--d)return src.slice(start,i+1)}throw new Error('unclosed '+name)}
const context={CFG:{deepAnchorMin:8}};vm.createContext(context);vm.runInContext(extract('regression'),context);
const direct=[];for(let i=0;i<18;i++){const r=.2+i*.11;direct.push({r,d:1.7*r+.42})}direct.push({r:9,d:.3});
const a=context.regression(direct);if(!a||a.mode!=='direct'||a.n<8||a.med>.01)throw new Error('direct robust fit failed '+JSON.stringify(a));
const inv=[];for(let i=0;i<18;i++){const r=.35+i*.08;inv.push({r,d:1.8/r+.18})}inv.push({r:.03,d:7});
const b=context.regression(inv);if(!b||b.mode!=='inverse'||b.n<8||b.med>.02)throw new Error('inverse robust fit failed '+JSON.stringify(b));
if(context.regression(direct.slice(0,7))!==null)throw new Error('fit must reject fewer than 8 anchors');
const codec={btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,Float32Array};vm.createContext(codec);vm.runInContext(extract('bytes64')+'\n'+extract('from64')+'\n'+extract('floats64')+'\n'+extract('floatsFrom64'),codec);
const raw=new Uint8Array([0,1,127,255]),round=codec.from64(codec.bytes64(raw));if(round.join(',')!==raw.join(','))throw new Error('RAW byte base64 roundtrip failed');
const floats=new Float32Array([.25,-2.5,Math.PI]),fround=codec.floatsFrom64(codec.floats64(floats));if(fround.length!==floats.length||Math.abs(fround[2]-floats[2])>1e-7)throw new Error('RAW float base64 roundtrip failed');
console.log(JSON.stringify({status:'PASS',direct:{mode:a.mode,anchors:a.n,median:a.med},inverse:{mode:b.mode,anchors:b.n,median:b.med},checks:12},null,2));
