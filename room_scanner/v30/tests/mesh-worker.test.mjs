import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('metric mesh worker creates metric faces from occupied Gaussian samples',()=>{
 const code=fs.readFileSync(new URL('../workers/metric_mesh_worker.js',import.meta.url),'utf8');let message=null;const self={postMessage:m=>{message=m;}};vm.runInNewContext(code,{self,Map,Math,Float32Array,Uint8Array,Uint32Array,Error});
 self.onmessage({data:{type:'mesh',voxelM:.05,maxVoxels:100,samples:[{p:[0.01,0.01,0.01],color:[255,0,0],opacity:1},{p:[0.06,0.01,0.01],color:[0,255,0],opacity:1}]}});
 assert.equal(message.type,'mesh-result');assert.equal(message.occupiedVoxels,2);assert.ok(message.vertices.length>0);assert.ok(message.faces.length>0);assert.equal(message.voxelM,.05);
});
