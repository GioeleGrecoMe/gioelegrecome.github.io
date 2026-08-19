import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

const derivedFiles=[
  'js/logger.js',
  'js/camera.js',
  'js/slam/slam_engine.js',
  'js/xr/metric_bridge.js',
  'js/xr/xr_calibration.js'
];

function constructorPrefix(text){
  const classAt=text.search(/class\s+[A-Za-z_$][\w$]*\s+extends\s+[A-Za-z_$][\w$]*/);
  assert.ok(classAt>=0,'derived class declaration missing');
  const tail=text.slice(classAt);
  const m=/constructor\([^)]*\)\s*\{/.exec(tail);
  assert.ok(m,'derived constructor missing');
  const bodyAt=classAt+m.index+m[0].length-1;
  let depth=0,end=bodyAt;
  for(let i=bodyAt;i<text.length;i++){
    if(text[i]==='{')depth++;
    else if(text[i]==='}'&&--depth===0){end=i;break;}
  }
  return text.slice(bodyAt+1,end);
}

test('every runtime derived EventTarget constructor calls super before this',()=>{
  for(const rel of derivedFiles){
    const text=fs.readFileSync(path.join(root,rel),'utf8');
    const body=constructorPrefix(text);
    const superAt=body.indexOf('super(');
    const thisAt=body.indexOf('this.');
    assert.ok(superAt>=0,`${rel}: missing super()`);
    assert.ok(thisAt<0||superAt<thisAt,`${rel}: this is accessed before super()`);
  }
});

test('SlamEngine can be constructed after a valid metric lock',async()=>{
  const mod=await import(pathToFileURL(path.join(root,'js/slam/slam_engine.js')).href+`?t=${Date.now()}`);
  const frontend={process(){return {features:[],count:0,matches:{items:[],count:0}};}};
  let slam;
  assert.doesNotThrow(()=>{slam=new mod.SlamEngine({frontend,K:{fx:300,fy:300,cx:160,cy:120},keyframeIntervalMs:950});});
  assert.doesNotThrow(()=>slam.setMetricScale(1));
  assert.equal(slam.metricLocked,true);
});
