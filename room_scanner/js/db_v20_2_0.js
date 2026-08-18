import {BUILD} from './config_v20_2_0.js';
import {uid} from './math_v20_2_0.js';

/**
 * IndexedDB append-only repository.
 * Large binary artifacts never live inside the session object. Every record is
 * independently committed, which is the central crash-recovery guarantee.
 */
export class CaptureRepository {
  constructor({dbName=BUILD.dbName,dbVersion=BUILD.dbVersion}={}){
    this.dbName=dbName;this.dbVersion=dbVersion;this.db=null;this.pending=new Set();this.writeFailures=0;this.sequence=0;
  }
  async open(){
    if(this.db)return this;
    if(!globalThis.indexedDB)throw new Error('IndexedDB non disponibile');
    this.db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(this.dbName,this.dbVersion);
      req.onupgradeneeded=()=>{
        const db=req.result;
        const create=(name,opts)=>db.objectStoreNames.contains(name)?req.transaction.objectStore(name):db.createObjectStore(name,opts);
        const sessions=create('sessions',{keyPath:'id'});if(!sessions.indexNames.contains('updatedAt'))sessions.createIndex('updatedAt','updatedAt');
        const records=create('records',{keyPath:'key'});if(!records.indexNames.contains('sessionId'))records.createIndex('sessionId','sessionId');if(!records.indexNames.contains('kind'))records.createIndex('kind','kind');
        const blobs=create('blobs',{keyPath:'key'});if(!blobs.indexNames.contains('sessionId'))blobs.createIndex('sessionId','sessionId');if(!blobs.indexNames.contains('kind'))blobs.createIndex('kind','kind');
        const events=create('events',{keyPath:'id',autoIncrement:true});if(!events.indexNames.contains('sessionId'))events.createIndex('sessionId','sessionId');if(!events.indexNames.contains('time'))events.createIndex('time','time');
        create('models',{keyPath:'key'});
      };
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Database bloccato da una scheda precedente'));
    });
    this.db.onversionchange=()=>{this.db?.close();this.db=null;};
    return this;
  }
  _tx(storeNames,mode='readonly'){if(!this.db)throw new Error('Repository non aperto');return this.db.transaction(storeNames,mode,{durability:mode==='readwrite'?'relaxed':'default'});}
  _request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  _track(promise){
    const p=Promise.resolve(promise).catch(e=>{this.writeFailures++;throw e;}).finally(()=>this.pending.delete(p));this.pending.add(p);return p;
  }
  async createSession(options={}){
    await this.open();const now=Date.now();const session={id:uid('scan'),build:BUILD.id,version:BUILD.version,status:'created',createdAt:now,updatedAt:now,profile:options.profile||'balanced',audioMode:options.audioMode||'rapid',counts:{poses:0,frames:0,depthBatches:0,audioChunks:0,chirps:0,markpoints:0,gridSnapshots:0,dropped:0},lastRecordKey:null,flags:{xrEnded:false,rawExported:false,processingStarted:false},compatibility:options.compatibility||{},notes:[]};
    await this.putSession(session);return session;
  }
  async putSession(session){session.updatedAt=Date.now();const tx=this._tx(['sessions'],'readwrite');tx.objectStore('sessions').put(structuredClone(session));await txDone(tx);return session;}
  async patchSession(id,patch){const s=await this.getSession(id);if(!s)throw new Error(`Sessione ${id} non trovata`);deepAssign(s,patch);return this.putSession(s);}
  async getSession(id){await this.open();return this._request(this._tx(['sessions']).objectStore('sessions').get(id));}
  async latestSession(){await this.open();return new Promise((resolve,reject)=>{const idx=this._tx(['sessions']).objectStore('sessions').index('updatedAt');const r=idx.openCursor(null,'prev');r.onsuccess=()=>resolve(r.result?.value||null);r.onerror=()=>reject(r.error);});}
  async listSessions(){await this.open();const all=await this._request(this._tx(['sessions']).objectStore('sessions').getAll());return all.sort((a,b)=>b.updatedAt-a.updatedAt);}
  enqueueRecord(sessionId,kind,value,{key=null}={}){
    const seq=++this.sequence;const recordKey=key||`${sessionId}/${kind}/${Date.now()}-${String(seq).padStart(7,'0')}`;
    const op=(async()=>{await this.open();const tx=this._tx(['records'],'readwrite');tx.objectStore('records').put({key:recordKey,sessionId,kind,time:Date.now(),value});await txDone(tx);return recordKey;})();
    return this._track(op);
  }
  enqueueBlob(sessionId,kind,blob,meta={},key=null){
    if(!(blob instanceof Blob))blob=new Blob([blob]);const seq=++this.sequence;const recordKey=key||`${sessionId}/${kind}/${Date.now()}-${String(seq).padStart(7,'0')}`;
    const op=(async()=>{await this.open();const tx=this._tx(['blobs'],'readwrite');tx.objectStore('blobs').put({key:recordKey,sessionId,kind,time:Date.now(),size:blob.size,type:blob.type||'application/octet-stream',meta,blob});await txDone(tx);return recordKey;})();
    return this._track(op);
  }
  enqueueEvent(sessionId,event){
    const safe={sessionId,time:Date.now(),...event};
    const op=(async()=>{await this.open();const tx=this._tx(['events'],'readwrite');tx.objectStore('events').add(safe);await txDone(tx);})();return this._track(op);
  }
  async getRecords(sessionId,kind=null){await this.open();const all=await this._request(this._tx(['records']).objectStore('records').index('sessionId').getAll(sessionId));return all.filter(r=>!kind||r.kind===kind).sort((a,b)=>a.time-b.time);}
  async getBlobs(sessionId,kind=null){await this.open();const all=await this._request(this._tx(['blobs']).objectStore('blobs').index('sessionId').getAll(sessionId));return all.filter(r=>!kind||r.kind===kind).sort((a,b)=>a.time-b.time);}
  async getEvents(sessionId){await this.open();const all=await this._request(this._tx(['events']).objectStore('events').index('sessionId').getAll(sessionId));return all.sort((a,b)=>a.time-b.time);}
  async deleteBlobKey(key){await this.open();const tx=this._tx(['blobs'],'readwrite');tx.objectStore('blobs').delete(key);await txDone(tx);}
  async deleteRecordKey(key){await this.open();const tx=this._tx(['records'],'readwrite');tx.objectStore('records').delete(key);await txDone(tx);}
  async putModel(sessionId,model){await this.open();const tx=this._tx(['models'],'readwrite');tx.objectStore('models').put({key:sessionId,sessionId,time:Date.now(),model});await txDone(tx);}
  async getModel(sessionId){await this.open();const r=await this._request(this._tx(['models']).objectStore('models').get(sessionId));return r?.model||null;}
  async drain(timeoutMs=3500){
    const start=performance.now?.()||Date.now();while(this.pending.size){const elapsed=(performance.now?.()||Date.now())-start;if(elapsed>timeoutMs)return {complete:false,pending:this.pending.size};await Promise.race([Promise.allSettled([...this.pending]),new Promise(r=>setTimeout(r,80))]);}return {complete:true,pending:0};
  }
  pendingCount(){return this.pending.size;}
  async deleteSession(sessionId){
    await this.open();const tx=this._tx(['sessions','records','blobs','events','models'],'readwrite');tx.objectStore('sessions').delete(sessionId);tx.objectStore('models').delete(sessionId);
    for(const name of ['records','blobs','events']){const store=tx.objectStore(name),idx=store.index('sessionId');idx.openKeyCursor(IDBKeyRange.only(sessionId)).onsuccess=e=>{const c=e.target.result;if(c){store.delete(c.primaryKey);c.continue();}};}
    await txDone(tx);
  }
  close(){this.db?.close();this.db=null;}
}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transazione annullata'));});}
function deepAssign(target,patch){for(const [k,v] of Object.entries(patch||{})){if(v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Blob)&&!(v instanceof ArrayBuffer)){target[k]??={};deepAssign(target[k],v);}else target[k]=v;}return target;}
