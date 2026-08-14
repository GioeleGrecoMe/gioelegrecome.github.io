#!/usr/bin/env python3
"""Vendor ONNX Runtime Web 1.14.0 assets used by the MobileSAM browser path."""
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'vendor'
BASE='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/'
FILES=[
    'ort.min.js',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd.wasm',
    'ort-wasm-threaded.wasm',
    'ort-wasm.wasm',
    'ort-wasm-threaded.worker.js',
]
OUT.mkdir(parents=True,exist_ok=True)
for name in FILES:
    dst=OUT/name
    print('fetch',name)
    urllib.request.urlretrieve(BASE+name,dst)
print('installed',len(FILES),'files in',OUT)
