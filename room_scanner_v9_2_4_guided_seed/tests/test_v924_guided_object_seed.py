from pathlib import Path
import re, json, subprocess, hashlib
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
req=[
 'v9.4-picosam-readiness-gate','objectSeedUI','segmentObjectSeed','confirmObjectSeed',
 'assignSeedCandidateToVisibleSurfels','enterObjectSeeding','startMeasurementAfterObjectSeeding',
 'refineSeededObjectBounds','semanticObjectClosure','invalidateSyntheticRIR',
 'RIR: non calcolata','RIR realmente calcolata','efficient_sam_vitt_encoder.onnx',
 'efficient_sam_vitt_decoder.onnx','semanticModelRemoteEncoder:null','semanticModelRemoteDecoder:null',
 "if(S.semantic.manualPrompt||S.semantic.forceNext)enqueueSemanticFrame(F,true)",
]
missing=[x for x in req if x not in s]
assert not missing, missing
# Guided phase must occur before scientific PCM/acquisition starts.
start=re.search(r"async function startSpatialCalibration\([^)]*\)\{[\s\S]*?\n}\nfunction",s)
assert start
body=start.group(0)
assert 'enterMapWarmup()' in body
assert 'preflightGuidedObjectSeeding' not in body
assert body.index('enterMapWarmup()') < body.rfind('catch')
flow=re.search(r"async function continueFromMap\(\)\{[^\n]*",s); assert flow and 'preflightGuidedObjectSeeding' in flow.group(0) and 'enterObjectSeeding' in flow.group(0)
# Measurement start is isolated after confirmation/skip.
meas=re.search(r"async function startMeasurementAfterObjectSeeding\([^)]*\)\{[^\n]*",s)
assert meas and 'startAcquisition' in meas.group(0) and 'runAutoSweepLoop' in meas.group(0)
# No automatic synthetic RIR on viewer open.
prime=re.search(r"function primeValidationComparison\(\)\{[^\n]*",s)
assert prime and 'runSyntheticRIR' not in prime.group(0)
assert "setTimeout(()=>runSyntheticRIR" not in s
# RIR is invalidated on relevant geometry changes and only exposed after solver completion.
run=re.search(r"async function runSyntheticRIR\(\)\{[^\n]*",s)
assert run and "classList.add('has-rir')" in run.group(0) and 'synthesizeRIRAt' in run.group(0)
assert "invalidateSyntheticRIR('altezza sorgente cambiata" in s
assert "invalidateSyntheticRIR('ricevitore virtuale mosso" in s
# Seed-confirmed visible surfels do not require pre-existing stable probability.
seed=re.search(r"async function assignSeedCandidateToVisibleSurfels\([\s\S]*?\n}\nfunction renderSeedObjectList",s)
assert seed
assert 'multiviewSoftProbability' not in seed.group(0)
assert 'Math.abs(pr.z-d)' in seed.group(0)
# SAM background auto-discovery is off by default; explicit manual requests remain possible.
assert "autoDiscover:false" in s
sched=re.search(r"function scheduleSemanticRefinement\([^\n]*",s).group(0)
assert 'manualPrompt' in sched and 'forceNext' in sched
# Exact bundled model hashes from user-provided upstream archive.
expected={
 'efficient_sam_vitt_encoder.onnx':'84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951',
 'efficient_sam_vitt_decoder.onnx':'a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11'
}
for name,h in expected.items():
    data=(ROOT/'models'/name).read_bytes(); assert hashlib.sha256(data).hexdigest()==h
# Syntax/DOM
ids=re.findall(r'\bid="([^"]+)"',s); assert len(ids)==len(set(ids))
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/v924_guided.mjs'); mod.write_text(m.group(1))
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True); assert r.returncode==0,r.stderr
r=subprocess.run(['node','--check',str(ROOT/'sw.js')],capture_output=True,text=True); assert r.returncode==0,r.stderr
result={'status':'PASS','guided_seeding':True,'explicit_rir':True,'bundled_models':True,'background_sam_disabled':True,'dom_ids':len(ids)}
(ROOT/'tests'/'result_v924_guided_object_seed.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
