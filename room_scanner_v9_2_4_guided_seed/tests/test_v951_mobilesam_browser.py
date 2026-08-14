from pathlib import Path
import json, re, importlib.util, zipfile, tempfile
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
sw=(ROOT/'sw.js').read_text()
assert "APP_BUILD='v9.5.1-hotfix5-mobile-ai-warm'" in s
assert 'PicoSAM' not in s and 'EfficientSAM' not in s
assert s.count("$('#semanticModelInput').onchange=") == 1
for token in [
    "semanticModelLocalEncoder:'./models/mobilesam.encoder.onnx'",
    "semanticModelLocalDecoder:'./models/mobilesam.decoder.quant.onnx'",
    "semanticOrtLocal:'./vendor/ort.min.js'",
    "onnxruntime-web@1.14.0/dist/ort.min.js",
    'async function ensureMobileSamSemantic','async function mobileSamSemanticSelfTest',
    'async function mobileSamEncodeBitmap','async function mobileSamDecode',
    'async function releaseSemanticSessions','async function pumpSemanticQueue(){',
    'captureSemanticFrameImage(F,force=false)'
]:
    assert token in s, token
assert 'room-acoustic-v951h5w' in sw and 'room-acoustic-semantic-v951h5w' in sw
assert 'onnxruntime-web@' in sw or 'neuralNetworkFirst' in sw
assert not list((ROOT/'models').glob('*mobilesam*.onnx')), 'release archive must not pretend MobileSAM weights are bundled when they are absent'
assert (ROOT/'tools/install_mobilesam_zip.py').exists()
assert (ROOT/'tools/fetch_mobilesam_models.py').exists()
assert (ROOT/'tools/fetch_onnxruntime_web.py').exists()

# Test the exact ZIP filename-selection logic in the installer without installing fake weights.
spec=importlib.util.spec_from_file_location('installer',ROOT/'tools/install_mobilesam_zip.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
with tempfile.TemporaryDirectory() as td:
    zpath=Path(td)/'m.zip'
    with zipfile.ZipFile(zpath,'w') as z:
        z.writestr('bundle/models/mobile_sam_encoder.onnx',b'x'*32)
        z.writestr('bundle/models/mobile_sam_decoder.onnx',b'y'*32)
    with zipfile.ZipFile(zpath) as z:
        names=z.namelist()
        enc=mod.choose(names,'encoder'); dec=mod.choose(names,'decoder')
        assert enc.endswith('mobile_sam_encoder.onnx')
        assert dec.endswith('mobile_sam_decoder.onnx')

res={'status':'PASS','active_backend':'MobileSAM split ONNX','ort_web':'1.14.0 WASM','model_binary_bundled':False,'single_upload_handler':True}
(ROOT/'tests/result_v951_mobilesam_browser.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
