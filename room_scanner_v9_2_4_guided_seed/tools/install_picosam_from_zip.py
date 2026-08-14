#!/usr/bin/env python3
"""Install a PicoSAM2/3 ONNX from an upstream/downloaded ZIP into Room Scanner.

This helper intentionally does not download anything. It accepts an archive
already present on disk, searches it recursively for a PicoSAM ONNX, and copies
the selected model to the local models directory. PicoSAM2 uses the canonical
filename expected by the v9.4 HTML. PicoSAM3 keeps its own name and is normally
loaded through the browser upload control unless the app configuration is
changed to point at it.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", type=Path)
    args = ap.parse_args()
    if not args.archive.is_file():
        raise SystemExit(f"archive not found: {args.archive}")
    with zipfile.ZipFile(args.archive) as zf:
        names = [n for n in zf.namelist() if re.search(r"picosam[23].*\.onnx$", n, re.I)]
        if not names:
            raise SystemExit("no PicoSAM2/3 ONNX found in archive")
        # Prefer the quantized PicoSAM2 artifact because that is the v9.4
        # canonical deployment target; otherwise choose the smallest ONNX.
        names.sort(key=lambda n: (0 if re.search(r"picosam2.*quantized", n, re.I) else 1,
                                  zf.getinfo(n).file_size))
        src = names[0]
        variant = "PicoSAM3" if re.search(r"picosam3", src, re.I) else "PicoSAM2"
        dst = MODELS / ("PicoSAM2_student_quantized.onnx" if variant == "PicoSAM2" else Path(src).name)
        MODELS.mkdir(parents=True, exist_ok=True)
        with zf.open(src) as inp, dst.open("wb") as out:
            shutil.copyfileobj(inp, out)
        if dst.stat().st_size < 300_000:
            dst.unlink(missing_ok=True)
            raise SystemExit("extracted ONNX is unexpectedly small")
        print(f"installed {variant}: {src} -> {dst} ({dst.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
