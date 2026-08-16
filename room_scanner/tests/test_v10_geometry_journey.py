"""Static integration contract for the v10 geometry-first WebXR journey."""
from pathlib import Path


html = Path(__file__).resolve().parents[1].joinpath("room_scanner_v10.html").read_text()

required = [
    "APP_BUILD='v10.0.5-three-phase-review'",
    "$('#hud').append($('#v10Live'));$('#hud').append($('#objectSeedUI'))",
    "id=\"v10Save\"",
    "id=\"v10Objects\"",
    "id=\"v10Model\"",
    "id=\"v10Settings\"",
    "id=\"v10Trace\"",
    "function v10Log(",
    "function v10RenderDepthPoints(",
    "function v10MetricPath()",
    "function v10BuildMetricPreviewModel()",
    "S.finalModel=v10BuildMetricPreviewModel()",
    "sources?.depthai",
    "h5w15CaptureManualReviewFrame",
    "const v10SegmentObjectBase=segmentObjectSeed;",
    "MobileSAM OK · frame #",
    "Depth Anything NON integrata · frame #",
    "function v10PruneUnexplainedSlice(",
    "S.depthAI.lastMetricCheck",
    "await v10PruneUnexplainedForPreview()",
    "function v10SetSamEnabled(want)",
    "id=\"v10SamToggle\"",
    "async function v10EndSessionForViewer()",
    "await v10EndSessionForViewer()",
    "finishObjectSeeding=async function(skip=false)",
    "S.renderer.setAnimationLoop(render)",
    "Viewer chiuso. La sessione WebXR era stata terminata per il viewer",
]
for token in required:
    assert token in html, token

# The buttons have to remain usable in the WebXR DOM Overlay. Hiding normal
# legacy HUD controls is fine, hiding the new HUD is not.
assert "body.v10-mode #hud>.top,body.v10-mode #hud>.bottom" in html
assert "body.object-seeding #v10Live{display:none!important}" in html
assert "#v10Live{z-index:108!important}" in html

# v9's generic preview builder serializes a different path representation.
# The v10 viewer must use its own vector-safe geometry-only export.
v10_open = html[html.index("async function v10OpenModel"):html.index("const v10CloseViewerBase")]
assert "buildRawPreviewModel()" not in v10_open
assert "v10BuildMetricPreviewModel()" in v10_open
assert "await v10EndSessionForViewer()" in v10_open
assert v10_open.index("await v10EndSessionForViewer()") < v10_open.index("openFinalViewer()")
assert "finalizeSurfelMapCooperative" in v10_open
assert "showProcessing('Modello 3D'" in v10_open

# SAM must be opt-in but the Objects action must be able to prepare the local
# models and expose the explicit Review -> ROI -> Apply SAM route.
sam = html[html.index("async function v10SetSamEnabled"):html.index("// Record why metric alignment")]
assert "preflightGuidedObjectSeeding" in sam
assert "S.v10.samEnabled=true" in sam
assert "S.v10.samEnabled=false" in sam
assert "semanticWarmReady()" in sam

# Explicit DepthAI on a reviewed user photo must fuse a new RGB-colored metric
# surfel field into the global map, then attach the same verified depth to the
# still-reviewable SAM proposal.
assert "function v10DepthInferenceFrameForReview(" in html
assert "async function v10FuseReviewDepthIntoMap(" in html
assert "v10FuseReviewDepthIntoMap(F)" in html
assert "rgbSource:'foto RGB selezionata'" in html
assert "color:depthAIRgbAt(F,u,v)" in html
assert "vertexColors:true" in html
assert "Auto SAM foto: ON" in html

# V10 exposes only the scan / model / review route. Manual photos queue DepthAI
# automatically; object review asks only to confirm the proposed mask or remove
# the photo and take it again.
for token in [
    "id=\"v10PhaseScan\"",
    "id=\"v10PhaseModel\"",
    "id=\"v10PhaseReview\"",
    "async function v10AutoFuseManualReview(",
    "Depth Anything automatica OK",
    "✓ Conferma oggetto",
    "✕ Elimina foto",
    "async function v10RejectCurrentReview()",
]:
    assert token in html, token

# A manual screenshot must be a review-only operation; it must not invoke SAM.
manual = html[html.index("async function h5w15CaptureManualReviewFrame"):html.index("const h5w15ContinueFromMapBase")]
assert "h5w15RegisterReviewFrame" in manual
assert "segmentObjectSeed" not in manual

print({"status": "PASS", "contracts": len(required), "manual_photo_starts_sam": False})
