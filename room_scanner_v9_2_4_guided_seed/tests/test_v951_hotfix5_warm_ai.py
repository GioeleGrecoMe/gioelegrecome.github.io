from pathlib import Path
import json, re, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text(); sw=(ROOT/'sw.js').read_text(); fetcher=(ROOT/'tools/fetch_mobilesam_models.py').read_text()
assert "APP_BUILD='v9.5.1-hotfix5-mobile-ai-warm'" in s
assert "DEPLOY_REV='951h5w'" in s
# Warm preload: advancing through the normal flow must never force a session reset.
assert 'function semanticWarmReady()' in s and 'function syncSemanticPrefetchButton()' in s
assert 'MOBILESAM_WARM_REUSE' in s
assert 'ensureMobileSamSemantic(true)' not in s
pre=re.search(r"async function preflightGuidedObjectSeeding\(\{force=false,reason='flow'\}=\{\}\).*?\n\}",s,re.S); assert pre
assert 'if(!force&&semanticWarmReady())' in pre.group(0)
assert 'ensureMobileSamSemantic(force)' in pre.group(0)
retry=re.search(r'async function retryUnavailableObjectSeeding\(\).*?\n}',s,re.S); assert retry
assert "force:true,reason:'explicit-retry'" in retry.group(0)
# Discreet progress UI does not intercept the camera or pointer events.
assert '#aiMiniProgress' in s and 'pointer-events:none' in s
assert 'function setAIMiniProgress' in s and 'function hideAIMiniProgress' in s
assert "setAIMiniProgress('MobileSAM'" in s
# Model contract adapter: browser HWC raw255 and HF-style ImageNet preprocessing.
for tok in ['function mobileSamEncoderProfile','raw255','imagenet','mean=[.485,.456,.406]','std=[.229,.224,.225]','function mobileSamEncoderCandidates','compat-pulpcut']:
 assert tok in s,tok
# The preferred local fetch must be a coherent browser-tested bundle, not PulpCut files under browser-demo names.
assert 'huggingface.co/spaces/Akbartus/projects/resolve/main/mobilesam.encoder.onnx' in fetcher
assert 'akbartus/MobileSAM-in-the-Browser/main/models/mobilesam.decoder.quant.onnx' in fetcher
assert 'PulpCut/mobilesam-onnx' not in fetcher
# Scientific measurement still releases neural sessions to preserve camera/XR/audio resources.
for name in ['resumeScientificMeasurement','startMeasurementAfterObjectSeeding']:
 f=re.search(rf'async function {name}\(.*?\).*?\n}}',s,re.S); assert f and 'releaseSemanticSessions()' in f.group(0)
# Stage-5 WebXR-only visual fallback survives even when all AI is disabled.
assert "snapshotWebXRVisualGaussians('pre-final-prune')" in s
assert 'function buildDisplayGeometryGaussianField' in s and 'displayFallback:true' in s
# H5W service worker makes navigation/models network-first to defeat mixed deploy/cache builds.
for tok in ["const CACHE='room-acoustic-v951h5w'","const BUILD_REV='951h5w'",'documentNetworkFirst','neuralNetworkFirst',"fetch(req,{cache:'no-store'})"]: assert tok in sw,tok
# JS syntax.
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
with tempfile.TemporaryDirectory() as td:
 q=Path(td)/'app.mjs';q.write_text(m.group(1))
 for js in [q,ROOT/'depth_ai_worker.js',ROOT/'sw.js']:
  r=subprocess.run(['node','--check',str(js)],capture_output=True,text=True); assert r.returncode==0,r.stderr
res={'status':'PASS','warm_preload_reused':True,'forced_reset_only_on_retry':True,'progress_ui':'non-blocking mini bar','encoder_contracts':['HWC/raw255','4D/ImageNet'],'preferred_bundle':'MobileSAM-in-the-Browser','measurement_releases_ai':True,'webxr_only_stage5_fallback':True,'deploy_rev':'951h5w'}
(ROOT/'tests/result_v951_hotfix5_warm_ai.json').write_text(json.dumps(res,indent=2)+'\n');print(json.dumps(res,indent=2))
