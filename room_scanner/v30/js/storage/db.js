import {BUILD} from '../config.js';

export class V30Database{
  constructor(){this.db=null;}
  async open(){if(this.db)return this;this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open(BUILD.dbName,BUILD.dbVersion);r.onupgradeneeded=()=>{const db=r.result;for(const n of ['sessions','keyframes','imu','events','snapshots'])if(!db.objectStoreNames.contains(n))db.createObjectStore(n,{keyPath:'id'});for(const n of ['keyframes','imu','events']){const s=r.transaction.objectStore(n);if(!s.indexNames.contains('sessionId'))s.createIndex('sessionId','sessionId');}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return this;}
  tx(store,mode='readonly'){return this.db.transaction(store,mode).objectStore(store);}
  put(store,value){return new Promise((resolve,reject)=>{const r=this.tx(store,'readwrite').put(value);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  get(store,id){return new Promise((resolve,reject)=>{const r=this.tx(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  getAll(store){return new Promise((resolve,reject)=>{const r=this.tx(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  getAllForSession(store,sessionId){return new Promise((resolve,reject)=>{const s=this.tx(store);const r=s.indexNames.contains('sessionId')?s.index('sessionId').getAll(sessionId):s.getAll();r.onsuccess=()=>resolve(s.indexNames.contains('sessionId')?r.result:r.result.filter(x=>x.sessionId===sessionId));r.onerror=()=>reject(r.error);});}
  async createSession(meta={}){const id=`r30-${crypto.randomUUID()}`,s={id,build:BUILD.id,version:BUILD.version,createdAt:Date.now(),updatedAt:Date.now(),status:'created',counts:{keyframes:0,imu:0,gaussians:0},...meta};await this.put('sessions',s);return s;}
  async updateSession(id,patch){const s=await this.get('sessions',id)||{id};Object.assign(s,patch,{updatedAt:Date.now()});await this.put('sessions',s);return s;}
  async loadSessionBundle(id){const [session,keyframes,imu,snapshot,events]=await Promise.all([this.get('sessions',id),this.getAllForSession('keyframes',id),this.getAllForSession('imu',id),this.get('snapshots',id),this.getAllForSession('events',id)]);return {session,keyframes:keyframes.sort((a,b)=>(a.seq||0)-(b.seq||0)),imu,events,snapshot};}
}
