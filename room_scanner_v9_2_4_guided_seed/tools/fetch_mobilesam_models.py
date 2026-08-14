#!/usr/bin/env python3
"""Fetch all MobileSAM browser candidates used by hotfix4.

The FP32 decoder is preferred because the public browser reference for this
encoder/decoder pair uses it with ORT Web 1.14. The quantized decoder is kept as
an offline/mobile fallback. The app smoke-tests each candidate on the device.
"""
from __future__ import annotations
import hashlib, json, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODELS=ROOT/'models'
FILES={
 'mobilesam.encoder.onnx':'https://huggingface.co/PulpCut/mobilesam-onnx/resolve/main/mobilesam.encoder.onnx',
 'mobilesam.decoder.onnx':'https://huggingface.co/PulpCut/mobilesam-onnx/resolve/main/mobilesam.decoder.onnx',
 'mobilesam.decoder.quant.onnx':'https://huggingface.co/PulpCut/mobilesam-onnx/resolve/main/mobilesam.decoder.quant.onnx',
}
def sha256(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
 return h.hexdigest()
def main():
 MODELS.mkdir(parents=True,exist_ok=True); manifest={}
 for name,url in FILES.items():
  out=MODELS/name; print('Downloading',name,'...'); urllib.request.urlretrieve(url,out)
  if out.stat().st_size<1_000_000: out.unlink(missing_ok=True); raise SystemExit(f'incomplete: {name}')
  digest=sha256(out); manifest[name]={'bytes':out.stat().st_size,'sha256':digest,'url':url}; print(name,out.stat().st_size,digest)
 (MODELS/'mobilesam.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__': main()
