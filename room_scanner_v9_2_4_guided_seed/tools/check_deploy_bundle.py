#!/usr/bin/env python3
"""Check deterministic/offline deployment readiness for Room Scanner v9.5.1 Hotfix5W.

The application can fall back to remote model/runtime URLs, so a missing neural
asset never blocks WebXR. This script is deliberately stricter: it reports when
the folder is actually self-contained for MobileSAM and the Stage-5 DepthAI pass.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

def good(path: Path, minimum: int) -> bool:
    return path.exists() and path.stat().st_size >= minimum

def report(path: Path, minimum: int, label: str) -> bool:
    ok = good(path, minimum)
    size = f'  {path.stat().st_size} bytes' if path.exists() else ''
    print(f"{'OK' if ok else 'MISSING'}  {label:30s} {path.relative_to(ROOT)}{size}")
    return ok

shell = report(ROOT/'room_scanner_v9.html', 100_000, 'application shell')
shell &= report(ROOT/'sw.js', 500, 'service worker')
shell &= report(ROOT/'depth_ai_worker.js', 2_000, 'DepthAI worker')

mobile = report(ROOT/'models/mobilesam.encoder.onnx', 10_000_000, 'MobileSAM encoder')
mobile &= report(ROOT/'models/mobilesam.decoder.onnx', 10_000_000, 'MobileSAM decoder FP32')
mobile &= report(ROOT/'models/mobilesam.decoder.quant.onnx', 2_000_000, 'MobileSAM decoder quant fallback')
mobile &= report(ROOT/'vendor/ort.min.js', 100_000, 'MobileSAM ORT JS')
mobile_wasm = any(good(p, 100_000) for p in [
    ROOT/'vendor/ort-wasm-simd-threaded.wasm', ROOT/'vendor/ort-wasm-simd.wasm',
    ROOT/'vendor/ort-wasm-threaded.wasm', ROOT/'vendor/ort-wasm.wasm'])
print(f"{'OK' if mobile_wasm else 'MISSING'}  {'MobileSAM ORT WASM':30s} vendor/ort-wasm*.wasm")
mobile &= mobile_wasm

depth_model = report(ROOT/'models/depth_anything_v2_small_q4f16.onnx', 18_000_000, 'Depth Anything Q4F16')
depth_js = report(ROOT/'vendor/depthai/ort.min.js', 100_000, 'DepthAI ORT WASM JS')
depth_wasm = report(ROOT/'vendor/depthai/ort-wasm-simd-threaded.wasm', 1_000_000, 'DepthAI WASM binary')
depth_wasm_ready = depth_model and depth_js and depth_wasm

depth_webgpu_js = report(ROOT/'vendor/depthai/ort.webgpu.min.js', 20_000, 'DepthAI ORT WebGPU JS')
depth_jsep = report(ROOT/'vendor/depthai/ort-wasm-simd-threaded.jsep.wasm', 1_000_000, 'DepthAI WebGPU/JSEP WASM')
depth_webgpu_ready = depth_model and depth_webgpu_js and depth_jsep

print('\nSHELL_READY=' + ('yes' if shell else 'no'))
print('MOBILESAM_LOCAL_READY=' + ('yes' if mobile else 'no'))
print('DEPTHAI_LOCAL_WASM_READY=' + ('yes' if depth_wasm_ready else 'no'))
print('DEPTHAI_LOCAL_WEBGPU_READY=' + ('yes' if depth_webgpu_ready else 'no'))
full = shell and mobile and depth_wasm_ready
print('FULL_LOCAL_READY=' + ('yes' if full else 'no'))
if not full:
    print('\nFor a self-contained deployment run:', file=sys.stderr)
    print('  python3 tools/fetch_mobilesam_models.py', file=sys.stderr)
    print('  python3 tools/fetch_onnxruntime_web.py', file=sys.stderr)
    print('  python3 tools/fetch_depth_anything.py', file=sys.stderr)
    print('  python3 tools/fetch_depthai_runtime.py', file=sys.stderr)
    raise SystemExit(2)
