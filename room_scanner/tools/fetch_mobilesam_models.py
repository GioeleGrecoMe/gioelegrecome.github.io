#!/usr/bin/env python3
"""Fetch the browser-tested MobileSAM split ONNX bundle used by Hotfix5W6.

Why this script changed
-----------------------
Earlier project builds downloaded the PulpCut encoder while the browser code was
using the input contract from MobileSAM-in-the-Browser. Both files are called
"mobilesam.encoder.onnx", but they are not guaranteed to use the same tensor
layout/preprocessing. Hotfix5W installs one coherent, browser-tested bundle:

- encoder: Akbartus Hugging Face Space used by MobileSAM-in-the-Browser
- decoder FP32 + quantized: the matching GitHub project files

The app still has a compatibility fallback for existing PulpCut deployments, but
the local default should be internally coherent and is smoke-tested on-device.
"""
from __future__ import annotations
import hashlib, json, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODELS=ROOT/'models'
PINNED={
 'mobilesam.encoder.onnx':(28195125,'4125037c5e24d6ea58e201b20e8d8fbbbd1135c0b881e34a8074b8c4f07e6918'),
 'mobilesam.decoder.onnx':(16514086,'b0735abf07c7affddf20fffc3ce750f44af387ee6a7323880e909389ed15d279'),
 'mobilesam.decoder.quant.onnx':(8837301,'1ef83e7921d0adc571f446849741e556e948fdd976be06f4e33f17ca675829bc'),
}
FILES={
 'mobilesam.encoder.onnx':'https://huggingface.co/spaces/Akbartus/projects/resolve/main/mobilesam.encoder.onnx',
 'mobilesam.decoder.onnx':'https://raw.githubusercontent.com/akbartus/MobileSAM-in-the-Browser/main/models/mobilesam.decoder.onnx',
 'mobilesam.decoder.quant.onnx':'https://raw.githubusercontent.com/akbartus/MobileSAM-in-the-Browser/main/models/mobilesam.decoder.quant.onnx',
}
def sha256(path: Path) -> str:
 h=hashlib.sha256()
 with path.open('rb') as f:
  for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
 return h.hexdigest()
def fetch(url: str, out: Path) -> None:
 req=urllib.request.Request(url,headers={'User-Agent':'room-scanner-model-fetch/951h5w6'})
 with urllib.request.urlopen(req,timeout=120) as r, out.open('wb') as f:
  while True:
   block=r.read(1024*1024)
   if not block: break
   f.write(block)
def main():
 MODELS.mkdir(parents=True,exist_ok=True);manifest={'bundle':'MobileSAM-in-the-Browser coherent split','deployRev':'951h5w6','files':{}}
 for name,url in FILES.items():
  out=MODELS/name;tmp=out.with_suffix(out.suffix+'.part');tmp.unlink(missing_ok=True)
  print('Downloading',name,'...')
  try: fetch(url,tmp)
  except Exception:
   tmp.unlink(missing_ok=True);raise
  expected_bytes,expected_sha=PINNED[name];size=tmp.stat().st_size
  if size!=expected_bytes:
   tmp.unlink(missing_ok=True);raise SystemExit(f'size mismatch: {name} {size} != {expected_bytes}')
  digest=sha256(tmp)
  if digest!=expected_sha:
   tmp.unlink(missing_ok=True);raise SystemExit(f'SHA256 mismatch: {name} {digest} != {expected_sha}')
  tmp.replace(out)
  manifest['files'][name]={'bytes':out.stat().st_size,'sha256':digest,'url':url};print(name,out.stat().st_size,digest)
 (MODELS/'mobilesam.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print('MOBILESAM_BROWSER_BUNDLE_READY=yes')
if __name__=='__main__': main()
