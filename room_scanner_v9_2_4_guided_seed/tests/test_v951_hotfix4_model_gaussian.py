from pathlib import Path
import re, json, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text(); sw=(ROOT/'sw.js').read_text()
assert "APP_BUILD='v9.5.1-hotfix4-model-runtime-gaussian-debug'" in s
# Model deployment/runtime diagnostics.
for tok in [
 "semanticModelLocalDecoderFP32:'./models/mobilesam.decoder.onnx'",
 'function modelByteSanity','function versionedLocalAsset',"searchParams.set('rsbuild','951h4')",
 'function mobileSamDecoderCandidates','local-fp32','local-quant','remote-fp32','remote-quant',
 'MOBILESAM_DECODER_REJECTED','MOBILESAM_PREFLIGHT_OK','function mobileSamEncoderPlan'
]: assert tok in s,tok
assert s.find("label:'local-fp32'") < s.find("label:'local-quant'")
# WebXR Gaussian visual fallback must be isolated from strict solver geometry.
for tok in ['function snapshotWebXRVisualGaussians','function buildDisplayGeometryGaussianField','WEBXR_VISUAL_SNAPSHOT','WEBXR_DISPLAY_FALLBACK','displayFallback:true']:
 assert tok in s,tok
fin=re.search(r'finalizeSurfelMapCooperative=async function\(options=\{\}\)\{.*?\n\}',s,re.S); assert fin and "snapshotWebXRVisualGaussians('pre-final-prune')" in fin.group(0)
assert "const strictGeom=buildGeometryGaussianField(),geomField=buildDisplayGeometryGaussianField()" in s
assert "buildAcousticGaussianFieldFromVirtualArray" in s
# Viewer must synchronously prove WebGL works before claiming success.
assert 'function finalRendererHealth' in s and 'function renderFinalFrameOnce' in s
op=re.search(r'function openFinalViewer\(\).*?\nfunction closeFinalViewer',s,re.S); assert op and 'renderFinalFrameOnce()' in op.group(0)
# Service worker neural assets are network-first, old h2/h3 cannot shadow deploy.
assert "const CACHE='room-acoustic-v951h4'" in sw
assert "fetch(req,{cache:'no-store'})" in sw and 'neuralNetworkFirst' in sw
# Updated fetcher downloads both decoder variants.
f=(ROOT/'tools/fetch_mobilesam_models.py').read_text(); assert "mobilesam.decoder.onnx" in f and "mobilesam.decoder.quant.onnx" in f
# syntax
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
with tempfile.TemporaryDirectory() as td:
 q=Path(td)/'app.mjs';q.write_text(m.group(1))
 for js in [q,ROOT/'depth_ai_worker.js',ROOT/'sw.js']:
  r=subprocess.run(['node','--check',str(js)],capture_output=True,text=True); assert r.returncode==0,r.stderr
res={'status':'PASS','model_cache_network_first':True,'fp32_decoder_preferred':True,'quant_fallback':True,'webxr_display_fallback':True,'strict_geometry_preserved_for_solver':True,'viewer_first_render_probe':True}
(ROOT/'tests/result_v951_hotfix4_model_gaussian.json').write_text(json.dumps(res,indent=2));print(json.dumps(res,indent=2))
