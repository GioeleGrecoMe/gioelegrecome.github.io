#!/usr/bin/env python3
"""Minimal, fail-closed Depth Anything replacement patch V3 for current Room Scanner V10.

Only edits:
  - depth_ai_worker.js: same-origin WASM routing, 1.23.2 fallback, worker-local trace
  - room_scanner_v10.html: stores worker trace and exposes a copy-log button

No Service Worker/cache, WebXR, audio, geometry, semantic model, splatting,
preprocessing math, metric fitting, or fusion thresholds are changed.
"""
from __future__ import annotations
import argparse, difflib, json
from pathlib import Path

MARKER = "DEPTHAI_DIAG_V3"


def once(text, old, new, label, already=None):
    if already and already in text:
        return text, False
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: expected exactly one current-source anchor, found {n}")
    return text.replace(old, new, 1), True


def patch_worker(src):
    changes=[]

    # Functional fix 1: an absolute HTTPS URL may still be same-origin.
    src,did=once(
        src,
        "  const remote = /^https?:/i.test(runtimeSource);\n",
        "  // DEPTHAI_RUNTIME_ORIGIN_FIX: same-origin absolute URLs must use same-origin WASM/JSEP assets.\n"
        "  const runtimeURL = new URL(runtimeSource, self.location.href);\n"
        "  const remote = runtimeURL.origin !== self.location.origin;\n",
        "same-origin runtime classification",
        "DEPTHAI_RUNTIME_ORIGIN_FIX",
    )
    if did: changes.append("fixed same-origin runtime classification used by wasmPaths")

    # Functional fix 2: keep the worker's own default on the tested runtime.
    if "DEPTHAI_RUNTIME_DEFAULT_FIX" not in src:
        src,did=once(
            src,
            "      runtimeVersion = String(msg.runtimeVersion || '1.24.1');\n",
            "      runtimeVersion = String(msg.runtimeVersion || '1.23.2'); // DEPTHAI_RUNTIME_DEFAULT_FIX\n",
            "worker init runtime fallback",
        )
        if did: changes.append("changed worker init fallback runtime 1.24.1 -> 1.23.2")

    # Worker-local bounded trace. It observes only this dedicated DepthAI worker.
    if MARKER not in src:
        anchor="const STD = [0.229, 0.224, 0.225];\n"
        if src.count(anchor)!=1: raise RuntimeError("debug helper: STD anchor not unique")
        helper=r'''

// DEPTHAI_DIAG_V3: bounded worker-local trace; no Worker/fetch/console monkey-patching.
const DEPTHAI_DIAG_V3 = true;
const DEPTH_DEBUG_MAX = 120;
const depthDebugEvents = [];
let depthDebugStage = 'worker-boot';
function depthDebug(type, detail = {}) {
  depthDebugStage = type;
  let clean = detail;
  try { clean = JSON.parse(JSON.stringify(detail)); } catch (_) { clean = {text:String(detail)}; }
  depthDebugEvents.push({t_ms:Math.round(performance.now()), iso:new Date().toISOString(), type, detail:clean});
  if (depthDebugEvents.length > DEPTH_DEBUG_MAX) depthDebugEvents.splice(0, depthDebugEvents.length - DEPTH_DEBUG_MAX);
}
function depthDebugSnapshot(reason = '') {
  let wasmPaths = null;
  try { wasmPaths = ortApi?.env?.wasm?.wasmPaths ?? null; } catch (_) {}
  return {
    schema:'room-scanner-depthai-debug-v3', reason, stage:depthDebugStage,
    runtimeVersion, runtimeSource, modelSource, activeProvider,
    forceWasm:!!forceWasmRuntime, wasmPaths, modelIntegrity,
    environment:{
      href:self.location?.href||'', origin:self.location?.origin||'',
      userAgent:self.navigator?.userAgent||'', hardwareConcurrency:self.navigator?.hardwareConcurrency||null,
      webgpu:!!self.navigator?.gpu, crossOriginIsolated:!!self.crossOriginIsolated,
    },
    events:depthDebugEvents.slice(),
  };
}
depthDebug('worker-boot',{href:self.location?.href||'',webgpu:!!self.navigator?.gpu,crossOriginIsolated:!!self.crossOriginIsolated});
'''
        src=src.replace(anchor,anchor+helper,1)
        changes.append("added bounded worker-local DepthAI trace")

    # Runtime import attempts and errors.
    old="""function importRuntime(url) {
  importScripts(url);
  if (!self.ort || !self.ort.InferenceSession) throw new Error(`ORT non esposto da ${url}`);
  ortApi = self.ort;
  runtimeSource = url;
}
"""
    new="""function importRuntime(url) {
  depthDebug('runtime-import-start',{url});
  try {
    importScripts(url);
    if (!self.ort || !self.ort.InferenceSession) throw new Error(`ORT non esposto da ${url}`);
    ortApi = self.ort;
    runtimeSource = url;
    depthDebug('runtime-import-ok',{url});
  } catch (e) {
    depthDebug('runtime-import-failed',{url,error:errText(e),stack:String(e?.stack||'')});
    throw e;
  }
}
"""
    if "runtime-import-start" not in src:
        src,did=once(src,old,new,"importRuntime body")
        if did: changes.append("logged every ORT runtime import attempt")

    # Record final WASM/JSEP path actually selected.
    if "depthDebug('runtime-ready'" not in src:
        src,did=once(
            src,
            "  ortApi.env.wasm.simd = true;\n",
            "  ortApi.env.wasm.simd = true;\n"
            "  depthDebug('runtime-ready',{runtimeSource,runtimeVersion,remote,wasmPaths:ortApi.env.wasm.wasmPaths,forceWasm:!!forceWasmRuntime});\n",
            "runtime-ready insertion",
        )
        if did: changes.append("logged selected runtime and wasmPaths")

    # Model download/integrity trace, preserving existing fetch/cache/CORS/hash logic exactly.
    if "depthDebug('model-fetch-start'" not in src:
        src,did=once(src,"async function fetchVerifiedModel(url){\n","async function fetchVerifiedModel(url){\n  depthDebug('model-fetch-start',{url});\n","model fetch start")
        if did: changes.append("logged model fetch start")
    if "depthDebug('model-fetch-response'" not in src:
        old="  const r=await fetch(absolute,{cache:local?'no-store':'default',mode:'cors'});if(!r.ok)throw new Error(`DepthAI model HTTP ${r.status}: ${absolute}`);\n"
        new="  const r=await fetch(absolute,{cache:local?'no-store':'default',mode:'cors'});depthDebug('model-fetch-response',{url:absolute,status:r.status,ok:r.ok,contentLength:r.headers.get('content-length'),local});if(!r.ok)throw new Error(`DepthAI model HTTP ${r.status}: ${absolute}`);\n"
        src,did=once(src,old,new,"model fetch response")
        if did: changes.append("logged model HTTP response")
    if "depthDebug('model-bytes'" not in src:
        old="  const buffer=await r.arrayBuffer();if(buffer.byteLength!==DEPTH_MODEL_PIN.bytes)throw new Error(`DepthAI model size ${buffer.byteLength} != ${DEPTH_MODEL_PIN.bytes}`);\n"
        new="  const buffer=await r.arrayBuffer();depthDebug('model-bytes',{bytes:buffer.byteLength,expectedBytes:DEPTH_MODEL_PIN.bytes});if(buffer.byteLength!==DEPTH_MODEL_PIN.bytes)throw new Error(`DepthAI model size ${buffer.byteLength} != ${DEPTH_MODEL_PIN.bytes}`);\n"
        src,did=once(src,old,new,"model byte count")
        if did: changes.append("logged model byte count")
    if "depthDebug('model-sha256'" not in src:
        old="  const hash=await sha256Hex(buffer);if(hash&&hash!==DEPTH_MODEL_PIN.sha256)throw new Error('DepthAI model SHA-256 non corrisponde a Q4F16 ufficiale');\n"
        new="  const hash=await sha256Hex(buffer);depthDebug('model-sha256',{sha256:hash||'unavailable',expectedSha256:DEPTH_MODEL_PIN.sha256,match:!hash||hash===DEPTH_MODEL_PIN.sha256});if(hash&&hash!==DEPTH_MODEL_PIN.sha256)throw new Error('DepthAI model SHA-256 non corrisponde a Q4F16 ufficiale');\n"
        src,did=once(src,old,new,"model SHA")
        if did: changes.append("logged model SHA-256 verification")
    if "depthDebug('model-verified'" not in src:
        old="  modelIntegrity={bytes:buffer.byteLength,sha256:hash||'unavailable',url:absolute};return {buffer,absolute}\n"
        new="  modelIntegrity={bytes:buffer.byteLength,sha256:hash||'unavailable',url:absolute};depthDebug('model-verified',{modelIntegrity});return {buffer,absolute}\n"
        src,did=once(src,old,new,"model verified")
        if did: changes.append("logged verified model identity")

    # Session creation diagnostics only; provider order/options unchanged.
    old="""async function createSessionFrom(buffer, providers) {
  const opts = {executionProviders: providers,graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true};
  return await ortApi.InferenceSession.create(buffer, opts);
}
"""
    new="""async function createSessionFrom(buffer, providers) {
  const opts = {executionProviders: providers,graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true};
  depthDebug('session-create-start',{providers,modelBytes:buffer?.byteLength||0});
  try {
    const s=await ortApi.InferenceSession.create(buffer, opts);
    depthDebug('session-create-ok',{providers});
    return s;
  } catch(e) {
    depthDebug('session-create-failed',{providers,error:errText(e),stack:String(e?.stack||'')});
    throw e;
  }
}
"""
    if "session-create-start" not in src:
        src,did=once(src,old,new,"createSessionFrom body")
        if did: changes.append("logged provider/session creation success and failure")

    # Inference diagnostics; all preprocessing/output checks remain unchanged.
    if "depthDebug('infer-start'" not in src:
        src,did=once(
            src,
            "async function infer(msg) {\n  if (!session) throw new Error('DepthAI sessione non inizializzata');\n",
            "async function infer(msg) {\n  const inferT0=performance.now();\n  depthDebug('infer-start',{width:Number(msg.width),height:Number(msg.height),provider:activeProvider});\n  if (!session) throw new Error('DepthAI sessione non inizializzata');\n",
            "infer start",
        )
        if did: changes.append("logged inference start")
    if "depthDebug('infer-ok'" not in src:
        old="  let finite=0;for(let i=0;i<depth.length;i++)if(Number.isFinite(depth[i]))finite++;if(finite<depth.length*.98)throw new Error(`Depth Anything: output non finito (${finite}/${depth.length})`);\n"
        new=old+"  depthDebug('infer-ok',{provider:activeProvider,input:[prep.width,prep.height],output:[w,h],outputName,finite,total:depth.length,inferenceMs:Math.round((performance.now()-inferT0)*10)/10});\n"
        src,did=once(src,old,new,"infer output validation")
        if did: changes.append("logged validated inference output and timing")

    # Command stage and snapshots. Successful normal infer payload remains small.
    if "depthDebug('message'" not in src:
        src,did=once(
            src,
            "self.onmessage = async (event) => {\n  const msg = event.data || {};\n  const id = msg.id;\n",
            "self.onmessage = async (event) => {\n  const msg = event.data || {};\n  const id = msg.id;\n  depthDebug('message',{type:msg.type||'',id:id??null});\n",
            "worker message entry",
        )
        if did: changes.append("logged worker command stage")

    if "debug: depthDebugSnapshot('init-ok')" not in src:
        old="        contract: validateDepthContract(session), modelIntegrity, wasmPaths: ortApi.env.wasm.wasmPaths,\n"
        new="        contract: validateDepthContract(session), modelIntegrity, wasmPaths: ortApi.env.wasm.wasmPaths,\n        debug: depthDebugSnapshot('init-ok'),\n"
        src,did=once(src,old,new,"init response debug snapshot")
        if did: changes.append("attached worker trace to init response")

    if "depthDebugSnapshot('smoke-ok')" not in src:
        old="modelIntegrity,wasmPaths:ortApi.env.wasm.wasmPaths});\n"
        new="modelIntegrity,wasmPaths:ortApi.env.wasm.wasmPaths,debug:depthDebugSnapshot('smoke-ok')});\n"
        src,did=once(src,old,new,"smoke response debug snapshot")
        if did: changes.append("attached worker trace to smoke response")

    if "depthDebugSnapshot('command-failed')" not in src:
        old="    self.postMessage({ id, ok: false, error: errText(e), provider: activeProvider, modelSource, runtimeSource });\n"
        new="    depthDebug('command-failed',{type:msg.type||'',error:errText(e),stack:String(e?.stack||'')});\n    self.postMessage({ id, ok: false, error: errText(e), provider: activeProvider, modelSource, runtimeSource, debug:depthDebugSnapshot('command-failed') });\n"
        src,did=once(src,old,new,"worker error response")
        if did: changes.append("attached worker trace to every worker command error")

    return src, changes


