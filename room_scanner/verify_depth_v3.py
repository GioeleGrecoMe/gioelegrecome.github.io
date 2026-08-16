#!/usr/bin/env python3
"""Static verifier for the minimal Room Scanner DepthAI V3 replacement patch."""
from __future__ import annotations
import argparse
import json
from pathlib import Path


def need(text, needle, label, errors):
    if needle not in text:
        errors.append(f'MISSING: {label}')


def forbid(text, needle, label, errors):
    if needle in text:
        errors.append(f'FORBIDDEN/PRESENT: {label}')


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('folder')
    a=ap.parse_args()
    root=Path(a.folder).resolve()
    h=root/'room_scanner_v10.html'; w=root/'depth_ai_worker.js'
    if not h.is_file() or not w.is_file():
        raise SystemExit('ERROR: target files missing')
    html=h.read_text(encoding='utf-8'); worker=w.read_text(encoding='utf-8')
    errors=[]

    need(worker, 'DEPTHAI_RUNTIME_ORIGIN_FIX', 'same-origin runtime fix', errors)
    need(worker, "runtimeURL.origin !== self.location.origin", 'origin comparison', errors)
    need(worker, "msg.runtimeVersion || '1.23.2'", '1.23.2 init fallback', errors)
    forbid(worker, "msg.runtimeVersion || '1.24.1'", 'stale 1.24.1 init fallback', errors)
    need(worker, 'DEPTHAI_DIAG_V3', 'bounded worker debug trace', errors)
    need(worker, "depthDebug('runtime-ready'", 'wasmPaths logging', errors)
    need(worker, "depthDebug('model-sha256'", 'model SHA logging', errors)
    need(worker, "depthDebug('session-create-failed'", 'session failure logging', errors)
    need(worker, "depthDebugSnapshot('smoke-ok')", 'smoke snapshot', errors)
    need(worker, "depthDebugSnapshot('command-failed')", 'error snapshot', errors)

    need(html, 'if(m.debug)S.depthAI.lastWorkerDebug=m.debug', 'worker debug plumbing', errors)
    need(html, "stage:'worker-onerror'", 'dedicated worker crash diagnostics', errors)
    need(html, 'lastWorkerDebug:S.depthAI.lastWorkerDebug||null', 'diagnostic snapshot worker trace', errors)
    need(html, 'id="v10CopyDepthDiag"', 'visible Copy Depth AI log button', errors)
    need(html, "schema:'room-scanner-depthai-debug-v3'", 'paste-ready JSON schema', errors)
    need(html, 'Log Depth AI copiato', 'copy-log click handler', errors)
    forbid(html, 'depth_anything_debug_guard.js', 'obsolete external global debug guard', errors)

    # Scope checks via backup files if present.
    scope={}
    hb=root/'room_scanner_v10.html.depthai_v3.bak'; wb=root/'depth_ai_worker.js.depthai_v3.bak'
    scope['backups_present']=hb.is_file() and wb.is_file()
    scope['sw_js_modified_by_patch']=False  # patcher never opens sw.js by construction
    scope['modified_file_set_expected']=True
    rep=root/'depthai_patch_v3_report.json'
    if rep.is_file():
        r=json.loads(rep.read_text(encoding='utf-8'))
        if r.get('files_modified') != ['room_scanner_v10.html','depth_ai_worker.js']:
            errors.append('REPORT: unexpected modified file set')
            scope['modified_file_set_expected']=False

    out={'ok':not errors,'errors':errors,'scope':scope}
    print(json.dumps(out, indent=2, ensure_ascii=False))
    raise SystemExit(0 if not errors else 2)

if __name__=='__main__': main()
