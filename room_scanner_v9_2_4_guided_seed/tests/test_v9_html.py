from pathlib import Path
import re, json, subprocess
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'room_scanner_v9.html'
s=p.read_text()
ids=re.findall(r'\bid="([^"]+)"',s)
dups=sorted({x for x in ids if ids.count(x)>1})
required=[
    'v9.2.5-clean-guided-preflight',
    'reprojectSurfelEvidence','stableSurfelMinViews','fallbackSemanticGrid',
    'semanticFrameMetrics','captureSemanticFrameImage','ensureSemanticNeural',
    'semanticPacketBoundaryMaintenance','updateSemanticObjectTrack',
    'semanticObjectsForExport','observeStructuralPlane','buildStructuralGraph',
    'map_frames_v9.json','semantic_objects.json','loadProjectFile','loadRawProjectZip',
    'loadedRawAudioBytes','processFinalModel','geometry_gaussian_field.csv','structural_graph.json'
]
missing=[x for x in required if x not in s]
assert not dups, dups
assert not missing, missing
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/module_v91_html_check.mjs'); mod.write_text(m.group(1))
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True)
assert r.returncode==0,r.stderr
r2=subprocess.run(['node','--check',str(ROOT/'sw.js')],capture_output=True,text=True)
assert r2.returncode==0,r2.stderr
result={'status':'PASS','dom_ids':len(ids),'duplicates':dups,'required_features':len(required),'node_check':'PASS','service_worker_check':'PASS'}
(ROOT/'tests'/'result_html.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
