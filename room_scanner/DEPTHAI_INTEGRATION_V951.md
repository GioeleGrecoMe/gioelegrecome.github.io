# Depth Anything V2 Small — Stage-5 detail pass

Build: `v9.5.1-hotfix5w13-depthai-runtime-compat`

## Cooperative live refinement + deferred remainder

Depth Anything is **not** run in the WebXR render loop. During scanning the app
keeps at most six spatially separated RGB-D keyframes (384x216 RGB plus the
existing 32x24 XR depth grid). The neural model is loaded only in Stage 5, after
the live acquisition has ended.

This keeps WebXR pose/depth/plane/mesh tracking as the metric authority and
prevents a transformer inference from competing with tracking, audio capture or
rendering on the phone.

## Model

The worker uses two compatible official variants:

`onnx-community/depth-anything-v2-small/onnx/model_q4f16.onnx` for WebGPU and
`onnx-community/depth-anything-v2-small/onnx/model_q4.onnx` for WASM.

Q4F16 is ~19.1 MB (`eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e`). Q4 is ~27.4 MB (`5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`).

`eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e`

Install it for same-origin/offline deployment with:

```bash
python3 tools/fetch_depth_anything.py
```

The app still has a pinned Hugging Face fallback if the local file is absent.

## Metric safety gate

The ONNX model is used as a **relative-depth detail prior**, never as room scale.
For every AI keyframe the app:

1. samples synchronized WebXR depth anchors;
2. robustly fits both `z = a*d+b` and `1/z = a*d+b` conventions;
3. chooses the fit with lower relative error;
4. rejects the whole keyframe if median relative error > 16% or p90 > 32%;
5. rejects individual AI samples disagreeing with XR depth by > 30%;
6. fuses accepted points with lower weight (`source=depthai`) and no free-space carving.

So a bad monocular prediction can be ignored, but cannot rescale the room or
erase metric geometry.

## Mobile compute policy

Runtime lives in `depth_ai_worker.js`, isolated from MobileSAM's ORT instance.
WebGPU is attempted on compatible Chromium/Android; WASM uses Q4 as a true fallback. Q4F16 is not offered to WASM because its fp16-weight operators are not reliably implemented there.
The worker vendors ONNX Runtime Web **1.23.2** in `vendor/depthai-123/`: this
version has been smoke-tested with the pinned Q4F16 conversion, whereas 1.24.1
rejected that graph in its WASM session constructor on the tested browser.
Preprocessing follows the model metadata defensively. If the loaded ONNX export declares a static numeric input shape, the worker uses that exact HxW. If the export exposes dynamic/symbolic spatial dimensions, the worker follows the DPT preprocessor policy (`keep_aspect_ratio=true`, dimensions constrained to multiples of 14); a 384x216 landscape keyframe then becomes approximately 518x294. The actual tensor shape is recorded in diagnostics for each accepted keyframe.

The Stage-5 budget is adaptive:

- low-end/save-data: 2 WASM or 3 WebGPU keyframes, 60x34 fusion grid;
- WASM default: max 3 keyframes, 64x36 fusion grid;
- mid-range WebGPU: max 4 keyframes, 76x43 fusion grid;
- higher-end WebGPU: max 6 keyframes, 88x50 fusion grid.

The diagnostic export records provider, budget, inference milliseconds,
accepted/rejected frames, metric-fit errors and fused point count for real A/B
measurement on the target phone.

## MobileSAM remains optional

MobileSAM is kept only for the guided object-isolation step and is released
before measurement. A bounding-box-only detector such as COCO-SSD is lighter,
but it does not provide the object mask needed to keep removable object geometry
separate. Therefore Hotfix3 does not replace MobileSAM; it lets the user disable
it and still obtain a WebXR + DepthAI room reconstruction.


## Hotfix5W5 live scheduler

DepthAI is no longer restricted to Stage 5. Motion-gated RGB-D keyframes are captured
while WebXR runs; every configurable keyframe interval a worker inference may run if
realtime load, SAM state and acoustic sweep state permit it. The prediction must pass
XR metric alignment before any low-weight `depthai` surfels are fused. Stage 5 retains
the same pipeline for keyframes that were deferred during acquisition.