def patch_html(src):
    changes=[]

    # Clean up our older, global debug guard if the user applied the previous package.
    guard='<script src="./depth_anything_debug_guard.js" data-depth-anything-debug-guard="1"></script>\n'
    if guard in src:
        src=src.replace(guard,'',1);changes.append("removed obsolete previous external debug guard")

    # Capture debug payload before promise resolution/rejection.
    old="S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{},p=S.depthAI.pending.get(m.id);"
    new="S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{};if(m.debug)S.depthAI.lastWorkerDebug=m.debug;const p=S.depthAI.pending.get(m.id);"
    if "if(m.debug)S.depthAI.lastWorkerDebug=m.debug" not in src:
        src,did=once(src,old,new,"DepthAI worker message plumbing")
        if did: changes.append("stored worker-local debug snapshot in DepthAI state")

    # Capture a real Worker error (syntax/load/crash) without wrapping Worker globally.
    if "stage:'worker-onerror'" not in src:
        old="W.onerror=e=>{S.depthAI.lastError=e.message||'DepthAI worker crash';"
        new="W.onerror=e=>{S.depthAI.lastWorkerDebug={schema:'room-scanner-depthai-debug-v3',stage:'worker-onerror',generatedAt:new Date().toISOString(),message:e?.message||'DepthAI worker crash',filename:e?.filename||'',lineno:e?.lineno||0,colno:e?.colno||0};S.depthAI.lastError=e.message||'DepthAI worker crash';"
        src,did=once(src,old,new,"DepthAI worker onerror diagnostics")
        if did: changes.append("captured dedicated DepthAI worker crash location/details")

    # Existing diagnostic export gains only DepthAI fields.
    old="lastError:S.depthAI.lastError,alignment:S.depthAI.alignment.slice(-8)"
    new="lastError:S.depthAI.lastError,lastSmoke:S.depthAI.lastSmoke||null,wasmPaths:S.depthAI.wasmPaths||null,modelIntegrity:S.depthAI.modelIntegrity||null,lastWorkerDebug:S.depthAI.lastWorkerDebug||null,forceWasm:!!S.depthAI.forceWasm,alignment:S.depthAI.alignment.slice(-8)"
    if "lastWorkerDebug:S.depthAI.lastWorkerDebug||null" not in src:
        src,did=once(src,old,new,"diagnosticSnapshot DepthAI fields")
        if did: changes.append("expanded existing diagnostic export with DepthAI trace")

    # Add button dynamically beside the existing diagnostic button (avoids changing templates).
    if 'id="v10CopyDepthDiag"' not in src:
        anchor="$('#v10ExportDiag')?.insertAdjacentHTML('beforebegin','<button type=\"button\" id=\"v10SaveRawDetails\">⇩ Scarica RAW</button> ');\n"
        insert=anchor+"$('#v10ExportDiag')?.insertAdjacentHTML('beforebegin','<button type=\"button\" id=\"v10CopyDepthDiag\">Copia log Depth AI</button> ');\n"
        src,did=once(src,anchor,insert,"V10 diagnostic button insertion")
        if did: changes.append("added visible Copy Depth AI log button")

    # Paste-ready JSON. Read-only; does not alter scanning/model state.
    if "Log Depth AI copiato" not in src:
        old="$('#v10ExportDiag').onclick=()=>exportDiagnosticSnapshot?.();"
        new=r'''$('#v10CopyDepthDiag').onclick=async()=>{const d={schema:'room-scanner-depthai-debug-v3',generatedAt:new Date().toISOString(),appBuild:typeof APP_BUILD!=='undefined'?APP_BUILD:null,deployRev:typeof DEPLOY_REV!=='undefined'?DEPLOY_REV:null,environment:{href:location.href,userAgent:navigator.userAgent,secureContext:isSecureContext,crossOriginIsolated:window.crossOriginIsolated,webgpu:!!navigator.gpu,hardwareConcurrency:navigator.hardwareConcurrency||null},depthAI:diagnosticSnapshot().depthAI,v10Log:Array.isArray(S.v10Log)?S.v10Log.slice():[]},txt=JSON.stringify(d,null,2);try{await navigator.clipboard.writeText(txt);v10Log(`Log Depth AI copiato (${txt.length} caratteri)`,'ok')}catch(e){v10Log(`Copia log Depth AI fallita: ${e?.message||e}`,'error');window.prompt('Copia il log Depth AI:',txt)}};$('#v10ExportDiag').onclick=()=>exportDiagnosticSnapshot?.();'''
        src,did=once(src,old,new,"DepthAI copy-log handler")
        if did: changes.append("added read-only paste-ready DepthAI JSON copy handler")

    return src, changes


