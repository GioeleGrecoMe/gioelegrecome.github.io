#!/usr/bin/env python3
"""Vendor the exact ONNX Runtime Web files used by Room Scanner v9.2.4.

Run this once on the machine that prepares/hosts the site. The browser then loads
ONNX Runtime from ./vendor and does not need a network request during scanning.
"""
from pathlib import Path
from urllib.request import urlopen, Request
import hashlib

VERSION = "1.27.0"
BASE = f"https://cdn.jsdelivr.net/npm/onnxruntime-web@{VERSION}/dist/"
FILES = (
    "ort.webgpu.bundle.min.mjs",
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.wasm",
)
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "vendor"
OUT.mkdir(parents=True, exist_ok=True)

for name in FILES:
    url = BASE + name
    print(f"fetch {url}")
    req = Request(url, headers={"User-Agent": "RoomScanner-v9.2.4-vendor"})
    with urlopen(req, timeout=120) as response:
        data = response.read()
    if not data:
        raise SystemExit(f"empty download: {name}")
    path = OUT / name
    path.write_bytes(data)
    print(f"  {name}: {len(data):,} bytes sha256={hashlib.sha256(data).hexdigest()}")

print("ONNX Runtime Web vendored successfully.")
