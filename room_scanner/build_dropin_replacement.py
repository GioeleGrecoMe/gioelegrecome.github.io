#!/usr/bin/env python3
"""Build drop-in Room Scanner V10 Depth Anything replacements without modifying the source folder.

Input can be either:
  1) a local room_scanner directory containing room_scanner_v10.html + depth_ai_worker.js, or
  2) --from-public, which downloads the current public files from GitHub Pages.

Output:
  replacement/room_scanner_v10.html
  replacement/depth_ai_worker.js
  replacement/DEPTH_FIX_MANIFEST.json

The transformation is fail-closed: if the expected current V10 anchors are not found exactly,
no replacement is produced.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

from patch_depth_v3 import patch_html, patch_worker

PUBLIC_BASE = 'https://gioelegrecome.github.io/room_scanner/'
FILES = ('room_scanner_v10.html', 'depth_ai_worker.js')


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        'User-Agent': 'RoomScanner-DepthAI-ReplacementBuilder/3.0',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        if getattr(r, 'status', 200) != 200:
            raise RuntimeError(f'HTTP {getattr(r, "status", "?")} for {url}')
        return r.read()


def read_source(source_dir: Path | None, from_public: bool) -> dict[str, bytes]:
    if from_public:
        return {name: fetch(PUBLIC_BASE + name + '?depthfix_source=3') for name in FILES}
    if source_dir is None:
        raise RuntimeError('Specify a source directory or --from-public')
    out = {}
    for name in FILES:
        p = source_dir / name
        if not p.is_file():
            raise RuntimeError(f'Missing required source file: {p}')
        out[name] = p.read_bytes()
    return out


def validate_source(html: str, worker: str) -> None:
    checks = [
        ("depthAIWorker:'./depth_ai_worker.js'", html, 'V10 DepthAI worker config'),
        ("depthAIRuntimeVersion:'1.23.2'", html, 'V10 DepthAI runtime version'),
        ('new Worker(versionedLocalAsset(CFG.depthAIWorker))', html, 'dedicated DepthAI worker creation'),
        ("const localRuntimeDir = './vendor/depthai-123/';", worker, 'isolated ORT runtime folder'),
        ("const remote = /^https?:/i.test(runtimeSource);", worker, 'current origin-routing bug anchor'),
        ("runtimeVersion = String(msg.runtimeVersion || '1.24.1');", worker, 'stale worker fallback anchor'),
        ("DEPTH_MODEL_PIN", worker, 'pinned Depth Anything model integrity check'),
    ]
    missing = [label for needle, text, label in checks if needle not in text]
    if missing:
        raise RuntimeError('Source does not match the reviewed V10 build; refusing to patch: ' + ', '.join(missing))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('source_dir', nargs='?', type=Path, help='Local room_scanner folder')
    ap.add_argument('--from-public', action='store_true', help='Fetch current public V10 + worker')
    ap.add_argument('-o', '--output', type=Path, default=Path('replacement'))
    args = ap.parse_args()

    try:
        src = read_source(args.source_dir, args.from_public)
        html0 = src['room_scanner_v10.html'].decode('utf-8')
        worker0 = src['depth_ai_worker.js'].decode('utf-8')
        validate_source(html0, worker0)
        worker1, worker_changes = patch_worker(worker0)
        html1, html_changes = patch_html(html0)
    except Exception as e:
        print(f'BUILD REFUSED: {e}', file=sys.stderr)
        return 2

    out = args.output.resolve()
    tmp = Path(tempfile.mkdtemp(prefix='depthfix-', dir=str(out.parent if out.parent.exists() else Path.cwd())))
    try:
        (tmp / 'room_scanner_v10.html').write_text(html1, encoding='utf-8')
        (tmp / 'depth_ai_worker.js').write_text(worker1, encoding='utf-8')
        manifest = {
            'schema': 'room-scanner-depthai-replacement-v3',
            'source': 'public GitHub Pages' if args.from_public else str(args.source_dir.resolve()),
            'source_sha256': {k: sha256_bytes(v) for k, v in src.items()},
            'replacement_sha256': {
                'room_scanner_v10.html': sha256_bytes(html1.encode('utf-8')),
                'depth_ai_worker.js': sha256_bytes(worker1.encode('utf-8')),
            },
            'changes': worker_changes + html_changes,
            'unchanged_by_design': [
                'sw.js', 'WebXR acquisition', 'camera capture', 'audio', 'geometry',
                'SAM/MobileSAM', 'splatting', 'Depth preprocessing math',
                'metric alignment/fitting', 'fusion gates/thresholds'
            ],
            'required_existing_assets': [
                'vendor/depthai-123/ (existing ORT 1.23.2 runtime assets)',
                'models/depth_anything_v2_small_q4f16.onnx (existing model)'
            ],
        }
        (tmp / 'DEPTH_FIX_MANIFEST.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
        (tmp / 'DEPLOY.txt').write_text(
            'Replace ONLY room_scanner_v10.html and depth_ai_worker.js with these files.\n'
            'Leave sw.js, vendor/depthai-123/, models/, WebXR/audio/geometry files unchanged.\n'
            'After deployment hard-refresh once, start V10, and use "Copia log Depth AI" if preflight fails.\n',
            encoding='utf-8')
        if out.exists():
            shutil.rmtree(out)
        tmp.rename(out)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise

    print(json.dumps({'ok': True, 'output': str(out), 'changes': worker_changes + html_changes}, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
