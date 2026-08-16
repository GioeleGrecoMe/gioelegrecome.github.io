#!/usr/bin/env python3
"""Fetch both Depth Anything V2 Small variants required by the web worker.

The scanner uses the single-file ONNX Community conversion requested by the
project.  The checksum is pinned so GitHub Pages deployments cannot silently
serve a truncated/Xet pointer file instead of the real model.
"""
from __future__ import annotations
import hashlib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'models' / 'depth_anything_v2_small_q4f16.onnx'
URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4f16.onnx?download=true'
OUT_WASM = ROOT / 'models' / 'depth_anything_v2_small_q4.onnx'
URL_WASM = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4.onnx?download=true'
EXPECTED_SHA256 = 'eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e'
EXPECTED_BYTES = 19_126_267
EXPECTED_WASM_SHA256 = '5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8'
EXPECTED_WASM_BYTES = 27_404_416

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def fetch(url: str, out: Path, expected_bytes: int, expected_sha256: str, label: str) -> None:
    tmp = out.with_suffix('.onnx.part')
    req = urllib.request.Request(url, headers={'User-Agent': 'room-scanner-v10-depthai-fetch/1.0'})
    print(f'Downloading {label} ...')
    with urllib.request.urlopen(req, timeout=120) as r, tmp.open('wb') as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    if tmp.stat().st_size != expected_bytes:
        got_size=tmp.stat().st_size;tmp.unlink(missing_ok=True)
        raise SystemExit(f'{label} size mismatch: {got_size} != {expected_bytes}')
    got = digest(tmp)
    if got != expected_sha256:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f'{label} SHA256 mismatch: {got}')
    tmp.replace(out)
    print(f'OK {out.relative_to(ROOT)} {out.stat().st_size} bytes sha256={got}')

def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fetch(URL, OUT, EXPECTED_BYTES, EXPECTED_SHA256, 'Depth Anything V2 Small Q4F16 (WebGPU, ~19.1 MB)')
    fetch(URL_WASM, OUT_WASM, EXPECTED_WASM_BYTES, EXPECTED_WASM_SHA256, 'Depth Anything V2 Small Q4 (WASM, ~27.4 MB)')

if __name__ == '__main__':
    main()
