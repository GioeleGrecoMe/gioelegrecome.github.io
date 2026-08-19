/**
 * Small diagnostics logger used by the V30 runtime.
 * It keeps a bounded in-memory log, mirrors important entries to the browser
 * console, and can export a JSON diagnostic bundle without any network access.
 */
export class DiagnosticsLog extends EventTarget {
  constructor({maxEntries=2500,build=null}={}){super();this.maxEntries=maxEntries;this.build=build;this.entries=[];}
  _push(level,event,data={}){const item={at:Date.now(),level,event,data};this.entries.push(item);if(this.entries.length>this.maxEntries)this.entries.splice(0,this.entries.length-this.maxEntries);try{const fn=level==='error'?console.error:level==='warn'?console.warn:level==='debug'?console.debug:console.info;fn.call(console,`[RoomScan:${event}]`,data);}catch{}this.dispatchEvent(new CustomEvent('entry',{detail:item}));return item;}
  debug(event,data){return this._push('debug',event,data)}
  info(event,data){return this._push('info',event,data)}
  warn(event,data){return this._push('warn',event,data)}
  error(event,data){return this._push('error',event,data)}
  snapshot(extra={}){return {format:'ROOMSCAN-V30-DIAGNOSTICS-1',createdAt:Date.now(),build:this.build,url:globalThis.location?.href||null,userAgent:globalThis.navigator?.userAgent||null,entries:[...this.entries],...extra};}
  text(extra={}){return JSON.stringify(this.snapshot(extra),null,2)}
  download(filename=`roomscan-diagnostics-${Date.now()}.json`,extra={}){const blob=new Blob([this.text(extra)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}
}
export function createLogger(options){return new DiagnosticsLog(options)}
