#!/usr/bin/env python3
"""Fetch the browser-tested MobileSAM split ONNX pair into ./models.

This helper is for deployment, never for the XR measurement loop. The URLs match
the reference MobileSAM-in-the-Browser integration used by the application. The
application still performs an encoder->decoder smoke test on the target device.
"""
from __future__ import annotations
import hashlib, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
FILES = {
    "mobilesam.encoder.onnx": "https://huggingface.co/spaces/Akbartus/projects/resolve/main/mobilesam.encoder.onnx",
    "mobilesam.decoder.quant.onnx": "https://raw.githubusercontent.com/akbartus/MobileSAM-in-the-Browser/main/models/mobilesam.decoder.quant.onnx",
}

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""):
            h.update(c)
    return h.hexdigest()

def main() -> None:
    MODELS.mkdir(parents=True,exist_ok=True)
    for name,url in FILES.items():
        out=MODELS/name
        print(f"Downloading {name} ...")
        urllib.request.urlretrieve(url,out)
        if out.stat().st_size < 1_000_000:
            out.unlink(missing_ok=True)
            raise SystemExit(f"Downloaded model looks incomplete: {name}")
        print(f"{name}: {out.stat().st_size} bytes sha256={sha256(out)}")

if __name__ == "__main__":
    main()
