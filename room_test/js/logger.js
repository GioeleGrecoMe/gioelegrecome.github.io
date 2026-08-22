/**
 * Structured diagnostics logger for Room Scanner.
 *
 * The log is deliberately event based rather than free-form text: every
 * optimisation decision can be reconstructed afterwards together with timing,
 * graph size, worker back-pressure and the exact acceptance/rejection reasons.
 */
export class DiagnosticsLog extends EventTarget {
  constructor({maxEntries=12000,maxCheckpoints=160,build=null,sessionId=null}={}){super();this.maxEntries=maxEntries;this.maxCheckpoints=maxCheckpoints;this.build=build;this.sessionId=sessionId||makeId();this.entries=[];this.checkpoints=[];this.previousSessions=[];this.seq=0;this.startedAt=Date.now();this.startedMono=mono();this.contextProvider=null;}
  setContextProvider(fn){this.contextProvider=typeof fn==='function'?fn:null;return this;}
  attachPrevious(snapshot){if(snapshot&&typeof snapshot==='object'){this.previousSessions.push(snapshot);if(this.previousSessions.length>2)this.previousSessions.shift();}return this;}
  _push(level,event,data={},meta={}){const item={seq:++this.seq,at:Date.now(),tMs:Math.max(0,mono()-this.startedMono),level,event,scope:meta.scope||inferScope(event),traceId:meta.traceId||null,data:safeData(data)};this.entries.push(item);if(this.entries.length>this.maxEntries)this.entries.splice(0,this.entries.length-this.maxEntries);try{const fn=level==='error'?console.error:level==='warn'?console.warn:level==='debug'?console.debug:console.info;fn.call(console,`[RoomScan:${event}]`,item.data);}catch{}try{this.dispatchEvent(new CustomEvent('entry',{detail:item}));}catch{}return item;}
  debug(event,data,meta){return this._push('debug',event,data,meta)}
  info(event,data,meta){return this._push('info',event,data,meta)}
  warn(event,data,meta){return this._push('warn',event,data,meta)}
  error(event,data,meta){return this._push('error',event,data,meta)}
  decision(event,data,meta){return this._push('info',event,{decision:true,...safeData(data)},meta)}
  checkpoint(name,data={}){const c={seq:this.seq,at:Date.now(),tMs:Math.max(0,mono()-this.startedMono),name,data:safeData(data)};this.checkpoints.push(c);if(this.checkpoints.length>this.maxCheckpoints)this.checkpoints.splice(0,this.checkpoints.length-this.maxCheckpoints);this._push('debug','diagnostic-checkpoint',{name,summary:compactCheckpoint(data)},{scope:'diagnostics'});return c;}
  snapshot(extra={}){let runtime=null;try{runtime=this.contextProvider?.()||null;}catch(err){runtime={contextError:err?.message||String(err)};}return {format:'ROOMSCAN-V30-DIAGNOSTICS-2',createdAt:Date.now(),startedAt:this.startedAt,durationMs:Math.max(0,mono()-this.startedMono),sessionId:this.sessionId,build:this.build,url:globalThis.location?.href||null,userAgent:globalThis.navigator?.userAgent||null,visibility:globalThis.document?.visibilityState||null,memory:memorySnapshot(),summary:summarizeEntries(this.entries,this.checkpoints),runtime,previousSessions:[...this.previousSessions],checkpoints:[...this.checkpoints],entries:[...this.entries],...extra};}
  text(extra={}){return JSON.stringify(this.snapshot(extra),null,2)}
  ndjson(extra={}){const head={type:'header',...this.snapshot({...extra,entries:undefined,checkpoints:undefined})};return [JSON.stringify(head),...this.checkpoints.map(x=>JSON.stringify({type:'checkpoint',...x})),...this.entries.map(x=>JSON.stringify({type:'event',...x}))].join('\n');}
  download(filename=`roomscan-diagnostics-${Date.now()}.json`,extra={}){const blob=new Blob([this.text(extra)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}
}
export function createLogger(options){return new DiagnosticsLog(options)}
function mono(){return globalThis.performance?.now?.()??Date.now();}
function makeId(){return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function inferScope(event=''){const e=String(event);if(e.includes('live-opt')||e.includes('prob-opt')||e.includes('optimization'))return 'optimizer';if(e.includes('deep'))return 'deep';if(e.includes('photo')||e.includes('mosaic')||e.includes('puzzle'))return 'photo';if(e.includes('alva')||e.includes('slam'))return 'tracking';if(e.includes('fusion')||e.includes('mesh')||e.includes('surface'))return 'geometry';if(e.includes('session')||e.includes('storage'))return 'storage';return 'runtime';}
function memorySnapshot(){const m=globalThis.performance?.memory;return m?{usedJSHeapSize:m.usedJSHeapSize,totalJSHeapSize:m.totalJSHeapSize,jsHeapSizeLimit:m.jsHeapSizeLimit}:null;}
function safeData(v,depth=0){if(depth>5)return '[max-depth]';if(v==null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number')return Number.isFinite(v)?v:String(v);if(ArrayBuffer.isView(v))return {typedArray:v.constructor?.name||'TypedArray',length:v.length,byteLength:v.byteLength};if(v instanceof ArrayBuffer)return {arrayBuffer:true,byteLength:v.byteLength};if(Array.isArray(v)){if(v.length>80)return {array:true,length:v.length,head:v.slice(0,12).map(x=>safeData(x,depth+1))};return v.map(x=>safeData(x,depth+1));}if(typeof v==='object'){const out={};let n=0;for(const [k,x] of Object.entries(v)){if(++n>80){out.__truncatedKeys=Object.keys(v).length-n+1;break;}out[k]=safeData(x,depth+1);}return out;}return String(v);}
function compactCheckpoint(d){if(!d||typeof d!=='object')return d;const keys=['reason','frames','landmarks','deepFrames','photoEdges','reprojectionRmse','deepRelativeError','accepted','generation','connectedFraction'];const out={};for(const k of keys)if(d[k]!=null)out[k]=d[k];return out;}

function summarizeEntries(entries,checkpoints){const byLevel={},byScope={},events={};for(const e of entries||[]){byLevel[e.level]=(byLevel[e.level]||0)+1;byScope[e.scope]=(byScope[e.scope]||0)+1;events[e.event]=(events[e.event]||0)+1;}const topEvents=Object.entries(events).sort((a,b)=>b[1]-a[1]).slice(0,40).map(([event,count])=>({event,count}));return {eventCount:entries?.length||0,checkpointCount:checkpoints?.length||0,byLevel,byScope,topEvents};}
