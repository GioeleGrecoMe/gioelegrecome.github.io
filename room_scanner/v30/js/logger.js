import {BUILD} from './config.js';

/* Central diagnostics recorder. It is deliberately usable before IndexedDB is
 * ready: the in-memory ring buffer is always available and a compact emergency
 * copy is mirrored to localStorage after severe errors. */
export class DiagnosticLog{
  constructor({max=5000}={}){this.max=max;this.events=[];this.startedAt=Date.now();this.sessionId=null;this.listeners=new Set();}
  setSession(id){this.sessionId=id;this.info('session-selected',{sessionId:id});}
  push(level,type,data={}){
    const ev={seq:(this.events.at(-1)?.seq||0)+1,time:Date.now(),perfMs:performance.now?.()??0,level,type,sessionId:this.sessionId,visibility:document.visibilityState,data:safeClone(data)};
    this.events.push(ev); if(this.events.length>this.max)this.events.splice(0,Math.ceil(this.max*.12));
    if(level==='error')this._emergencyMirror(); for(const fn of this.listeners){try{fn(ev);}catch{}}
    return ev;
  }
  debug(t,d){return this.push('debug',t,d);} info(t,d){return this.push('info',t,d);} warn(t,d){return this.push('warn',t,d);} error(t,d){return this.push('error',t,d);}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  snapshot(extra={}){return {format:'ROOMSCAN-V30-DIAGNOSTICS-1',build:BUILD,exportedAt:new Date().toISOString(),startedAt:this.startedAt,sessionId:this.sessionId,userAgent:navigator.userAgent,location:location.href,secureContext:isSecureContext,online:navigator.onLine,hardwareConcurrency:navigator.hardwareConcurrency??null,deviceMemory:navigator.deviceMemory??null,screen:{w:screen.width,h:screen.height,dpr:devicePixelRatio},...safeClone(extra),events:this.events};}
  download(extra={}){const blob=new Blob([JSON.stringify(this.snapshot(extra),null,2)],{type:'application/json'});downloadBlob(blob,`roomscan-v30-${this.sessionId||'boot'}-diagnostics.json`);}
  _emergencyMirror(){try{localStorage.setItem('roomscan-v30-last-error',JSON.stringify({build:BUILD,last:this.events.slice(-20)}));}catch{}}
}
function safeClone(v){try{return structuredClone(v);}catch{try{return JSON.parse(JSON.stringify(v,(k,x)=>x instanceof Error?{name:x.name,message:x.message,stack:x.stack}:ArrayBuffer.isView(x)?`[${x.constructor.name} ${x.length}]`:x));}catch{return String(v);}}}
export function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);}
export function installGlobalDiagnostics(log){
  window.addEventListener('error',e=>log.error('window-error',{message:e.message,filename:e.filename,line:e.lineno,column:e.colno,error:e.error}));
  window.addEventListener('unhandledrejection',e=>log.error('unhandled-rejection',{reason:e.reason}));
  window.addEventListener('pagehide',e=>log.info('pagehide',{persisted:e.persisted}));
  document.addEventListener('visibilitychange',()=>log.info('visibility',{state:document.visibilityState}));
}
