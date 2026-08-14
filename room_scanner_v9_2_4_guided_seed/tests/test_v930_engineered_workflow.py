from pathlib import Path
import re, json, subprocess
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
assert 'v9.4-picosam-readiness-gate' in s
# Five explicit product steps, old spatial card disabled.
for x in ['wfCal','wfMap','wfObjects','wfMeasure','wfReview','xrMapUI','mapBack','mapContinue','seedBack','measureBack']:
    assert f'id="{x}"' in s, x
assert 'id="spatialCalCard" hidden' in s
# Real state machine and reversible setup.
for token in ['FLOW_ORDER','setFlowStep','enterMapWarmup','continueFromMap','backFromMap','backFromObjects','pauseMeasurementForBack','resumeScientificMeasurement']:
    assert token in s, token
start=re.search(r"async function startSpatialCalibration\([^)]*\)\{[\s\S]*?\n}\nfunction",s); assert start
assert 'enterMapWarmup()' in start.group(0)
assert 'preflightGuidedObjectSeeding' not in start.group(0)
cont=re.search(r"async function continueFromMap\(\)\{[^\n]*",s); assert cont
assert 'preflightGuidedObjectSeeding' in cont.group(0)
# The semantic UI is inside the WebXR DOM overlay root.
hud=s.index('<div id="hud">'); final=s.index('<div id="finalView">')
assert hud < s.index('<div id="xrMapUI"') < final
assert hud < s.index('<div id="objectSeedUI"') < final
assert s.index('</div><!-- /hud DOM overlay root -->') < final
# Camera-first modes and no chirps before measurement.
assert 'body[data-flow-step="map"] #hud>.top' in s
assert 'body.object-seeding #hud>.top' in s
mapfn=re.search(r"function enterMapWarmup\([^\n]*",s).group(0)
assert 'runAutoSweepLoop' not in mapfn and 'startAcquisition' not in mapfn
# Back from measurement pauses sweeps; it does not discard already captured PCM.
back=re.search(r"async function pauseMeasurementForBack\(\)\{[^\n]*",s).group(0)
assert 'S.autoSweepPaused=true' in back and 'S.autoSweepToken++' in back
assert 'stopAcquisition' not in back
# Diagnostic has explicit flow state.
assert 'flowStep:S.flow.step' in s and 'measurementPaused:S.flow.measurementPaused' in s
# Static integrity.
ids=re.findall(r'\bid="([^"]+)"',s); assert len(ids)==len(set(ids))
fns=re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',s); assert len(fns)==len(set(fns))
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/v930_workflow.mjs'); mod.write_text(m.group(1))
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True); assert r.returncode==0,r.stderr
r=subprocess.run(['node','--check',str(ROOT/'sw.js')],capture_output=True,text=True); assert r.returncode==0,r.stderr
res={'status':'PASS','steps':['calibration','map','objects','measurement','review'],'dom_ids':len(ids),'functions':len(fns),'semantic_after_map':True,'measurement_back_pauses':True}
(ROOT/'tests/result_v930_engineered_workflow.json').write_text(json.dumps(res,indent=2)); print(json.dumps(res,indent=2))
