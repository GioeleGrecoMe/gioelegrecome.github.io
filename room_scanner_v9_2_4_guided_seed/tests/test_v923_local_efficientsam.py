from pathlib import Path
import hashlib, json, re, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'room_scanner_v9.html').read_text(encoding='utf-8')
enc=ROOT/'models/efficient_sam_vitt_encoder.onnx'
dec=ROOT/'models/efficient_sam_vitt_decoder.onnx'
expected={
 enc:'84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951',
 dec:'a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11',
}
checks={}
for p,h in expected.items():
    checks[p.name+'_exists']=p.exists()
    checks[p.name+'_sha256']=hashlib.sha256(p.read_bytes()).hexdigest()==h if p.exists() else False
    checks[p.name+'_size']=p.stat().st_size if p.exists() else 0
checks['html_encoder_local']="./models/efficient_sam_vitt_encoder.onnx" in HTML
checks['html_decoder_local']="./models/efficient_sam_vitt_decoder.onnx" in HTML
checks['remote_weight_urls_disabled']='semanticModelRemoteEncoder:null' in HTML and 'semanticModelRemoteDecoder:null' in HTML
checks['no_huggingface_weight_url']='huggingface.co/yunyangx/EfficientSAM' not in HTML
checks['local_runtime_preferred']="semanticOrtLocal:'./vendor/ort.webgpu.bundle.min.mjs'" in HTML
checks['runtime_fallback_pinned']='onnxruntime-web@1.27.0' in HTML
checks['semantic_cache_separate']='room-acoustic-semantic-v924' in (ROOT/'sw.js').read_text()
checks['license_retained']=(ROOT/'third_party/EfficientSAM/LICENSE').exists()
# Simple protobuf string presence check without requiring the Python onnx package.
for p,need in [(enc,[b'batched_images',b'image_embeddings']), (dec,[b'image_embeddings',b'batched_point_coords',b'batched_point_labels',b'orig_im_size',b'output_masks',b'iou_predictions'])]:
    data=p.read_bytes()
    checks[p.name+'_io_names']=all(x in data for x in need)
# Official export wrapper proves split encoder/decoder contract retained with the package.
up=(ROOT/'third_party/EfficientSAM/export_to_onnx.py').read_text()
checks['upstream_split_export_reference']='export_onnx_esam_encoder' in up and 'export_onnx_esam_decoder' in up
result={'ok':all(v is True or isinstance(v,int) and v>0 for v in checks.values()),'checks':checks}
(ROOT/'tests/result_v923_local_efficientsam.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
if not result['ok']: sys.exit(1)
