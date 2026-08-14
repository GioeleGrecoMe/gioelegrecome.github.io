from pathlib import Path
import re, json, math, subprocess
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
assert "v9.4-picosam-readiness-gate" in s
# Lightweight backend is first in preflight, while EfficientSAM remains fallback.
assert "semanticPicoModelLocal:'./models/PicoSAM2_student_quantized.onnx'" in s
pre=s[s.index('async function preflightGuidedObjectSeeding'):s.index('function releaseSemanticEmbedding')]
assert pre.index('ensurePicoSemantic') < pre.index('semanticProviderSmoke')
assert "PicoSAM2/WASM" in pre and "EfficientSAM" in pre
# A missing optional Pico model must not break the workflow.
assert 'optionalModelBytes' in s and 'if(!bytes)return false' in s
# Direct ONNX / ZIP loading accepts PicoSAM2 or PicoSAM3 exports.
assert "picosam2|picosam3" in s and "customPicoBytes=picoBytes" in s
# Marker is a real metric gate, not merely semantic readiness.
for token in ['objectSeedMinDepthCells','objectSeedMinVerifiedSurfels','objectSeedMinIndependentViews',
              'objectSeedMinNormalSurfels','objectSeedMinOrientationConfidence','orientationConfidence',
              "document.body.classList.toggle('seed-ready'","b.disabled=!R.ready"]:
    assert token in s, token
# Ensure the reticle readiness function never scans the entire surfel map.
a=s.index('function objectSeedGeometryReadiness'); b=s.index('function updateObjectSeedReadiness',a)
ready_src=s[a:b]
assert 'objectSeedNearbySurfels' in ready_src
assert 'S.surfels.values()' not in ready_src
# Synthetic decision regression approximating the exact hard gate.
CFG=dict(depth=12,local=10,verified=6,stable=2,views=2,normals=4,orient=.25,span=.055,spread=.72)
def gate(depth,local,verified,stable,maxviews,view_supported,normals,orient,span,spread):
    return depth>=CFG['depth'] and local>=CFG['local'] and verified>=CFG['verified'] and stable>=CFG['stable'] and maxviews>=CFG['views'] and view_supported>=2 and normals>=CFG['normals'] and orient>=CFG['orient'] and span>=CFG['span'] and spread<=CFG['spread']
assert not gate(25,20,1,0,1,0,7,.8,.2,.2)       # many points, no multi-view
assert not gate(25,20,12,4,3,8,2,.2,.2,.2)      # position yes, orientation no
assert not gate(25,20,12,4,3,8,7,.8,.02,.2)     # too little metric extent
assert gate(25,20,12,4,3,8,7,.75,.18,.28)       # fully observable
# Confirmed objects preserve the 3-D orientation evidence from the green frame.
assert 'seedOrientationNormal' in s and 'seedOrientationConfidence' in s and 'seedReadinessScore' in s
# Diagnostic export contains the readiness causes.
assert 'orientationNormal:S.objectSeeding.readiness.orientationNormal' in s
# Service worker supports optional Pico model cache if user deploys the file.
sw=(ROOT/'sw.js').read_text()
assert 'PicoSAM2_student_quantized' in sw and 'room-acoustic-v940' in sw
# Module syntax.
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/v940.mjs'); mod.write_text(m.group(1))
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True); assert r.returncode==0,r.stderr
res={'status':'PASS','backend_priority':['PicoSAM2/WASM','EfficientSAM WebGPU/WASM'],
     'readiness_gate':['local depth','verified surfels','independent views','stable surfels','metric span','depth compactness','orientation normals'],
     'green_gate_positive_case':True,'full_map_scan_in_readiness':False}
(ROOT/'tests/result_v940_picosam_readiness.json').write_text(json.dumps(res,indent=2)); print(json.dumps(res,indent=2))
