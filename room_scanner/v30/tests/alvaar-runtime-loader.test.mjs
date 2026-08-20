import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAlvaSource,loadAlvaModule,ALVA_EXPECTED_MIN_BYTES} from '../js/slam/alva_runtime_loader.js';

function fakeOfficialSource(){
  const api='\nexport class AlvaAR { static async Initialize(){ return { findCameraPose(){}, getFramePoints(){} }; } }\n// findCameraPose getFramePoints Initialize AlvaAR\n';
  return '/* official-like test payload */\n'+('x'.repeat(ALVA_EXPECTED_MIN_BYTES+1024))+api;
}
function fakeCaches(){
  const stores=new Map();
  return {async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {
    async match(key){const r=store.get(String(key));return r?.clone?.()||null;},
    async put(key,response){store.set(String(key),response.clone());},
    async delete(key){return store.delete(String(key));}
  };}};
}
const fakeModule={AlvaAR:{Initialize:async()=>({findCameraPose(){return null;},getFramePoints(){return [];}})}};

test('official Alva source validator rejects the tiny wasm/sentinel path',()=>{
  const tiny='export const AlvaAR={Initialize(){}}; findCameraPose getFramePoints';
  const r=inspectAlvaSource(tiny);assert.equal(r.ok,false);assert.match(r.reason,/too-small/);
});

test('official Alva source validator accepts a full-size bundle with the public API',()=>{
  const r=inspectAlvaSource(fakeOfficialSource());assert.equal(r.ok,true);assert.ok(r.bytes>ALVA_EXPECTED_MIN_BYTES);
});

test('runtime downloads once and reuses CacheStorage offline',async()=>{
  const source=fakeOfficialSource(),cachesImpl=fakeCaches();let fetches=0;
  const fetchImpl=async()=>{fetches++;return new Response(source,{status:200,headers:{'Content-Type':'text/javascript'}});};
  let imports=0;const opts={cacheKey:'https://roomscan.test/vendor/alva_ar.cached.js',sources:['https://official.test/alva_ar.js'],fetchImpl,cachesImpl,importUrl:async()=>{imports++;return fakeModule;},importSource:async()=>fakeModule,force:true};
  const a=await loadAlvaModule(opts);assert.equal(a.AlvaAR,fakeModule.AlvaAR);assert.equal(imports,1);
  // Remote source caching is deliberately best-effort after startup. Give the
  // detached cache task one turn, then prove the cached source can boot offline.
  await new Promise(r=>setTimeout(r,30));assert.equal(fetches,1);
  const b=await loadAlvaModule({...opts,fetchImpl:async()=>{throw new Error('offline');},importUrl:async()=>{throw new Error('offline import');},force:true});assert.equal(b.AlvaAR,fakeModule.AlvaAR);
});
