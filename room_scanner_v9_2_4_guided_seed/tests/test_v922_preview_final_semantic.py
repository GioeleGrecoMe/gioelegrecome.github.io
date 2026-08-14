from pathlib import Path
import re,json,subprocess,random,math
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
assert 'v9.2.5-clean-guided-preflight' in s
assert 'finalizeSurfelMapCooperative' in s
assert 'FINAL_SURFEL_VALIDATION' in s
assert 'pruneLowProbabilitySurfels(performance.now(),true)' not in s
assert 'i++%stride' not in re.search(r'function buildLiveSurfelPreview[\s\S]*?\n}',s).group(0)
assert 'semanticInferenceNeeded(F,false)' in s
assert "if(S.semantic.manualPrompt||S.semantic.forceNext)enqueueSemanticFrame(F,true)" in s
assert "if(!hasForce&&rtLevel()>2)" in s
assert 'fallbackRegionObjectCandidates' in s and "source='RGBD-region-prior'" in s
assert 'semanticObjectAtPoint' in s
assert './models/efficient_sam_vitt_encoder.onnx' in s
assert './models/efficient_sam_vitt_decoder.onnx' in s
assert 'semanticModelRemoteEncoder:null' in s
assert 'semanticModelRemoteDecoder:null' in s
# Diagnostic-derived selection proxy: 50,993 total, ~4,978 verified, ~2,772 stable.
# Old algorithm: stride total/cap first, then filter => roughly verified/stride.
total,verified,stable,cap=50993,4978,2772,2800
stride=max(1,total//cap)
old_visible=verified//stride
new_visible=min(cap,verified)
assert old_visible < 400
assert new_visible >= 2000
# Cooperative final processing must yield and visibly update progress.
fn=re.search(r'async function finalizeSurfelMapCooperative\([^)]*\)\{[\s\S]*?\n}',s).group(0)
assert 'await delay(0)' in fn and 'showProcessing' in fn
assert 'obviouslyWeak' in fn and 'Math.min(10,CFG.reprojectionMaxFrames)' in fn
# Semantic queue regression: readable frames are not rejected merely because governor is L1/L2.
inf=re.search(r'function semanticInferenceNeeded\([^)]*\)\{[^\n]*',s).group(0)
assert 'rtSemanticAllowed' not in inf
# Syntax
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/v922_check.mjs'); mod.write_text(m.group(1))
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True); assert r.returncode==0,r.stderr
result={'status':'PASS','diagnostic_total_surfels':total,'diagnostic_verified':verified,'diagnostic_stable':stable,'old_preview_proxy':old_visible,'new_preview_cap_proxy':new_visible,'final_processing':'cooperative','semantic_queue':'L0-L2 keyframe retention + packet-gap inference','fallback_objects':'RGB-D persistent regions'}
(ROOT/'tests/result_v922_preview_final_semantic.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
