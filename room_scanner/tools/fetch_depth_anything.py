#!/usr/bin/env python3
"""Fetch Depth Anything V2 Small Q4F16 for cooperative keyframe detail refinement.

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
EXPECTED_SHA256 = 'eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e'
EXPECTED_BYTES = 19_126_267

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.onnx.part')
    req = urllib.request.Request(URL, headers={'User-Agent': 'room-scanner-v951-depthai-fetch/1.0'})
    print('Downloading Depth Anything V2 Small Q4F16 (~19.1 MB) ...')
    with urllib.request.urlopen(req, timeout=120) as r, tmp.open('wb') as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    if tmp.stat().st_size != EXPECTED_BYTES:
        got_size=tmp.stat().st_size;tmp.unlink(missing_ok=True)
        raise SystemExit(f'Depth Anything size mismatch: {got_size} != {EXPECTED_BYTES}')
    got = digest(tmp)
    if got != EXPECTED_SHA256:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f'Depth Anything SHA256 mismatch: {got}')
    tmp.replace(OUT)
    print(f'OK {OUT.relative_to(ROOT)} {OUT.stat().st_size} bytes sha256={got}')

if __name__ == '__main__':
    main()
