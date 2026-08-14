from pathlib import Path
import re, json, subprocess, hashlib
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
assert "v9.2.6-sam-provider-fallback" in s
# Preflight must happen before entering guided seeding and must fail-open to measurement.
start=re.search(r"async function startSpatialCalibration\([^)]*\)\{[\s\S]*?\n}\nfunction",s)
assert start, 'startup function missing'
b=start.group(0)
for token in ['await preflightGuidedObjectSeeding()','if(semanticReady.ok)','enterObjectSeeding()','startMeasurementAfterObjectSeeding(why)']:
    assert token in b, token
assert b.index('await preflightGuidedObjectSeeding()') < b.index('enterObjectSeeding()')
assert b.index('await preflightGuidedObjectSeeding()') < b.index('startMeasurementAfterObjectSeeding(why)')
# Real encoder+decoder smoke test before UI.
for token in ['semanticEndToEndSelfTest','S.semantic.encoder.run','S.semantic.decoder.run','preflightOk=true','semantic_preflight_failed']:
    assert token in s, token
# Guided phase is camera-first and hides unrelated overlays + splat.
for token in [
    'body.object-seeding #lightingGuard','body.object-seeding #semanticObjectsPanel',
    'body.object-seeding #debug','body.object-seeding #processingOverlay',
    'if(S.objectSeeding.active){if(S.reconGroup)S.reconGroup.visible=false',
    'if(S.splat)S.splat.visible=false'
]: assert token in s, token
# No RGB-D fake SAM fallback inside explicit guided segmentation.
seg=re.search(r"async function segmentObjectSeed\(\)\{[\s\S]*?\n\}",s)
assert seg
assert 'objectSeedFallbackCenter' not in seg.group(0)
assert "c.source='EfficientSAM-Ti-seed'" in seg.group(0)
# Local user-provided models retained exactly.
expected={
 'efficient_sam_vitt_encoder.onnx':'84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951',
 'efficient_sam_vitt_decoder.onnx':'a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11'
}
for name,h in expected.items(): assert hashlib.sha256((ROOT/'models'/name).read_bytes()).hexdigest()==h
# DOM and syntax.
ids=re.findall(r'\bid="([^"]+)"',s); assert len(ids)==len(set(ids))
fns=re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',s); assert len(fns)==len(set(fns))
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/v925_clean_seed.mjs'); mod.write_text(m.group(1))
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True); assert r.returncode==0,r.stderr
r=subprocess.run(['node','--check',str(ROOT/'sw.js')],capture_output=True,text=True); assert r.returncode==0,r.stderr
res={'status':'PASS','semantic_preflight':'encoder+decoder end-to-end before guided UI','fail_open':'measurement starts if unavailable','clean_camera_mode':True,'dom_ids':len(ids),'functions':len(fns)}
(ROOT/'tests/result_v925_clean_seed_preflight.json').write_text(json.dumps(res,indent=2)); print(json.dumps(res,indent=2))
