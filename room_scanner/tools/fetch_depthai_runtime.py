#!/usr/bin/env python3
"""Vendor ONNX Runtime Web 1.24.1 assets for the Depth Anything worker.

The DepthAI worker is intentionally isolated from MobileSAM's pinned ORT 1.14
runtime. Both WebGPU/JSEP and universal WASM assets are downloaded so a deployed
folder can operate without CDN access after the first page load.
"""
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'vendor' / 'depthai'
BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/'
FILES = [
    'ort.min.js',
    'ort.webgpu.min.js',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
]
OUT.mkdir(parents=True, exist_ok=True)
for name in FILES:
    dst = OUT / name
    print('fetch', name)
    req = urllib.request.Request(BASE + name, headers={'User-Agent': 'room-scanner-v951-depthai-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r, dst.open('wb') as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    if dst.stat().st_size < 10_000:
        dst.unlink(missing_ok=True)
        raise SystemExit(f'incomplete runtime file: {name}')
print('installed', len(FILES), 'DepthAI runtime files in', OUT)
