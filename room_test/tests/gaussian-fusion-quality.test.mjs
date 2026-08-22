import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
function worker(){const code=fs.readFileSync(new URL('../workers/gaussian_worker.js',import.meta.url),'utf8'),messages=[],postMessage=m=>messages.push(m),self={postMessage};vm.runInNewContext(code,{self,postMessage,Map,Set,Math,Number,Array,ArrayBuffer,Uint8Array,Float32Array,Error,console});return {self,messages};}
test('online splat fusion records independent multi-view support and anisotropic uncertainty',()=>{
  const w=worker();w.self.onmessage({data:{type:'init',config:{voxel:.03,maxGaussians:100,maxSnapshot:100,minSupport:2}}});
  w.self.onmessage({data:{type:'add',sourceId:'view-a',points:[{position:[.001,0,2],color:[200,100,50],confidence:.9,scale:[.01,.02,.03]}]}});
  w.self.onmessage({data:{type:'add',sourceId:'view-b',points:[{position:[.004,.002,2.001],color:[204,104,54],confidence:.8,scale:[.011,.019,.028]}]}});
  const s=w.messages.at(-1),g=s.gaussians[0];assert.equal(s.type,'snapshot');assert.equal(g.support,2);assert.equal(g.observations,2);assert.ok(g.confidence>.5);assert.equal(g.scale.length,3);assert.ok(g.opacity>0&&g.opacity<=1);
});

test('isolated one-view floaters are hidden until spatial or multi-view support exists',()=>{
  const w=worker();w.self.onmessage({data:{type:'init',config:{voxel:.03,maxGaussians:100,maxSnapshot:100,minSupport:2}}});
  w.self.onmessage({data:{type:'add',sourceId:'only-view',points:[{position:[0,0,2],color:[255,0,0],confidence:.5}]}});
  const s=w.messages.at(-1);assert.equal(s.type,'snapshot');assert.equal(s.gaussians.length,0);
  w.self.onmessage({data:{type:'add',sourceId:'second-view',points:[{position:[.004,.001,2.001],color:[255,10,10],confidence:.7}]}});
  const s2=w.messages.at(-1);assert.equal(s2.gaussians.length,1);assert.equal(s2.gaussians[0].support,2);
});
