from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()

# Regression: ES modules are strict. A naked assignment to an undeclared
# pumpSemanticQueue throws at module evaluation time and prevents all later UI
# handlers from being installed.
assert re.search(r'async\s+function\s+pumpSemanticQueue\s*\(', s), 'declared pumpSemanticQueue missing'
assert not re.search(r'(?m)^\s*pumpSemanticQueue\s*=\s*async\s+function', s), 'unsafe undeclared assignment restored'

pump=s.index('async function pumpSemanticQueue')
audio=s.index("$('#audioBtn').onclick=prepareAudio")
output=s.index("$('#outputBtn').onclick=chooseAudioOutput")
assert pump < audio and pump < output, 'bootstrap guard must evaluate before UI handler registration without throwing'

# Preserve the real audio actions: the hotfix must not replace or bypass them.
assert 'async function prepareAudio' in s
assert 'async function chooseAudioOutput' in s
assert "$('#audioBtn').onclick=prepareAudio" in s
assert "$('#outputBtn').onclick=chooseAudioOutput" in s

res={'status':'PASS','pump_declared':True,'unsafe_assignment_absent':True,'audio_handler_present':True,'output_handler_present':True}
(ROOT/'tests/result_v951_bootstrap_regression.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
