"""Static integration contract for the SAM-free V10 metric-fusion journey."""
from pathlib import Path


html = Path(__file__).resolve().parents[1].joinpath("room_scanner_v10.html").read_text()

required = [
    "APP_BUILD='v10.0.6-metric-fusion'",
    "id=\"v10Save\"", "id=\"v10Photos\"", "id=\"v10Model\"",
    "id=\"v10Settings\"", "id=\"v10Trace\"", "function v10Log(",
    "function v10RenderDepthPoints(", "function v10MetricPath()",
    "function v10BuildMetricPreviewModel()", "S.finalModel=v10BuildMetricPreviewModel()",
    "sources?.depthai", "h5w15CaptureManualReviewFrame",
    "Depth Anything NON integrata · frame #", "function v10PruneUnexplainedSlice(",
    "S.depthAI.lastMetricCheck", "await v10PruneUnexplainedForPreview()",
    "async function v10EndSessionForViewer()", "await v10EndSessionForViewer()",
    "S.renderer.setAnimationLoop(render)",
    "Viewer chiuso. La sessione WebXR era stata terminata per il viewer",
    "function v10PhotoStatus(", "function v10RenderPhotoReview(",
    "async function v10AnalyzeManualReview(", "function v10DepthHeatmap(",
    "const v10EnsureDepthAIWorkerBase=ensureDepthAIWorker;",
    "rgbSource:'foto RGB selezionata'", "color:depthAIRgbAt(F,u,v)",
    "vertexColors:true",
]
for token in required:
    assert token in html, token

assert "body.v10-mode #hud>.top,body.v10-mode #hud>.bottom" in html
assert "#v10Live{z-index:108!important}" in html

v10_open = html[html.index("async function v10OpenModel"):html.index("const v10CloseViewerBase")]
assert "buildRawPreviewModel()" not in v10_open
assert "v10BuildMetricPreviewModel()" in v10_open
assert "await v10EndSessionForViewer()" in v10_open
assert v10_open.index("await v10EndSessionForViewer()") < v10_open.index("openFinalViewer()")
assert "finalizeSurfelMapCooperative" in v10_open

# The active V10 tail neither opens the object screen nor loads/runs SAM.
v10_tail = html[html.index("// V10 deliberately has no semantic stage."):]
for forbidden in [
    "preflightGuidedObjectSeeding(", "segmentObjectSeed()", "enterObjectSeeding(",
    "v10SetSamEnabled", "v10SamToggle",
]:
    assert forbidden not in v10_tail, forbidden
assert "S.semantic.autoDiscover=false" in v10_tail
assert "S.semantic.mode='off'" in v10_tail
assert "$('#objectSeedUI')?.remove()" in v10_tail
assert "R.manualDepthState='awaiting-confirmation'" in v10_tail
assert "✓ Applica ${R.manualDepthCandidatePoints||0} punti" in v10_tail
assert "fuseDepthAIFrame(D,pred,out.outputWidth,out.outputHeight,fit,h5w5LiveDepthBudget(),true)" in v10_tail
assert "v10AutoFuseManualReview" not in v10_tail
assert "Riprovo la preview" in v10_tail
assert "↻ Ricalcola Depth" in v10_tail
assert "riproiettati con posa WebXR nella nuvola 3D globale" in v10_tail

for token in [
    "id=\"v10PhaseScan\"", "id=\"v10PhaseModel\"", "id=\"v10PhasePhotos\"",
    "function v10PhotoStatus(", "function v10ShowPhotoStage()", "manualDepthState",
    "depthAIFitMetric=function",
]:
    assert token in html, token

manual = html[html.index("async function h5w15CaptureManualReviewFrame"):html.index("const h5w15ContinueFromMapBase")]
assert "h5w15RegisterReviewFrame" in manual
assert "segmentObjectSeed" not in manual

print({"status": "PASS", "contracts": len(required), "sam_free_v10_tail": True})
