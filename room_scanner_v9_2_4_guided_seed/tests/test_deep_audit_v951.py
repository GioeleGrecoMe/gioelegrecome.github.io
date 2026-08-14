from pathlib import Path
import re, collections, subprocess, json
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
ids=re.findall(r'\bid="([^"]+)"',s)
assert len(ids)==len(set(ids)), [k for k,v in collections.Counter(ids).items() if v>1]
ids_set=set(ids)
refs=set(re.findall(r"\$\('#([A-Za-z0-9_-]+)'\)",s))
assert not refs-ids_set, sorted(refs-ids_set)
handlers=set(re.findall(r"\$\('#([A-Za-z0-9_-]+)'\)\.(?:onclick|onchange|oninput|onpointerdown|onpointerup|onmousedown|onmouseup)\s*=",s))
assert not handlers-ids_set, sorted(handlers-ids_set)
funcs=re.findall(r'(?<![\w$])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',s)
dups=[k for k,v in collections.Counter(funcs).items() if v>1]
assert not dups, dups
assert "APP_BUILD='v9.5.1-hotfix4-model-runtime-gaussian-debug'" in s
assert 'PicoSAM' not in s and 'EfficientSAM' not in s
assert 'button,.fakeBtn{background:#102238!important;color:#fff!important' in s
assert s.count('semanticInputSize:1024') == 1
assert s.count("semanticModelCache:'room-acoustic-semantic-v951h4'") == 1
assert s.count("$('#semanticModelInput').onchange=") == 1
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
js=ROOT/'tests'/'_audit_module_v951.mjs'; js.write_text(m.group(1))
for f in [js,ROOT/'sw.js']:
    r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    assert r.returncode==0,r.stderr
js.unlink(missing_ok=True)
for f in ['ARCHITECTURE_V951.md','MOBILESAM_INTEGRATION_V951.md','PERFORMANCE_PRUNING_V951.md','README.md']:
    assert (ROOT/f).exists(),f
res={'status':'PASS','dom_ids':len(ids),'simple_dom_refs':len(refs),'handler_targets':len(handlers),'named_functions':len(funcs),'duplicate_functions':0}
(ROOT/'tests/result_deep_audit_v951.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
