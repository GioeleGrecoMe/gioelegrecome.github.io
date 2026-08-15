#!/usr/bin/env python3
"""Check deterministic/offline deployment readiness for Room Scanner v9.5.1 Hotfix5W6.

The application can fall back to remote model/runtime URLs, so a missing neural
asset never blocks WebXR. This script is deliberately stricter: it reports when
the folder is actually self-contained for MobileSAM and the cooperative DepthAI worker/final pass.
"""
from pathlib import Path
import sys, hashlib, json

ROOT = Path(__file__).resolve().parents[1]

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def exact(path: Path, size: int, digest: str, label: str) -> bool:
    ok=path.exists() and path.stat().st_size==size and sha256(path)==digest
    got=f'{path.stat().st_size} B sha256={sha256(path)}' if path.exists() else 'missing'
    print(f"{'OK' if ok else 'BAD'}  {label:30s} {path.relative_to(ROOT)}  {got}")
    return ok

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

mobile = exact(ROOT/'models/mobilesam.encoder.onnx',28195125,'4125037c5e24d6ea58e201b20e8d8fbbbd1135c0b881e34a8074b8c4f07e6918','MobileSAM encoder')
mobile &= exact(ROOT/'models/mobilesam.decoder.onnx',16514086,'b0735abf07c7affddf20fffc3ce750f44af387ee6a7323880e909389ed15d279','MobileSAM decoder FP32')
mobile &= exact(ROOT/'models/mobilesam.decoder.quant.onnx',8837301,'1ef83e7921d0adc571f446849741e556e948fdd976be06f4e33f17ca675829bc','MobileSAM decoder quant')
manifest=ROOT/'models/mobilesam.manifest.json'
if manifest.exists():
    try:
        m=json.loads(manifest.read_text()); manifest_ok=m.get('bundle')=='MobileSAM-in-the-Browser coherent split' and all(m.get('files',{}).get(n,{}).get('sha256')==h for n,h in {
          'mobilesam.encoder.onnx':'4125037c5e24d6ea58e201b20e8d8fbbbd1135c0b881e34a8074b8c4f07e6918',
          'mobilesam.decoder.onnx':'b0735abf07c7affddf20fffc3ce750f44af387ee6a7323880e909389ed15d279',
          'mobilesam.decoder.quant.onnx':'1ef83e7921d0adc571f446849741e556e948fdd976be06f4e33f17ca675829bc'}.items())
    except Exception: manifest_ok=False
else: manifest_ok=False
print(f"{'OK' if manifest_ok else 'BAD'}  {'MobileSAM manifest':30s} models/mobilesam.manifest.json")
mobile &= manifest_ok
mobile &= report(ROOT/'vendor/ort.min.js', 100_000, 'MobileSAM ORT JS')
mobile_wasm = any(good(p, 100_000) for p in [
    ROOT/'vendor/ort-wasm-simd-threaded.wasm', ROOT/'vendor/ort-wasm-simd.wasm',
    ROOT/'vendor/ort-wasm-threaded.wasm', ROOT/'vendor/ort-wasm.wasm'])
print(f"{'OK' if mobile_wasm else 'MISSING'}  {'MobileSAM ORT WASM':30s} vendor/ort-wasm*.wasm")
mobile &= mobile_wasm

depth_model = exact(ROOT/'models/depth_anything_v2_small_q4f16.onnx',19126267,'eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e','Depth Anything Q4F16')
depth_runtime = ROOT/'vendor/depthai-123'
depth_js = report(depth_runtime/'ort.min.js', 100_000, 'DepthAI ORT 1.23 WASM JS')
depth_wasm = report(depth_runtime/'ort-wasm-simd-threaded.wasm', 1_000_000, 'DepthAI 1.23 WASM binary')
depth_wasm_ready = depth_model and depth_js and depth_wasm

depth_webgpu_js = report(depth_runtime/'ort.webgpu.min.js', 20_000, 'DepthAI ORT 1.23 WebGPU JS')
depth_jsep = report(depth_runtime/'ort-wasm-simd-threaded.jsep.wasm', 1_000_000, 'DepthAI 1.23 WebGPU/JSEP WASM')
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
