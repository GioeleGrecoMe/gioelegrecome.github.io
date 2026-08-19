import test from 'node:test';
import assert from 'node:assert/strict';
import {openVersionSafe} from '../js/storage/db.js';

function versionError(){const e=new Error('requested version is lower');e.name='VersionError';return e;}
class FakeDB{constructor(factory){this.factory=factory;this.version=factory.version;this.closed=false;this.onversionchange=null;}close(){this.closed=true;}}
class FakeIndexedDB{
  constructor(version=1){this.version=version;this.calls=[];}
  open(_name,requestedVersion){
    this.calls.push(requestedVersion);
    const request={result:null,error:null,transaction:{},onsuccess:null,onerror:null,onblocked:null,onupgradeneeded:null};
    queueMicrotask(()=>{
      if(requestedVersion!==undefined&&requestedVersion<this.version){request.error=versionError();request.onerror?.({target:request});return;}
      const oldVersion=this.version;
      if(requestedVersion!==undefined&&requestedVersion>this.version){this.version=requestedVersion;request.result=new FakeDB(this);request.onupgradeneeded?.({oldVersion,newVersion:requestedVersion,target:request});}
      else request.result=new FakeDB(this);
      request.result.version=this.version;request.onsuccess?.({target:request});
    });
    return request;
  }
}

test('existing v3 + requested v2 never issues a downgrade open',async()=>{
  const factory=new FakeIndexedDB(3);
  const r=await openVersionSafe('room-scanner-v30',2,null,factory);
  assert.equal(r.version,3);assert.equal(r.newerThanTarget,true);assert.deepEqual(factory.calls,[undefined]);
});

test('older schema upgrades only after version probe',async()=>{
  const factory=new FakeIndexedDB(1),up=[];
  const r=await openVersionSafe('room-scanner-v30',3,({oldVersion,newVersion})=>up.push([oldVersion,newVersion]),factory);
  assert.equal(r.version,3);assert.equal(r.upgraded,true);assert.deepEqual(factory.calls,[undefined,3]);assert.deepEqual(up,[[1,3]]);
});

test('upgrade race VersionError recovers with versionless reopen',async()=>{
  const factory=new FakeIndexedDB(1),base=factory.open.bind(factory);let explicit=0;
  factory.open=(name,v)=>{if(v!==undefined&&++explicit===1)factory.version=4;return base(name,v);};
  const r=await openVersionSafe('room-scanner-v30',3,null,factory);
  assert.equal(r.version,4);assert.equal(r.recoveredFromVersionRace,true);assert.deepEqual(factory.calls,[undefined,3,undefined]);
});
