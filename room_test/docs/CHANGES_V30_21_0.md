# V30.21.0 — Ultra-low-budget depth path

This patch keeps the same bundled `models/model_q4.onnx`; no model file is changed.

- Deep Anything short-side target: **392 -> 112 px** (8 ViT/14 patches). A 256x384 scan frame becomes 112x168.
- The explicit model test uses **one inference** on a healthy provider. The old warm duplicate and flip duplicate are removed.
- The WebGPU spatial quality gate remains. WASM A/B runs only when the first map is suspicious.
- WASM `numThreads` is **0/automatic** instead of forced to 1, allowing ORT to use multiple cores when cross-origin isolation permits it.
- Deep model responses can be cached by the worker for faster repeated loads/offline reuse.
- Deep-guided plane sweep starts at pixel step 4, 2 source views, and 10 local prior hypotheses to reduce post-inference cost.
- AlvaAR tracking, metric scale ownership, robust Deep->Alva calibration, multi-view validation, and TSDF fusion remain authoritative.

The 112 px setting is intentionally aggressive. If a particular phone/model export cannot produce a calibratable prior at that resolution, the worker has a 196 px compatibility plan before falling back to the 518 px legacy contract.
