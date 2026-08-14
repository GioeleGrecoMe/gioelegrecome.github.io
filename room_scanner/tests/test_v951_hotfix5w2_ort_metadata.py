from pathlib import Path
import json, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
assert "APP_BUILD='v9.5.1-hotfix5w6-verified-model-contracts'" in s
assert "DEPLOY_REV='951h5w6'" in s
# Regression root cause: ORT JS metadata is array-based and current metadata uses `shape`.
for tok in ["function ortSessionMeta", "Array.isArray(all)", "m?.name===name", "meta?.shape", "function ortMetaShape"]:
    assert tok in s, tok
assert "session?.inputMetadata?.[name]" not in s
assert "ENCODER OrtRun" in s and "DECODER OrtRun" in s
# Execute the exact pure metadata/profile block from the production HTML.
start=s.index('function ortSessionMeta')
end=s.index('function mobileSamEncoderCandidates')
block=s[start:end]
probe=block+r'''
const browser={inputNames:['input_image'],inputMetadata:[{name:'input_image',type:'float32',shape:[684,1024,3]}]};
const p=mobileSamEncoderPlan(browser,96,64);
if(p.layout!=='hwc'||p.preprocess!=='raw255'||p.w!==1024||p.h!==684||!p.staticShape) throw new Error(JSON.stringify(p));
const hf={inputNames:['pixel_values'],inputMetadata:[{name:'pixel_values',type:'float32',shape:[1,3,1024,1024]}]};
const q=mobileSamEncoderPlan(hf,96,64);
if(q.layout!=='nchw'||q.preprocess!=='imagenet'||q.w!==1024||q.h!==1024||!q.staticShape) throw new Error(JSON.stringify(q));
// Older map-shaped metadata remains supported.
const legacy={inputNames:['input_image'],inputMetadata:{input_image:{dimensions:[684,1024,3],type:'float32'}}};
const r=mobileSamEncoderPlan(legacy,96,64);
if(r.w!==1024||r.h!==684||r.layout!=='hwc') throw new Error(JSON.stringify(r));
console.log(JSON.stringify({browser:p,hf:q,legacy:r}));
'''
with tempfile.TemporaryDirectory() as td:
    js=Path(td)/'probe.js';js.write_text(probe)
    r=subprocess.run(['node',str(js)],capture_output=True,text=True)
    assert r.returncode==0,r.stderr
    data=json.loads(r.stdout.strip())
assert data['browser']['h']==684 and data['browser']['w']==1024
res={'status':'PASS','root_cause':'ORT inputMetadata array/shape was read as name-keyed map','browser_encoder_shape':[684,1024,3],'old_wrong_smoke_height':683,'diagnostics':['ENCODER OrtRun','DECODER OrtRun'],'deploy_rev':'951h5w6'}
(ROOT/'tests/result_v951_hotfix5w2_ort_metadata.json').write_text(json.dumps(res,indent=2)+'\n')
print(json.dumps(res,indent=2))
