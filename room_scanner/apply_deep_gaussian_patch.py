#!/usr/bin/env python3
"""Apply the V20.3 Deep/Gaussian overlay without replacing the user's V20.2.x UI/app.

Usage:
    python3 apply_deep_gaussian_patch.py /path/to/room_scanner_root

The patch intentionally edits only the worker URLs used by capture/processing and
(optionally) the service-worker cache manifest. Every edited file is backed up.
"""
from __future__ import annotations
import argparse
import datetime as dt
import pathlib
import re
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
PAYLOAD = {
    "workers/map_worker_v20_3_0.js": HERE / "workers/map_worker_v20_3_0.js",
    "workers/processing_worker_v20_3_0.js": HERE / "workers/processing_worker_v20_3_0.js",
    "workers/depth_ai_worker_v20_3_0.js": HERE / "workers/depth_ai_worker_v20_3_0.js",
    "js/reconstruction_v20_3_0.js": HERE / "js/reconstruction_v20_3_0.js",
}

def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(2)

def backup(path: pathlib.Path, backup_root: pathlib.Path, root: pathlib.Path) -> None:
    if not path.exists():
        return
    rel = path.relative_to(root)
    dst = backup_root / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dst)

def replace_one(path: pathlib.Path, old: str, new: str, backup_root: pathlib.Path, root: pathlib.Path) -> bool:
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    if new in text:
        return True
    if old not in text:
        return False
    backup(path, backup_root, root)
    path.write_text(text.replace(old, new), encoding="utf-8")
    return True

def patch_service_worker(path: pathlib.Path, backup_root: pathlib.Path, root: pathlib.Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    # A new cache name avoids mixing the new workers with an older cached graph.
    text = re.sub(r"const\s+CACHE\s*=\s*['\"][^'\"]+['\"]", "const CACHE='room-scanner-v20.3.0-deep-gaussian'", text, count=1)
    required = [
        "./workers/map_worker_v20_3_0.js",
        "./workers/processing_worker_v20_3_0.js",
        "./workers/depth_ai_worker_v20_3_0.js",
        "./js/reconstruction_v20_3_0.js",
    ]
    if "const SHELL" in text:
        missing = [x for x in required if x not in text]
        if missing:
            marker = "];"
            start = text.find("const SHELL")
            end = text.find(marker, start)
            if end >= 0:
                insertion = "," + ",".join(repr(x) for x in missing)
                text = text[:end] + insertion + text[end:]
    if text != original:
        backup(path, backup_root, root)
        path.write_text(text, encoding="utf-8")
    return all(x in text for x in required)

def syntax_check(root: pathlib.Path, paths: list[pathlib.Path]) -> None:
    node = shutil.which("node")
    if not node:
        print("WARN: node non disponibile; salto node --check")
        return
    failures = []
    for p in paths:
        if p.suffix != ".js" or not p.exists():
            continue
        run = subprocess.run([node, "--check", str(p)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if run.returncode:
            failures.append((p, run.stderr.strip()))
    if failures:
        for p, err in failures:
            print(f"SYNTAX ERROR {p.relative_to(root)}:\n{err}", file=sys.stderr)
        raise SystemExit(3)

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default=".", help="root del sito Room Scanner")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    capture = root / "js/xr_capture_v20_2_0.js"
    processing_ui = root / "js/processing_ui_v20_2_0.js"
    if not capture.exists():
        fail(f"non trovo {capture}")
    if not processing_ui.exists():
        fail(f"non trovo {processing_ui}")

    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_root = root / f"backup_before_v20_3_{stamp}"
    backup_root.mkdir(parents=True, exist_ok=True)

    for rel, src in PAYLOAD.items():
        if not src.exists():
            fail(f"payload mancante: {src}")
        dst = root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        backup(dst, backup_root, root)
        shutil.copy2(src, dst)

    if not replace_one(capture, "map_worker_v20_2_0.js", "map_worker_v20_3_0.js", backup_root, root):
        fail("non trovo il riferimento map_worker_v20_2_0.js nel capture: nessuna patch distruttiva automatica")
    if not replace_one(processing_ui, "processing_worker_v20_2_0.js", "processing_worker_v20_3_0.js", backup_root, root):
        fail("non trovo il riferimento processing_worker_v20_2_0.js nella UI processing")

    # Optional, conservative online RGB enrichment. Some V20.2.x builds send
    # photoEvidence for visible grid tiles. If the exact known expression is
    # present, add a tiny 3x3 RGB sample. If the user's customized capture no
    # longer matches this shape, leave it untouched; post-XR Deep still colors
    # every accepted dense Gaussian.
    capture_text = capture.read_text(encoding="utf-8")
    old_hits = "hits:linkedTiles.map(t=>({key:t.tileId,uv:t.uv}))"
    new_hits = "hits:linkedTiles.map(t=>({key:t.tileId,uv:t.uv,rgb:sampleRgbAtUv(capture.rgba,capture.width,capture.height,t.uv)}))"
    if old_hits in capture_text and "function sampleRgbAtUv" not in capture_text:
        backup(capture, backup_root, root)
        capture_text = capture_text.replace(old_hits, new_hits)
        anchor = "function dot(a,b){"
        helper = "function sampleRgbAtUv(rgba,w,h,uv){if(!uv||!rgba?.length)return null;const cx=Math.max(1,Math.min(w-2,Math.round(uv[0]*(w-1)))),cy=Math.max(1,Math.min(h-2,Math.round(uv[1]*(h-1)))),sum=[0,0,0];let n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((cy+dy)*w+(cx+dx))*4;sum[0]+=rgba[i];sum[1]+=rgba[i+1];sum[2]+=rgba[i+2];n++;}return sum.map(v=>Math.round(v/n));}\n"
        if anchor in capture_text:
            capture_text = capture_text.replace(anchor, helper + anchor, 1)
            capture.write_text(capture_text, encoding="utf-8")
        else:
            print("WARN: photoEvidence RGB non applicato: helper anchor non trovato")

    sw_candidates = sorted(root.glob("sw*.js"))
    sw_ok = False
    for sw in sw_candidates:
        try:
            sw_ok = patch_service_worker(sw, backup_root, root) or sw_ok
        except Exception as exc:
            print(f"WARN: service worker non patchato ({sw.name}): {exc}")

    checked = [capture, processing_ui, *(root / rel for rel in PAYLOAD)] + sw_candidates
    syntax_check(root, checked)

    note = root / "DEEP_GAUSSIAN_PATCH_APPLIED.txt"
    note.write_text(
        "Room Scanner V20.3 Deep Gaussian overlay\n"
        f"Applied: {dt.datetime.now().isoformat(timespec='seconds')}\n"
        f"Backup: {backup_root.name}\n"
        "Capture UI/app preserved; only map/processing worker routing changed.\n"
        f"Service worker cache updated: {'yes' if sw_ok else 'no - clear site cache once after deploy'}\n",
        encoding="utf-8",
    )
    print("PASS V20.3 Deep/Gaussian overlay applied")
    print(f"Backup: {backup_root}")
    print(f"Service worker cache manifest: {'updated' if sw_ok else 'not detected/updated'}")

if __name__ == "__main__":
    main()
