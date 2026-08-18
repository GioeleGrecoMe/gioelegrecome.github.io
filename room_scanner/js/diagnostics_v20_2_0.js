import {serializableError} from './math_v20_2_0.js';

/** Persisted diagnostics survives renderer death because every event is separate. */
export class Diagnostics {
  constructor(repository,{sessionId=null,ringSize=160}={}){this.repo=repository;this.sessionId=sessionId;this.ringSize=ringSize;this.ring=[];this.sequence=0;this.state='BOOT';this.bound=false;}
  setSession(id){this.sessionId=id;}
  async log(type,data={},level='info'){
    const event={seq:++this.sequence,level,type,state:this.state,perfMs:globalThis.performance?.now?.()??null,visibility:globalThis.document?.visibilityState??'worker',data:sanitize(data)};
    this.ring.push({...event,time:Date.now()});if(this.ring.length>this.ringSize)this.ring.shift();
    if(this.sessionId)try{this.repo.enqueueEvent(this.sessionId,event);}catch{/* Diagnostics must never crash capture. */}
    return event;
  }
  transition(next,data={}){const previous=this.state;this.state=next;return this.log('state-transition',{previous,next,...data});}
  error(type,error,context={}){return this.log(type,{error:serializableError(error),...context},'error');}
  memory(label='memory'){
    const p=globalThis.performance;const m=p?.memory;return this.log('memory-snapshot',{label,jsHeapSizeLimit:m?.jsHeapSizeLimit??null,totalJSHeapSize:m?.totalJSHeapSize??null,usedJSHeapSize:m?.usedJSHeapSize??null});
  }
  bindGlobalHandlers(){
    if(this.bound||!globalThis.addEventListener)return;this.bound=true;
    addEventListener('error',e=>this.error('window-error',e.error||new Error(e.message),{filename:e.filename,lineno:e.lineno,colno:e.colno}));
    addEventListener('unhandledrejection',e=>this.error('unhandled-rejection',e.reason));
    addEventListener('pagehide',e=>this.log('pagehide',{persisted:e.persisted}));
    addEventListener('pageshow',e=>this.log('pageshow',{persisted:e.persisted}));
    globalThis.document?.addEventListener('visibilitychange',()=>this.log('visibility-change',{visibility:document.visibilityState}));
  }
  tail(lines=30){return this.ring.slice(-lines).map(e=>`${new Date(e.time).toISOString()} ${e.level.toUpperCase()} ${e.type} ${safeJson(e.data)}`).join('\n');}
}
function sanitize(value,depth=0){if(depth>5)return '[depth-limit]';if(value==null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')return value;if(value instanceof Error)return serializableError(value);if(ArrayBuffer.isView(value))return {type:value.constructor.name,length:value.length};if(value instanceof ArrayBuffer)return {type:'ArrayBuffer',byteLength:value.byteLength};if(value instanceof Blob)return {type:'Blob',size:value.size,mime:value.type};if(Array.isArray(value))return value.slice(0,80).map(v=>sanitize(v,depth+1));if(typeof value==='function')return '[function omitted]';if(typeof value==='object'){const o={};for(const [k,v] of Object.entries(value).slice(0,80))o[k]=sanitize(v,depth+1);return o;}return String(value);}
function safeJson(v){try{return JSON.stringify(v);}catch{return '[unserializable]';}}
