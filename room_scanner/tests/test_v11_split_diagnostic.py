"""Contract test for the deliberately split V11 diagnostic page."""
from pathlib import Path


root = Path(__file__).resolve().parents[1]
v10 = (root / "room_scanner_v10.html").read_text()
v11 = (root / "room_scanner_v11.html").read_text()

# Regression: this was an accidental strict-mode global assignment and caused
# "Uncaught ReferenceError: rgb is not defined" when rendering a manual photo.
assert "const s=v10PhotoStatus(R),row=document.createElement('div'),rgb=R.rgbPreview||R.thumb;" in v10
assert "row.className='v10PhotoRow',rgb=" not in v10

for token in [
    "const BUILD='v11.0.3-camera-freeze-preload'",
    "navigator.mediaDevices.getUserMedia",
    "new Worker(`./depth_ai_worker.js?rsbuild=${REV}`)",
    "modelWasmLocal:'./models/depth_anything_v2_small_q4.onnx'",
    "forceWasm:true",
    "inputSize:392",
    "720/Math.max(sw,sh)",
    "function freezeCameraFrame()",
    "Scatta frame (max 720p)",
    "setTimeout(()=>ensureDepth()",
    "await workerRequest('smoke')",
    "await workerRequest('infer'",
    "drawHeatmap(depth,r.outputWidth,r.outputHeight)",
    "drawRgb(f.rgba,f.w,f.h)",
    "assets/depth-test-room-v1.png",
    "assets/depth-test-room-v1-expected-depth.png",
    "setDepthProgress",
    "function endDepth()",
    "if(cameraStream||worker)throw new Error('chiudi prima la sessione Depth",
    "navigator.xr.isSessionSupported('immersive-ar')",
    "navigator.xr.requestSession('immersive-ar'",
    "function onXRFrame",
    "nessuna</b>inferenza Depth in questa sessione",
    "window.addEventListener('beforeunload'",
]:
    assert token in v11, token

# It is a diagnostic isolator, never a mapper or an AI/XR fusion page.
for forbidden in ["fuseDepthAIFrame", "startSpatialCalibration", "THREE.", "SAM", "MobileSAM"]:
    assert forbidden not in v11, forbidden

print({"status": "PASS", "v11": "split-depth-webxr", "v10_rgb_regression": "fixed"})
