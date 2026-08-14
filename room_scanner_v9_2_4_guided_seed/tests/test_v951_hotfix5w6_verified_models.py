from pathlib import Path
import re, json, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'room_scanner_v9.html').read_text(); worker=(ROOT/'depth_ai_worker.js').read_text(); sw=(ROOT/'sw.js').read_text(); fetch=(ROOT/'tools/fetch_mobilesam_models.py').read_text(); check=(ROOT/'tools/check_deploy_bundle.py').read_text()
assert "APP_BUILD='v9.5.1-hotfix5w6-verified-model-contracts'" in html
assert "DEPLOY_REV='951h5w6'" in html
# Exact public browser bundle identity.
pins={
 'mobilesam.encoder.onnx':(28195125,'4125037c5e24d6ea58e201b20e8d8fbbbd1135c0b881e34a8074b8c4f07e6918'),
 'mobilesam.decoder.onnx':(16514086,'b0735abf07c7affddf20fffc3ce750f44af387ee6a7323880e909389ed15d279'),
 'mobilesam.decoder.quant.onnx':(8837301,'1ef83e7921d0adc571f446849741e556e948fdd976be06f4e33f17ca675829bc')}
for name,(size,sha) in pins.items():
    assert name in html and str(size) in html and sha in html
    assert name in fetch and str(size) in fetch and sha in fetch
    assert name in check and str(size) in check and sha in check
assert 'verifyPinnedMobileSamBytes' in html and "crypto.subtle.digest('SHA-256'" in html
# The H5W5 proxy regression must not return. Local WASM override is absolute.
assert 'ort.env.wasm.proxy=false' in html
assert "localAssetAbsoluteBase('./vendor/')" in html
assert 'ort.env.wasm.proxy=proxySam' not in html
assert "versionedLocalAsset(CFG.semanticOrtLocal)" not in html  # runtime versioning is performed in import loop by source label
assert "source==='local'?versionedLocalAsset(url):url" in html
# Exact MobileSAM graph contract is checked before inference; actual smoke output is checked after run.
for tok in ["[684,1024,3]", "[1,256,64,64]", "[1,1,256,256]", "['image_embeddings','point_coords','point_labels','mask_input','has_mask_input','orig_im_size']", "output masks assente", "embedding shape inattesa", "masks rank inatteso"]:
    assert tok in html,tok
assert "S.semantic.encoderContract=mobileSamSessionContract" in html
assert "S.semantic.decoderContract=mobileSamSessionContract" in html
# Depth Anything exact model + isolated absolute WASM path + runtime contract.
assert "DEPTH_MODEL_PIN={bytes:19126267,sha256:'eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e'}" in worker
assert "new URL('./vendor/depthai/', self.location.href).href" in worker
assert 'validateDepthContract(session)' in worker
assert 'output size ${depth.length} != ${w}x${h}' in worker
assert "input rank atteso 4 NCHW" in worker and "canali input attesi 3" in worker
assert "S.depthAI.contract=r.contract||null" in html and "S.depthAI.modelIntegrity=r.modelIntegrity||null" in html
assert "msg.type === 'smoke'" in worker and 'async function preflightDepthAI()' in html
assert "await preflightDepthAI()" in html and "DepthAI verificata ✓" in html
# Cache revision is coherent.
for tok in ["const CACHE='room-acoustic-v951h5w6'","const SEMANTIC_CACHE='room-acoustic-semantic-v951h5w6'","const DEPTH_CACHE='room-acoustic-depthai-v951h5w6'","const BUILD_REV='951h5w6'"]:
    assert tok in sw,tok
# Execute exact contract functions from production using realistic ORT metadata.
def extract_func(src,name):
    start=src.index('function '+name); brace=src.index('{',start); depth=0
    for i in range(brace,len(src)):
        if src[i]=='{': depth+=1
        elif src[i]=='}':
            depth-=1
            if depth==0:return src[start:i+1]
    raise AssertionError(name)
funcs=['ortSessionMeta','ortMetaShape','ortMetaSummary','dimEq','mobileSamSessionContract']
probe='\n'.join(extract_func(html,n) for n in funcs)+r'''
const enc={inputNames:['input_image'],outputNames:['image_embeddings'],inputMetadata:[{name:'input_image',type:'float32',shape:[684,1024,3]}],outputMetadata:[{name:'image_embeddings',type:'float32',shape:[1,256,64,64]}]};
const dec={inputNames:['image_embeddings','point_coords','point_labels','mask_input','has_mask_input','orig_im_size'],outputNames:['masks','iou_predictions','low_res_masks'],inputMetadata:[{name:'image_embeddings',type:'float32',shape:[1,256,64,64]},{name:'point_coords',type:'float32',shape:[1,'num_points',2]},{name:'point_labels',type:'float32',shape:[1,'num_points']},{name:'mask_input',type:'float32',shape:[1,1,256,256]},{name:'has_mask_input',type:'float32',shape:[1]},{name:'orig_im_size',type:'float32',shape:[2]}],outputMetadata:[{name:'masks',type:'float32',shape:[1,3,684,1024]},{name:'iou_predictions',type:'float32',shape:[1,3]},{name:'low_res_masks',type:'float32',shape:[1,3,256,256]}]};
const a=mobileSamSessionContract(enc,'encoder','local');const b=mobileSamSessionContract(dec,'decoder','local-fp32');
let rejected=false;try{mobileSamSessionContract({...enc,inputMetadata:[{name:'input_image',type:'float32',shape:[683,1024,3]}]},'encoder','local')}catch(e){rejected=true}
if(!rejected)throw new Error('bad encoder shape accepted');
console.log(JSON.stringify({encoder:a,decoder:b,badEncoderRejected:rejected}));
'''
with tempfile.TemporaryDirectory() as td:
    js=Path(td)/'probe.js';js.write_text(probe);r=subprocess.run(['node',str(js)],capture_output=True,text=True);assert r.returncode==0,r.stderr;contract=json.loads(r.stdout)
assert contract['encoder']['inputs'][0]['shape']==[684,1024,3]
assert contract['decoder']['inputs'][0]['shape']==[1,256,64,64]
res={'status':'PASS','build':'v9.5.1-hotfix5w6-verified-model-contracts','mobileSamPinned':pins,'mobileSamEncoderInput':[684,1024,3],'mobileSamEmbedding':[1,256,64,64],'mobileSamDecoderInputs':6,'depthAnythingPinnedBytes':19126267,'mobileSamProxy':False,'absoluteWasmPaths':True,'badEncoderRejected':True}
(ROOT/'tests/result_v951_hotfix5w6_verified_models.json').write_text(json.dumps(res,indent=2)+'\n');print(json.dumps(res,indent=2))
