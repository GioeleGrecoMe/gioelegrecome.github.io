from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
sw=(ROOT/'sw.js').read_text()
bi=json.loads((ROOT/'build_info.json').read_text())
assert "APP_BUILD='v9.5.1-hotfix5-mobile-ai-warm'" in s
assert "DEPLOY_REV='951h5w'" in s
assert 'sw.js?v=951h3' not in s and 'sw.js?v=951h4' not in s
assert "navigator.serviceWorker.register(`./sw.js?v=${DEPLOY_REV}`" in s
assert "updateViaCache:'none'" in s
assert 'function verifyDeployRevision()' in s
assert "cache:'no-store'" in s
assert "Preflight MobileSAM fallito" in s
assert "ERRORE MobileSAM" in s
assert 'MobileSAM non disponibile · fase oggetti saltata' not in s
# Hotfix4 functionality must survive the deployment fix.
assert "semanticModelLocalDecoderFP32:'./models/mobilesam.decoder.onnx'" in s
assert 'snapshotWebXRVisualGaussians' in s
assert "const CACHE='room-acoustic-v951h5w'" in sw
assert "const SEMANTIC_CACHE='room-acoustic-semantic-v951h5w'" in sw
assert "const DEPTH_CACHE='room-acoustic-depthai-v951h5w'" in sw
assert "const BUILD_REV='951h5w'" in sw
assert 'async function documentNetworkFirst(req)' in sw
assert "request.mode==='navigate'" in sw
assert "fetch(req,{cache:'no-store'})" in sw
assert "'./build_info.json'" in sw
assert bi['deployRev']=='951h5w'
assert bi['appBuild']=='v9.5.1-hotfix5-mobile-ai-warm'
res={'status':'PASS','build':bi['appBuild'],'revision':bi['deployRev'],'navigation':'network-first','model_error_visible':True,'hotfix4_features_preserved':True}
(ROOT/'tests/result_v951_hotfix5_deploy_integrity.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
