# v9.5.1 Hotfix3 — DepthAI keyframe detail pass

- Adds a deferred `Depth Anything V2 Small Q4F16` Stage-5 pass.
- Keeps WebXR as the only metric/scale authority.
- Captures at most six sparse RGB-D keyframes; no DepthAI inference runs during XR acquisition.
- Uses a dedicated Web Worker and separate ONNX Runtime so MobileSAM's runtime is untouched.
- WebGPU is preferred when available; WASM is the fallback.
- Robustly calibrates relative AI depth against synchronized XR depth, testing direct and inverse-depth affine fits.
- Rejects poor whole-frame calibration and per-sample XR disagreements.
- Adds low-weight `depthai` surfels without free-space carving.
- Adds adaptive phone budgets (2–6 keyframes and 60x34–88x50 fusion grids).
- Keeps MobileSAM optional for true object masks; COCO-SSD is not added because bounding boxes do not isolate removable geometry.
- Adds a UI A/B switch and DepthAI diagnostics.
- Adds service-worker/cache namespace `v951h3` and a separate DepthAI cache.
- Adds model/runtime fetch helpers plus strict deployment readiness checks.