def diff(a,b,name):
    return ''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile=name+'.before',tofile=name+'.after'))


def main():
    ap=argparse.ArgumentParser();ap.add_argument('folder');args=ap.parse_args();root=Path(args.folder).resolve()
    hp=root/'room_scanner_v10.html';wp=root/'depth_ai_worker.js'
    if not hp.is_file() or not wp.is_file(): raise SystemExit('ERROR: room_scanner_v10.html and depth_ai_worker.js must both exist in target folder')
    h0=hp.read_text(encoding='utf-8');w0=wp.read_text(encoding='utf-8')
    try:
        w1,wc=patch_worker(w0);h1,hc=patch_html(h0)
    except RuntimeError as e:
        raise SystemExit('PATCH REFUSED (source did not match expected current V10): '+str(e))

    # Fail closed: don't write anything until BOTH files fully patch in memory.
    hb=hp.with_suffix(hp.suffix+'.depthai_v3.bak');wb=wp.with_suffix(wp.suffix+'.depthai_v3.bak')
    if not hb.exists(): hb.write_text(h0,encoding='utf-8')
    if not wb.exists(): wb.write_text(w0,encoding='utf-8')
    hp.write_text(h1,encoding='utf-8');wp.write_text(w1,encoding='utf-8')

    report={'patch':'room-scanner-depthai-replacement-v3','files_modified':['room_scanner_v10.html','depth_ai_worker.js'],'changes':wc+hc,'not_modified_by_design':['sw.js','WebXR acquisition','audio','geometry','SAM/MobileSAM','splatting','preprocessing/inference math','metric fitting','fusion thresholds']}
    (root/'depthai_patch_v3_report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
    (root/'depthai_patch_v3.diff').write_text(diff(w0,w1,'depth_ai_worker.js')+'\n'+diff(h0,h1,'room_scanner_v10.html'),encoding='utf-8')
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=='__main__': main()
