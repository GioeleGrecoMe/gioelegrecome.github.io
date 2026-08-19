import {BUILD} from '../config.js';

/*
 * Open an IndexedDB database without ever requesting a lower version than the
 * one already present on the device.
 *
 * Why V30.8 failed:
 *   indexedDB.open('room-scanner-v30', 2)
 * MUST throw VersionError when that origin already has version 3.
 *
 * V30.9 first probes with open(name) (no requested version). Only if the current
 * database is older do we explicitly request the target version. This also
 * makes cached/rolled-back builds safe around newer schemas.
 */
export async function openVersionSafe(name,targetVersion,onUpgrade,indexedDBFactory=globalThis.indexedDB){
  if(!name)throw new TypeError('IndexedDB name is required');
  if(!indexedDBFactory?.open)throw new Error('IndexedDB is unavailable');
  if(!Number.isInteger(targetVersion)||targetVersion<1)throw new TypeError('targetVersion must be >= 1');

  const current=await requestOpen(indexedDBFactory.open(name),null);
  const currentVersion=Number(current.version)||1;
  if(currentVersion>=targetVersion){
    installVersionChangeClose(current);
    return {db:current,version:currentVersion,upgraded:false,newerThanTarget:currentVersion>targetVersion};
  }

  current.close();
  try{
    const upgraded=await requestOpen(indexedDBFactory.open(name,targetVersion),onUpgrade);
    installVersionChangeClose(upgraded);
    return {db:upgraded,version:Number(upgraded.version)||targetVersion,upgraded:true,newerThanTarget:false};
  }catch(err){
    // Another tab/service worker can win the version race after our probe.
    // Re-open the now-current DB instead of turning that benign race into a
    // bootstrap failure.
    if(err?.name!=='VersionError')throw err;
    const raced=await requestOpen(indexedDBFactory.open(name),null);
    installVersionChangeClose(raced);
    return {db:raced,version:Number(raced.version)||targetVersion,upgraded:false,newerThanTarget:Number(raced.version)>targetVersion,recoveredFromVersionRace:true};
  }
}

function requestOpen(request,onUpgrade){
  return new Promise((resolve,reject)=>{
    request.onupgradeneeded=e=>onUpgrade?.({db:request.result,transaction:request.transaction,oldVersion:e.oldVersion,newVersion:e.newVersion,event:e});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
    // A blocked upgrade is intentionally allowed to wait; the normal browser
    // versionchange event below closes this app's own older connection.
    request.onblocked=()=>{};
  });
}

function installVersionChangeClose(db){
  db.onversionchange=()=>{try{db.close();}catch{}};
}

function upgradeSchema({db,transaction}){
  for(const n of ['sessions','keyframes','imu','events','snapshots','meshes']){
    if(!db.objectStoreNames.contains(n))db.createObjectStore(n,{keyPath:'id'});
  }
  for(const n of ['keyframes','imu','events']){
    const s=transaction.objectStore(n);
    if(!s.indexNames.contains('sessionId'))s.createIndex('sessionId','sessionId');
  }
}

export class V30Database{
  constructor(){this.db=null;this.openInfo=null;}
  async open(){
    if(this.db)return this;
    const info=await openVersionSafe(BUILD.dbName,BUILD.dbVersion,upgradeSchema);
    this.db=info.db;this.openInfo=info;
    return this;
  }
  tx(store,mode='readonly'){return this.db.transaction(store,mode).objectStore(store);}
  put(store,value){return new Promise((resolve,reject)=>{const r=this.tx(store,'readwrite').put(value);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  get(store,id){return new Promise((resolve,reject)=>{const r=this.tx(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  getAll(store){return new Promise((resolve,reject)=>{const r=this.tx(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  getAllForSession(store,sessionId){return new Promise((resolve,reject)=>{const s=this.tx(store);const indexed=s.indexNames.contains('sessionId');const r=indexed?s.index('sessionId').getAll(sessionId):s.getAll();r.onsuccess=()=>resolve(indexed?r.result:r.result.filter(x=>x.sessionId===sessionId));r.onerror=()=>reject(r.error);});}
  async createSession(meta={}){const id=`r30-${crypto.randomUUID()}`,s={id,build:BUILD.id,version:BUILD.version,createdAt:Date.now(),updatedAt:Date.now(),status:'created',counts:{keyframes:0,imu:0,gaussians:0},...meta};await this.put('sessions',s);return s;}
  async updateSession(id,patch){const s=await this.get('sessions',id)||{id};Object.assign(s,patch,{updatedAt:Date.now()});await this.put('sessions',s);return s;}
  async loadSessionBundle(id){const [session,keyframes,imu,snapshot,mesh,events]=await Promise.all([this.get('sessions',id),this.getAllForSession('keyframes',id),this.getAllForSession('imu',id),this.get('snapshots',id),this.get('meshes',id),this.getAllForSession('events',id)]);return {session,keyframes:keyframes.sort((a,b)=>(a.seq||0)-(b.seq||0)),imu,events,snapshot,mesh};}
}
