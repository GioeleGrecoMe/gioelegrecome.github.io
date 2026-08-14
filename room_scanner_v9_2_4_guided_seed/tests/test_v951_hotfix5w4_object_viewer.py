from pathlib import Path
import re, json
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
sw=(ROOT/'sw.js').read_text()

assert "APP_BUILD='v9.5.1-hotfix5w6-verified-model-contracts'" in s
assert "DEPLOY_REV='951h5w6'" in s
assert "const CACHE='room-acoustic-v951h5w6'" in sw

# Guided selection is tap-first, not strict multi-view-first.
assert '#objectSeedMask{position:absolute;z-index:1;' in s
assert 'body.object-seeding #objectSeedUI{display:block;pointer-events:auto}' in s
assert 'pointer-events:auto;touch-action:none' in s
assert '.objectSeedDock{position:absolute;z-index:3;' in s
assert '.objectSeedTop{position:absolute;z-index:3;' in s
assert "$('#objectSeedMask').addEventListener('pointerup',objectSeedPointerSelect" in s
assert 'promptUV:{u:.5,v:.5}' in s
assert 'const uv=S.objectSeeding.promptUV||{u:.5,v:.5}' in s
assert "b.textContent=R.ready?'Segmenta qui':'Tocca una zona con depth…'" in s
assert 'metricReady=' in s and 'ready=age<=' in s
assert 'targetPoint:targetSample?' in s
assert "R.targetPoint=v95ReticleWorldPoint(F)?.toArray()||R.targetPoint||null" in s
assert 'v95ReticleWorldPoint' in s and 'Math.floor(uv.u*F.cols)' in s
assert "Tocca l’elemento da isolare" in s

# Stage 5 is an exclusive full-screen viewer and opens automatically after measurement.
assert 'body.viewer-active #landing' in s
assert 'body.viewer-active #finalView{display:block!important}' in s
assert '#finalView{position:fixed;inset:0;z-index:130;' in s
assert 'function enterFinalViewerMode()' in s
assert "document.body.classList.add('viewer-active')" in s
assert 'function exitFinalViewerMode()' in s
assert 'function ensureFinalViewerGeometry()' in s
assert "S.finalModel=buildRawPreviewModel()" in s
assert "if(!openFinalViewer())log('AUTO_STAGE5_PREVIEW_FAILED'" in s
assert 'buildDisplayGeometryGaussianField()' in s
assert 'snapshotWebXRVisualGaussians' in s
assert 'function buildMeasuredSurfelDisplayFallback' in s and 'WEBXR_VISUAL_RAW_FALLBACK' in s
assert 'id="finalReprocess"' in s and "$('#finalReprocess').onclick=processFinalModel" in s

# Processing over the viewer is compact, not an opaque full-screen interruption.
assert 'body.viewer-active #processingOverlay{z-index:160;' in s
assert 'align-items:flex-end' in s

res={
  'status':'PASS',
  'build':'v9.5.1-hotfix5w6-verified-model-contracts',
  'tap_first_object_selection':True,
  'metric_readiness_deferred':True,
  'selected_uv_drives_sam_and_3d':True,
  'fullscreen_stage5':True,
  'automatic_raw_gaussian_preview':True,
  'webxr_display_fallback':True,
}
(ROOT/'tests/result_v951_hotfix5w4_object_viewer.json').write_text(json.dumps(res,indent=2)+'\n')
print(json.dumps(res,indent=2))
