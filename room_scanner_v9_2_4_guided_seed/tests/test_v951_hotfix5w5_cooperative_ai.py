from pathlib import Path
import re, json, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text(); sw=(ROOT/'sw.js').read_text()

assert "APP_BUILD='v9.5.1-hotfix5w6-verified-model-contracts'" in s
assert "DEPLOY_REV='951h5w6'" in s
for tok in [
    'cooperativeGeometryPeriodMs:100', 'primarySurfacePreviewPeriodMs:1250',
    'depthAILiveEveryKeyframes:5', 'depthAILiveMinIntervalMs:8500',
    'function updatePrimarySurfacePreview', 'function scheduleCooperativeDepthAI',
    'function runCooperativeDepthAIFrame', 'function pumpCooperativeDepthAI',
    'function h5w5DepthAILiveSafe', 'function h5w5AcquireAI',
    'snapshotFrameId', 'OBJECT_SNAPSHOT_FROZEN', 'liveCaptureCount', 'ort.env.wasm.proxy=false', 'MOBILESAM_WASM_EXECUTION'
]: assert tok in s,tok

# WebXR stays visible and continues mapping in the object step.
start=s.find('const h5w4EnterObjectSeedingCoop=enterObjectSeeding;'); assert start>=0
end=s.find('function h5w5DepthAILiveSafe()',start); assert end>start
enter=s[start:end]
assert 'S.splat.visible=S.splatVisible' in enter
assert 'S.primarySurfaceGroup.visible=true' in enter

# A user tap freezes exactly one RGB-D map frame; later map-frame bitmap churn must
# not release or trim that frozen frame before MobileSAM consumes it.
cap=re.search(r'function captureSemanticFrameImage\(F,force=false\).*?\n}',s,re.S); assert cap
assert 'prevId!==frozenId' in cap.group(0)
push=re.search(r'function pushMapFrame\(.*?\n\n',s,re.S); assert push
assert 'x.id!==frozenId' in push.group(0)
freeze=re.search(r'function freezeObjectSeedSnapshot\(\).*?\n}',s,re.S); assert freeze
assert '!F.semanticBitmap&&!F.semanticBitmapPromise' in freeze.group(0)

# MobileSAM is invoked only on explicit segmentation; it shares a mutex with
# DepthAI, but the XR render function never awaits either model.
seg=re.search(r'segmentObjectSeed=async function\(\).*?\n\};',s,re.S); assert seg
assert "h5w5AcquireAI('sam')" in seg.group(0) and 'freezeObjectSeedSnapshot()' in seg.group(0)
render=re.search(r'render=function\(t,frame\).*?\n};',s,re.S); assert render
rb=render.group(0)
for tok in ['captureRawCamera(t,pose)','ingestPose(pose,t)','h5w5GeometryTickDue(t)','fuseRaw(frame,ref)','sampleDepth(frame,pose,t)','updatePrimarySurfacePreview()','pumpCooperativeDepthAI()']:
    assert tok in rb,tok
assert 'await runCooperativeDepthAIFrame' not in rb and 'await segmentObjectSeed' not in rb

# Heavy geometry is capped at 10 Hz while XR render remains every callback.
assert 'cooperativeGeometryPeriodMs:100' in s
assert 'S.renderer.render(S.scene,S.camera)' in rb

# DepthAI scheduling is cumulative, not tied to the capped 2-6 keyframe array length.
capwrap=re.search(r'captureDepthAIKeyframe=function\(F\).*?return ok\};',s,re.S); assert capwrap
assert 'S.depthAI.liveCaptureCount++' in capwrap.group(0)
sched=re.search(r'function scheduleCooperativeDepthAI\(F\).*?\n}',s,re.S); assert sched
assert 'S.depthAI.liveCaptureCount||0' in sched.group(0)

# Neural sessions remain warm through the XR measurement and are released at XR end.
for name in ['resumeScientificMeasurement','startMeasurementAfterObjectSeeding']:
    f=re.search(rf'async function {name}\(.*?\).*?\n}}',s,re.S); assert f and 'releaseSemanticSessions()' not in f.group(0)
i=s.find('async function ended('); j=s.find('function resetMap',i); assert i>=0 and j>i and 'releaseSemanticSessions()' in s[i:j]

# Primary surfaces are a visual layer only; scientific reconstruction remains separate.
assert 'S.primarySurfaceGroup=new THREE.Group()' in s
assert 'mesh.userData.primarySurface=true' in s
assert 'buildStructuralGraph(false)' in s

# Cooperative cache revision.
for tok in ["const CACHE='room-acoustic-v951h5w6'","const SEMANTIC_CACHE='room-acoustic-semantic-v951h5w6'","const DEPTH_CACHE='room-acoustic-depthai-v951h5w6'","const BUILD_REV='951h5w6'"]:
    assert tok in sw,tok

# Syntax checks for all browser JS contexts.
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
with tempfile.TemporaryDirectory() as td:
    q=Path(td)/'app.mjs'; q.write_text(m.group(1))
    for js in [q,ROOT/'depth_ai_worker.js',ROOT/'sw.js']:
        r=subprocess.run(['node','--check',str(js)],capture_output=True,text=True)
        assert r.returncode==0,r.stderr

res={
  'status':'PASS','build':'v9.5.1-hotfix5w6-verified-model-contracts',
  'xr_backbone':'continuous','heavy_geometry_hz':10,
  'mobilesam':'single frozen RGB-D snapshot per explicit tap; verified main-thread ORT path',
  'depthai':'periodic worker keyframes with XR metric gate',
  'primary_surfaces_live':True,'ai_mutex':True,'xr_never_awaits_ai':True,
  'deploy_rev':'951h5w6'
}
(ROOT/'tests/result_v951_hotfix5w5_cooperative_ai.json').write_text(json.dumps(res,indent=2)+'\n')
print(json.dumps(res,indent=2))
