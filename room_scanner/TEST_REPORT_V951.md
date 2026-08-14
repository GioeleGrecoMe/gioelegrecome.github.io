# Room Scanner v9.5.1 Hotfix3 — Verification report

Build: `v9.5.1-hotfix3-depthai-keyframes`

## Scope verified

- Hotfix1 bootstrap regression: `pumpSemanticQueue` declared and audio/output handlers reachable.
- Hotfix2 Step 3: MobileSAM failure remains visible with retry/upload/explicit skip; no silent stage bypass.
- Hotfix2 Stage 5: final Digital Twin reuses the scanner WebGL renderer; failed viewer open rolls back instead of leaving a black screen.
- Hotfix3 Depth Anything V2 Small Q4F16: deferred Stage-5 keyframes only; no neural depth inference in the WebXR live loop.
- Metric safety: DepthAI is relative-depth only; direct-depth and inverse-depth calibration are tested against synchronized XR depth and bad maps are rejected.
- Mobile compute policy: 2–6 adaptive keyframes, lower fusion grids on WASM/low-memory devices, WebGPU attempted only when available.
- Worker isolation: DepthAI uses its own ONNX Runtime 1.24.1 worker; MobileSAM's pinned runtime is not mutated.
- ONNX shape safety: static model input dimensions are honored from `session.inputMetadata`; dynamic inputs use aspect-preserving DPT preprocessing and multiples of 14.
- Service worker/cache version: `v951h3`, with separate lazy DepthAI and MobileSAM caches.

## Important artifact limitation

The executable environment used to assemble this package can inspect the Hugging Face model metadata but blocks exporting `application/octet-stream` downloads into the sandbox. Therefore the 19.1 MB ONNX binary itself is **not embedded in this generated archive**. The application has a pinned Hugging Face remote fallback for online testing, and `tools/fetch_depth_anything.py` downloads the exact Q4F16 file and verifies SHA-256 before deployment in a normal networked shell.

Expected model:

- file: `models/depth_anything_v2_small_q4f16.onnx`
- size: 19,126,267 bytes
- SHA-256: `eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e`

For a deterministic/offline deployment, run all fetch helpers and then `tools/check_deploy_bundle.py` until it reports `FULL_LOCAL_READY=yes`.

## Runtime measurement

A desktop static/headless test cannot reproduce phone thermals or WebXR camera/depth APIs. The build therefore records the quantities that matter on the real device: provider (`webgpu`/`wasm`), model input shape, inference milliseconds per keyframe, selected compute tier, metric median/p90 error, accepted/rejected frames, and fused DepthAI points. The UI toggle permits A/B comparison of WebXR-only versus WebXR+DepthAI on the same scan/device.
