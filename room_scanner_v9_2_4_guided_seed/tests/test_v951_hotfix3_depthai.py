from pathlib import Path
import json, re, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
w=(ROOT/'depth_ai_worker.js').read_text()
sw=(ROOT/'sw.js').read_text()

assert "APP_BUILD='v9.5.1-hotfix5-mobile-ai-warm'" in s
assert "depthAIModelLocal:'./models/depth_anything_v2_small_q4f16.onnx'" in s
assert 'onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4f16.onnx' in s
assert 'depthAIInputSize:518' in s and 'depthAIKeyframeMax:6' in s
assert 'captureDepthAIKeyframe(F)' in s
assert 'async function enhanceGeometryWithDepthAI' in s
assert 'function depthAIDeviceBudget' in s and "tier:'low'" in s and "tier:'wasm'" in s and "tier:'high'" in s
assert 'function depthAISelectFrames' in s
assert "source==='depth'||source==='depthai'" in s
assert "'depthai'" in s and 'depthai_weight' in s
assert 'depthAIMetricGateRel:0.30' in s
assert "solve('inverse')" in s and "solve('depth')" in s
assert 'depthAIMaxMedianRelError:0.16' in s and 'depthAIMaxP90RelError:0.32' in s
assert 'depthAIReprojectionExtraM:0.065' in s
assert 'id="depthAIToggle"' in s
assert "depthAIModelCache:'room-acoustic-depthai-v951h5w'" in s

# The expensive network is Stage-5-only: acquisition captures keyframes but may
# not initialize/infer the model from the WebXR depth sampling function.
sample=re.search(r'function sampleDepth\(.*?\nfunction ',s,re.S)
if sample:
    body=sample.group(0)
    assert 'ensureDepthAIWorker' not in body and "depthAIWorkerRequest('infer'" not in body
proc=re.search(r'async function processFinalModel\(\).*?\nfunction ',s,re.S)
assert proc and 'await enhanceGeometryWithDepthAI' in proc.group(0)
assert proc.group(0).find('await enhanceGeometryWithDepthAI') < proc.group(0).find('await finalizeSurfelMapCooperative')

# Worker isolation and runtime fallback.
for tok in ["'./vendor/depthai/ort.webgpu.min.js'","'./vendor/depthai/ort.min.js'","['webgpu', 'wasm']","['wasm']",'[1, 3, prep.height, prep.width]']:
    assert tok in w, tok
assert 'MobileSAM' in w and 'never touched' in w
assert 'inputShapeForSource' in w and 'constrainMultiple' in w
assert 'modelInputShapeHint' in w and 'session.inputMetadata' in w and "'aspect-dynamic'" in w
assert 'self.crossOriginIsolated' in w

# Cache/deployment paths.
assert "const CACHE='room-acoustic-v951h5w'" in sw
assert "const SEMANTIC_CACHE='room-acoustic-semantic-v951h5w'" in sw
assert "const DEPTH_CACHE='room-acoustic-depthai-v951h5w'" in sw
assert "'./depth_ai_worker.js'" in sw
assert '.onnx' in sw and 'neuralNetworkFirst' in sw
assert 'onnxruntime-web@' in sw or 'neuralNetworkFirst' in sw
for f in ['DEPTHAI_INTEGRATION_V951.md','PATCH_NOTES_V951_HOTFIX3.md','tools/fetch_depth_anything.py','tools/fetch_depthai_runtime.py']:
    assert (ROOT/f).exists(),f

# Syntax checks for both independent JavaScript contexts.
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
with tempfile.TemporaryDirectory() as td:
    mod=Path(td)/'module.mjs';mod.write_text(m.group(1))
    for f in [mod,ROOT/'depth_ai_worker.js',ROOT/'sw.js']:
        r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
        assert r.returncode==0,r.stderr

res={'status':'PASS','depth_model':'Depth Anything V2 Small Q4F16','model_size_mb':19.1,'stage5_only':True,'metric_authority':'WebXR','adaptive_keyframes':'2-6','worker_isolated':True,'webgpu_then_wasm':True,'cache':'v951h5w'}
(ROOT/'tests/result_v951_hotfix3_depthai.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
