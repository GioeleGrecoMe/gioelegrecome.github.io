from pathlib import Path
import re, json, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text(); sw=(ROOT/'sw.js').read_text()

assert "APP_BUILD='v9.5.1-hotfix5w7-stable-object-picking'" in s
assert "DEPLOY_REV='951h5w7'" in s
assert "const BUILD_REV='951h5w7'" in sw

# Primary planes must remain informative but nearly transparent.
assert 'opacity:.045,side:THREE.DoubleSide,depthWrite:false' in s

# Object picking is RGB-first: depth is metric support, not a SAM gate.
assert "ready=rgbAvailable&&(frozen||age<=CFG.objectSeedFrameMaxAgeMs*3.0)" in s
assert "b.textContent=R.ready?(R.metricReady?'Segmenta qui':'Segmenta foto'):'Tocca un oggetto…'" in s
assert "SAM lavora sul frame RGB; depth/surfel servono solo per ancorare la mask in 3D" in s
assert "function semanticMaskProjectedSurfelSupport" in s
assert "metricReady,directDepthPoints,projectedSurfelPoints" in s
assert "mask 2D valida · supporto 3D insufficiente" in s

# The explicit tap freezes a camera-synchronized snapshot, not an old depth frame.
assert 'function h5w7CurrentObjectSnapshotFrame()' in s
snap=re.search(r'function h5w7CurrentObjectSnapshotFrame\(\).*?\n}',s,re.S); assert snap
for tok in ['S.latestCameraView','V.worldToView.clone().invert()','Math.abs((F?.t??-1)-t)<=260','objectSnapshot:true','captureSemanticFrameImage(F,true)']:
    assert tok in snap.group(0),tok

# User taps must bypass the automatic semantic quality gate and stay inside DOM overlay.
cap=re.search(r'function captureSemanticFrameImage\(F,force=false\).*?\n}',s,re.S); assert cap
assert '(!force&&!F?.semanticQuality?.readable)' in cap.group(0)
assert "$('#objectSeedMask').addEventListener('pointerdown',objectSeedPointerSelect" in s
assert "$('#objectSeedUI').addEventListener('beforexrselect',e=>e.preventDefault())" in s
assert 'e.stopImmediatePropagation?.()' in s
assert 'touch-action:none;user-select:none;-webkit-user-select:none' in s

# Entering Step 3 never hides the live WebXR splat or primary surfaces.
enter=re.search(r'function enterObjectSeeding\(\{preserve=true,returnToMeasurement=false\}=\{\}\).*?return true}',s,re.S); assert enter
assert 'S.splat.visible=S.splatVisible' in enter.group(0)
assert 'S.primarySurfaceGroup.visible=true' in enter.group(0)

# A 2D-only SAM mask can be displayed safely; confirmation is metric-gated instead of crashing.
show=re.search(r'function showObjectSeedCandidate\(c,F,backend\).*?\nasync function assignSeedCandidateToVisibleSurfels',s,re.S); assert show
assert "$('#seedConfirm').disabled=!metric" in show.group(0)
confirm=re.search(r'async function confirmObjectSeed\(\).*?\n}',s,re.S); assert confirm
assert "!c?.metricReady||!c.center||!c.min||!c.max" in confirm.group(0)

# Syntax checks.
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
with tempfile.TemporaryDirectory() as td:
    q=Path(td)/'app.mjs'; q.write_text(m.group(1))
    for js in [q,ROOT/'depth_ai_worker.js',ROOT/'sw.js']:
        r=subprocess.run(['node','--check',str(js)],capture_output=True,text=True)
        assert r.returncode==0,r.stderr

res={
  'status':'PASS','build':'v9.5.1-hotfix5w7-stable-object-picking',
  'primary_surface_opacity':0.045,'sam_gate':'RGB-first','metric_gate':'post-mask',
  'snapshot':'current RGB + synchronized pose; nearby depth optional; surfel fallback',
  'pointer_event':'pointerdown + beforexrselect prevention','deploy_rev':'951h5w7'
}
(ROOT/'tests/result_v951_hotfix5w7_object_picking.json').write_text(json.dumps(res,indent=2)+'\n')
print(json.dumps(res,indent=2))
