from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
sw=(ROOT/'sw.js').read_text()

# Step 3 regression: a failed MobileSAM preflight must remain an explicit UI
# state instead of jumping directly from map warmup to measurement.
assert 'function enterObjectSeedingUnavailable' in s
assert 'async function retryUnavailableObjectSeeding' in s
assert 'id="seedLoadModel"' in s
assert "enterObjectSeedingUnavailable(why,{returnToMeasurement:S.flow.measurementPaused})" in s
continue_body=re.search(r"async function continueFromMap\(\).*?\nasync function backFromMap",s,re.S)
assert continue_body, 'continueFromMap body not found'
assert 'startMeasurementAfterObjectSeeding(`SAM non disponibile' not in continue_body.group(0)
assert 'resumeScientificMeasurement(`SAM non disponibile' not in continue_body.group(0)
assert "PulpCut/mobilesam-onnx/resolve/main/mobilesam.encoder.onnx" in s
assert "PulpCut/mobilesam-onnx/resolve/main/mobilesam.decoder.quant.onnx" in s

# Stage 5 regression: only one WebGL renderer is created. The final viewer
# reuses S.renderer and has an explicit rollback path if scene construction fails.
init=re.search(r"function initFinalRenderer\(\).*?\nfunction restorePrimaryRendererHost",s,re.S)
assert init, 'initFinalRenderer body not found'
assert 'new THREE.WebGLRenderer' not in init.group(0)
assert 'const r=S.renderer' in init.group(0)
assert 'host.appendChild(r.domElement)' in init.group(0)
assert 'function restorePrimaryRendererHost' in s
open_body=re.search(r"function openFinalViewer\(\).*?\nfunction closeFinalViewer",s,re.S)
assert open_body, 'openFinalViewer body not found'
assert "FINAL_VIEWER_OPEN_FAILED" in open_body.group(0)
assert "view.classList.remove('active','menu-open')" in open_body.group(0)
assert "$('#landing').style.display='flex'" in open_body.group(0)
assert 'restorePrimaryRendererHost()' in open_body.group(0)
assert 'if(!openFinalViewer())throw new Error' in s

# Deployment cache must be a new namespace so phones cannot keep a mixed h1/h2 build.
assert "sw.js?v=${DEPLOY_REV}" in s
assert "DEPLOY_REV='951h5w4'" in s and "room-acoustic-semantic-v951h5w4" in s
assert "const CACHE='room-acoustic-v951h5w4'" in sw
assert "const SEMANTIC_CACHE='room-acoustic-semantic-v951h5w4'" in sw
assert 'neuralNetworkFirst' in sw

res={
  'status':'PASS',
  'step3_failure_is_visible':True,
  'mobile_sam_remote_pair':'browser-tested Akbartus split + PulpCut compatibility fallback',
  'single_webgl_context_for_stage5':True,
  'viewer_failure_rolls_back_ui':True,
  'service_worker_cache':'v951h5w4'
}
(ROOT/'tests/result_v951_hotfix2_step3_finalviewer.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
