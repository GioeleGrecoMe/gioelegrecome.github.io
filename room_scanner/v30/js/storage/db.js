import {BUILD} from '../config.js';

export class V30Database{
  constructor(){this.db=null;}
  async open(){if(this.db)return this;this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open(BUILD.dbName,BUILD.dbVersion);r.onupgradeneeded=()=>{const db=r.result;for(const n of ['sessions','keyframes','imu','events','snapshots'])if(!db.objectStoreNames.contains(n))db.createObjectStore(n,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return this;}
  tx(store,mode='readonly'){return this.db.transaction(store,mode).objectStore(store);}
  put(store,value){return new Promise((resolve,reject)=>{const r=this.tx(store,'readwrite').put(value);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  get(store,id){return new Promise((resolve,reject)=>{const r=this.tx(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  getAll(store){return new Promise((resolve,reject)=>{const r=this.tx(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async createSession(meta={}){const id=`r30-${crypto.randomUUID()}`,s={id,build:BUILD.id,version:BUILD.version,createdAt:Date.now(),updatedAt:Date.now(),status:'created',counts:{keyframes:0,imu:0,gaussians:0},...meta};await this.put('sessions',s);return s;}
  async updateSession(id,patch){const s=await this.get('sessions',id)||{id};Object.assign(s,patch,{updatedAt:Date.now()});await this.put('sessions',s);return s;}
}
