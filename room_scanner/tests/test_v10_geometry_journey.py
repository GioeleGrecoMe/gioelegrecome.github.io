"""Static integration contract for the SAM-free V10 metric-fusion journey."""
from pathlib import Path


html = Path(__file__).resolve().parents[1].joinpath("room_scanner_v10.html").read_text()

required = [
    "APP_BUILD='v10.0.9-depth-wasm-verified'",
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
    "function v10ExportRawRoom()", "async function v10LoadRawRoomFile(file)",
    "v10_room_raw.json", "v10_surfels.csv", "v10_map_frames.json",
    "id=\"v10OpenRaw\"", "id=\"v10RawInput\"", "id=\"v10SaveRaw\"",
    "rawLoaded:true", "photos/photo-",
    "async function v10StartScanWithDepthCheck", "await preflightDepthAI()",
    "smoke inference riuscita",
    "depthAIModelWasmLocal:'./models/depth_anything_v2_small_q4.onnx'",
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
assert "function v10BuildAnchoredReviewFit(" in v10_tail
assert "R.manualDepthState='needs-anchors'" in v10_tail
assert "const budget=strictFit?h5w5LiveDepthBudget():v10CautiousReviewBudget()" in v10_tail
assert "function v10MapEvidence()" in v10_tail
assert "function v10DiscardManualPhoto(" in v10_tail
assert "Elimina foto" in v10_tail
assert "rgbaOrigin:V.rgbaOrigin||'top-left'" in html
assert "A second flip here inverted every saved preview" in html
assert "v10AutoFuseManualReview" not in v10_tail
assert "Riprovo la preview" in v10_tail
assert "↻ Ricalcola Deep" in v10_tail
assert "WebXR-globali" in v10_tail
assert "room-scanner-v10-raw-room-v1" in v10_tail
assert "v10LoadRawRoomFile" in v10_tail
assert "manualDepthState:'restored'" in v10_tail

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
