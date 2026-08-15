"""Static integration contract for the v10 geometry-first WebXR journey."""
from pathlib import Path


html = Path(__file__).resolve().parents[1].joinpath("room_scanner_v10.html").read_text()

required = [
    "APP_BUILD='v10.0.1-guided-xr-hud'",
    "$('#hud').append($('#v10Live'));$('#hud').append($('#objectSeedUI'))",
    "id=\"v10Save\"",
    "id=\"v10Objects\"",
    "id=\"v10Model\"",
    "id=\"v10Settings\"",
    "id=\"v10Trace\"",
    "function v10Log(",
    "function v10RenderDepthPoints(",
    "sources?.depthai",
    "h5w15CaptureManualReviewFrame",
    "segmentObjectSeed=async function(){if(!S.objectSeeding.reviewFrameId)",
    "finishObjectSeeding=async function(skip=false)",
    "S.renderer.setAnimationLoop(render)",
    "Viewer chiuso: scansione WebXR e controlli ripristinati.",
]
for token in required:
    assert token in html, token

# The buttons have to remain usable in the WebXR DOM Overlay. Hiding normal
# legacy HUD controls is fine, hiding the new HUD is not.
assert "body.v10-mode #hud>.top,body.v10-mode #hud>.bottom" in html
assert "body.object-seeding #v10Live{display:none!important}" in html
assert "#v10Live{z-index:108!important}" in html

# A manual screenshot must be a review-only operation; it must not invoke SAM.
manual = html[html.index("async function h5w15CaptureManualReviewFrame"):html.index("const h5w15ContinueFromMapBase")]
assert "h5w15RegisterReviewFrame" in manual
assert "segmentObjectSeed" not in manual

print({"status": "PASS", "contracts": len(required), "manual_photo_starts_sam": False})
