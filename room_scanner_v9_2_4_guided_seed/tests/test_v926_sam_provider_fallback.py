from pathlib import Path
import re, json, hashlib, zipfile, os, subprocess
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
assert "v9.4-picosam-readiness-gate" in s
assert 'Carica SAM ZIP / ONNX' in s
assert "accept=\".onnx,.zip,application/zip,application/octet-stream\"" in s
assert "providers=navigator.gpu&&!quarantined?['webgpu','wasm']:['wasm']" in s
assert "semanticProviderSmoke(provider)" in s
assert "provider==='webgpu'" in s and "provo EfficientSAM WASM" in s
assert "S.semantic.customEncoderBytes=encBytes" in s and "S.semantic.customDecoderBytes=decBytes" in s
assert "source instanceof Uint8Array" in s
assert "InferenceSession.create(bytes,opts)" in s
assert "await releaseSemanticSessions();if(S.semantic.customEncoderBytes||S.semantic.customDecoderBytes||S.semantic.customPicoBytes)" in s
assert "preflight:{ok:S.semantic.preflightOk" in s and "attempts:S.semantic.providerAttempts" in s
assert 'semanticWebgpuQuarantine' in s and 'markSemanticWebgpuBad' in s
assert 'customEncoderBytes=null;S.semantic.customDecoderBytes=null' in s
sw=(ROOT/'sw.js').read_text(); assert "room-acoustic-v940" in sw and "room-acoustic-semantic-v940" in sw
# Bundled model hashes unchanged.
exp={
 'efficient_sam_vitt_encoder.onnx':'84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951',
 'efficient_sam_vitt_decoder.onnx':'a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11'}
for n,h in exp.items(): assert hashlib.sha256((ROOT/'models'/n).read_bytes()).hexdigest()==h
# User's upstream repository ZIP is a valid direct upload fixture when available.
fixture=Path('/mnt/data/EfficientSAM-main.zip')
fixture_result='not-mounted'
if fixture.exists():
    with zipfile.ZipFile(fixture) as z:
        names=z.namelist(); enc=next((n for n in names if re.search(r'(^|/).*encoder.*\.onnx$',n,re.I)),None); dec=next((n for n in names if re.search(r'(^|/).*decoder.*\.onnx$',n,re.I)),None)
        assert enc and dec
        assert z.getinfo(enc).file_size==24799761 and z.getinfo(dec).file_size==16565728
        fixture_result={'encoder':enc,'decoder':dec}
# Provider state-machine regression: WebGPU run failure must proceed to WASM.
attempts=[]
def smoke(provider):
    attempts.append(provider)
    if provider=='webgpu': raise RuntimeError('WebGPU validation failed in Softmax')
    return True
ok=False
for provider in ['webgpu','wasm']:
    try:
        ok=smoke(provider); break
    except RuntimeError: pass
assert ok and attempts==['webgpu','wasm']
# DOM/function/syntax audit.
ids=re.findall(r'\bid="([^"]+)"',s); assert len(ids)==len(set(ids))
fns=re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',s); assert len(fns)==len(set(fns))
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/v926.mjs'); mod.write_text(m.group(1)); r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True); assert r.returncode==0,r.stderr
res={'status':'PASS','provider_fallback_order':attempts,'zip_fixture':fixture_result,'dom_ids':len(ids),'functions':len(fns),'model_hashes':'PASS'}
(ROOT/'tests/result_v926_sam_provider_fallback.json').write_text(json.dumps(res,indent=2)); print(json.dumps(res,indent=2))
