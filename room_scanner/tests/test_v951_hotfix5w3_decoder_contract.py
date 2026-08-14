from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[1]
html=(root/'room_scanner_v9.html').read_text()
assert "v9.5.1-hotfix5w6-verified-model-contracts" in html
assert "const DEPLOY_REV='951h5w6'" in html
m=re.search(r"function buildMobileSamDecoderFeeds\(E,pts\)\{(.*?)\n\}",html,re.S)
assert m, 'decoder feed helper missing'
b=m.group(1)
# Critical regression: has_mask_input must be matched before generic mask_input.
assert b.index("has_mask_input") < b.index("l==='mask_input'"), 'has_mask_input would be captured by mask_input'
assert "[1,1,256,256]" in b
assert "new Float32Array([0]),[1]" in b
assert "[1,pts.length,2]" in b
assert "[1,pts.length]" in b
assert "new Float32Array([E.h,E.w]),[2]" in b
# Both real decode and smoke test must use the same centralized builder.
assert html.count('buildMobileSamDecoderFeeds(E,pts)') == 3
# Old duplicated dangerous pattern must be gone.
assert "else if(l.includes('mask_input'))feeds[name]" not in html
result={
 'build':'v9.5.1-hotfix5w6-verified-model-contracts',
 'hasMaskBeforeMask':True,
 'centralizedBuilderUses':html.count('buildMobileSamDecoderFeeds(E,pts)')-1,
 'decoderContract':{
  'image_embeddings':'encoder output',
  'point_coords':'[1,N,2]',
  'point_labels':'[1,N]',
  'mask_input':'[1,1,256,256]',
  'has_mask_input':'[1]',
  'orig_im_size':'[2]'
 }
}
(root/'tests/result_v951_hotfix5w3_decoder_contract.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
