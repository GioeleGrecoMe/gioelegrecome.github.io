#!/usr/bin/env python3
"""Check whether a Room Scanner folder is ready for deterministic GitHub Pages deployment.

This does not execute MobileSAM. It verifies that the same-origin runtime/model
files expected by the HTML are present and non-trivially sized, which catches the
most common reason Step 3 is skipped after publishing only the HTML.
"""
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
checks=[
    (ROOT/'room_scanner_v9.html', 100_000, 'application shell'),
    (ROOT/'sw.js', 500, 'service worker'),
    (ROOT/'models/mobilesam.encoder.onnx', 10_000_000, 'MobileSAM encoder'),
    (ROOT/'models/mobilesam.decoder.quant.onnx', 2_000_000, 'MobileSAM decoder'),
    (ROOT/'vendor/ort.min.js', 100_000, 'ONNX Runtime Web JS'),
]
wasm=[ROOT/'vendor/ort-wasm-simd-threaded.wasm',ROOT/'vendor/ort-wasm-simd.wasm',ROOT/'vendor/ort-wasm-threaded.wasm',ROOT/'vendor/ort-wasm.wasm']
ok=True
for path,min_size,label in checks:
    present=path.exists() and path.stat().st_size>=min_size
    print(f"{'OK' if present else 'MISSING'}  {label:24s} {path.relative_to(ROOT)}" + (f"  {path.stat().st_size} bytes" if path.exists() else ''))
    ok &= present
wasm_ok=any(p.exists() and p.stat().st_size>100_000 for p in wasm)
print(f"{'OK' if wasm_ok else 'MISSING'}  {'ORT WASM binary':24s} vendor/ort-wasm*.wasm")
ok &= wasm_ok
print('\nMOBILESAM_LOCAL_READY=' + ('yes' if ok else 'no'))
if not ok:
    print('Run tools/fetch_mobilesam_models.py and tools/fetch_onnxruntime_web.py before deploying.', file=sys.stderr)
    raise SystemExit(2)
