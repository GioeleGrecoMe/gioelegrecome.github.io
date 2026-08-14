# Room Scanner v9.5.1 — Hotfix3 DepthAI keyframe twin

Hotfix3 keeps the Hotfix1 bootstrap fix and Hotfix2 mobile fixes (explicit
MobileSAM Step 3 failure UI + single WebGL renderer for Stage 5), then adds a
**deferred Depth Anything V2 Small Q4F16 detail pass**. See
`PATCH_NOTES_V951_HOTFIX3.md` and `DEPTHAI_INTEGRATION_V951.md`.

## Runtime architecture

The live phone loop remains deliberately light:

- WebXR pose / metric depth / planes / meshes are the geometric authority.
- Surfel evidence, reprojection and structural geometry run during acquisition.
- MobileSAM is optional and only used in the guided object-isolation step.
- Depth Anything does **not** run during WebXR acquisition. At most six sparse
  RGB-D keyframes are retained and processed later in Stage 5.
- Stage 5 calibrates every relative Depth Anything map against synchronized XR
  depth and rejects inconsistent frames/samples before adding low-weight detail.

This keeps object masks and metric room geometry separate while preventing the
neural depth model from setting room scale.

## Depth Anything V2 Small Q4F16

Target same-origin model path:

    models/depth_anything_v2_small_q4f16.onnx

The selected ONNX Community Q4F16 model is about 19.1 MB. Install and checksum it
with:

    python3 tools/fetch_depth_anything.py

Install the isolated DepthAI ONNX Runtime Web assets with:

    python3 tools/fetch_depthai_runtime.py

The app has remote fallbacks for both, but same-origin files are preferred for
repeatable/offline deployment.


### Generated archive note

The source package generated in this environment contains the integration,
remote fallback, cache logic, checksum-pinned fetch helper and tests, but it
does **not** contain the 19.1 MB ONNX binary itself because the artifact
downloader blocks `application/octet-stream` exports into the sandbox. For the
first online test on GitHub Pages the worker can fetch the pinned Hugging Face
URL lazily. For a fully local/offline deploy, run `tools/fetch_depth_anything.py`
before publishing and verify `FULL_LOCAL_READY=yes`.

### Mobile budget

The model runs in a dedicated Web Worker. WebGPU is attempted on compatible
Chromium/Android; WASM is the fallback. The Stage-5 budget adapts to device
memory/CPU/provider: roughly 2–3 keyframes on low-end/WASM phones, 4 on
mid-range WebGPU devices, and at most 6 on higher-end WebGPU devices. The
fusion grid is reduced at the same time.

The diagnostic export reports provider, selected budget, inference time per
keyframe, alignment median/p90 error, accepted/rejected frames and points fused.
Use those values for real A/B testing on the target phone.

## MobileSAM weights

For deterministic object masks, install:

    python3 tools/fetch_mobilesam_models.py

or normalize an existing ZIP:

    python3 tools/install_mobilesam_zip.py /path/to/mobile_sam_bundle.zip

The UI can also load an encoder+decoder ZIP directly in browser memory. If the
preflight fails, Step 3 stays visible and offers retry/upload/explicit skip.

## MobileSAM ONNX Runtime

MobileSAM retains its own compatible ONNX Runtime Web 1.14 assets:

    python3 tools/fetch_onnxruntime_web.py

DepthAI uses a separate worker/runtime so it cannot mutate this environment.

## Why COCO-SSD is not used in Hotfix3

A box detector is cheaper and useful for labels, but a bounding box does not
separate the object's geometry from nearby walls/furniture. Because the twin
needs individually removable objects, MobileSAM remains the optional mask path.
It can be disabled for a WebXR + DepthAI geometry-only A/B run.

## Deterministic GitHub Pages deployment

Before publishing a self-contained build run:

    python3 tools/fetch_mobilesam_models.py
    python3 tools/fetch_onnxruntime_web.py
    python3 tools/fetch_depth_anything.py
    python3 tools/fetch_depthai_runtime.py
    python3 tools/check_deploy_bundle.py

The service-worker namespaces are `v951h3`, including a separate lazy DepthAI
cache. Reload once after deployment so the new worker takes control.

## Verification

Run:

    sh tests/run_current_suite.sh

The suite checks DOM/bootstrap integrity, WebGL viewer regression, MobileSAM
flow, the Stage-5-only DepthAI architecture, JavaScript syntax, and synthetic
metric alignment for both direct-depth and inverse-depth conventions.
