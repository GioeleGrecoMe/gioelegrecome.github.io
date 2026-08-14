#!/usr/bin/env python3
"""Install a MobileSAM encoder+decoder ONNX pair from a ZIP into ./models.

The browser application expects the normalized filenames below. The input ZIP may
contain the models at any directory depth and may use generic names such as
encoder.onnx/decoder.onnx or mobile_sam.encoder.onnx/mobile_sam.decoder.onnx.
"""
from __future__ import annotations
import argparse, hashlib, re, shutil, tempfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
ENC_OUT = MODELS / "mobilesam.encoder.onnx"
DEC_OUT = MODELS / "mobilesam.decoder.quant.onnx"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def choose(names: list[str], kind: str) -> str:
    pats = [
        rf"(?:mobile[_-]?sam|mobilesam).*{kind}.*\.onnx$",
        rf"{kind}.*\.onnx$",
    ]
    for pat in pats:
        hits = [n for n in names if re.search(pat, n, re.I)]
        if hits:
            # Prefer explicitly quantized decoder; for encoder prefer the smallest
            # path depth/name because bundles often include only one encoder.
            if kind == "decoder":
                hits.sort(key=lambda n: ("quant" not in n.lower(), len(n)))
            else:
                hits.sort(key=len)
            return hits[0]
    raise RuntimeError(f"No {kind} ONNX found in archive")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", type=Path, help="MobileSAM ZIP containing encoder+decoder ONNX")
    args = ap.parse_args()
    src = args.zip.resolve()
    if not src.is_file():
        raise SystemExit(f"Missing ZIP: {src}")
    MODELS.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        enc = choose(names, "encoder")
        dec = choose(names, "decoder")
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            ep = td / "encoder.onnx"
            dp = td / "decoder.onnx"
            with z.open(enc) as fi, ep.open("wb") as fo:
                shutil.copyfileobj(fi, fo)
            with z.open(dec) as fi, dp.open("wb") as fo:
                shutil.copyfileobj(fi, fo)
            if ep.stat().st_size < 1_000_000 or dp.stat().st_size < 1_000_000:
                raise RuntimeError("Extracted ONNX looks incomplete")
            shutil.copy2(ep, ENC_OUT)
            shutil.copy2(dp, DEC_OUT)
    print(f"encoder: {ENC_OUT.name} {ENC_OUT.stat().st_size} bytes sha256={sha256(ENC_OUT)}")
    print(f"decoder: {DEC_OUT.name} {DEC_OUT.stat().st_size} bytes sha256={sha256(DEC_OUT)}")

if __name__ == "__main__":
    main()
