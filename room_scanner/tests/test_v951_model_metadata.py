from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]
mr=(ROOT/'models/README.md').read_text()
vr=(ROOT/'vendor/README.md').read_text()
assert 'mobilesam.encoder.onnx' in mr and 'mobilesam.decoder.quant.onnx' in mr
assert 'MobileSAM-in-the-Browser' in mr
assert '1.14' in vr and 'ort.min.js' in vr
# No obsolete model payloads should survive in the release tree.
for p in ROOT.rglob('*'):
    if not p.is_file(): continue
    low=p.name.lower()
    assert 'picosam' not in low, p
    assert 'efficient_sam' not in low and 'efficientsam' not in low, p
res={'status':'PASS','browser_reference_pair_documented':True,'obsolete_model_artifacts':0}
(ROOT/'tests/result_v951_model_metadata.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
