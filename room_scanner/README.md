# Room Scanner v9.5.1 — Hotfix5W4 object selection + fullscreen Twin

## Hotfix5W5 cooperative XR + AI

The current build is `v9.5.1-hotfix5w7-stable-object-picking`. WebXR is always the
metric backbone. Heavy geometry fusion is capped at 10 Hz while XR rendering/pose
continues at the device rate. MobileSAM segments one frozen RGB snapshot selected
by the user and projects the mask back through synchronized XR depth. Depth Anything
V2 Small Q4F16 runs periodically in its worker on motion-gated keyframes and may add
only metric-gated low-weight detail surfels. Persistent primary XR surfaces are shown
live during mapping/object selection/measurement. See `COOPERATIVE_PIPELINE_V951.md`
and `PATCH_NOTES_V951_HOTFIX5W5.md`.


Hotfix5W4 is a general UI/flow recovery built on H5W3. It restores tap-driven
MobileSAM object selection, separates first-mask readiness from later multi-view
metric validation, fixes 3D boundary-point targeting, and makes Stage 5 an
exclusive full-screen Gaussian preview again. The final viewer now opens
automatically after measurement and has a viewer-only raw WebXR surfel fallback
so strict scientific pruning cannot leave the visual Twin empty. See
`PATCH_NOTES_V951_HOTFIX5W4.md`.

# Room Scanner v9.5.1 — Hotfix5 deploy integrity

Hotfix5 prevents mixed HTML/service-worker deployments, exposes the exact MobileSAM preflight error, keeps Hotfix4 decoder fallback and WebXR Gaussian visual fallback, and makes page navigation network-first. See `PATCH_NOTES_V951_HOTFIX5.md`.

# Room Scanner v9.5.1 — Hotfix4 model/runtime + WebXR Gaussian recovery

Hotfix4 keeps the Hotfix1 bootstrap fix, Hotfix2 mobile fixes (explicit
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

## Why COCO-SSD is not used in this build

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

The current service-worker namespace is `v951h5w2`, with separate semantic and DepthAI caches. Navigation and neural assets are network-first/no-store, with cache retained only as an offline fallback.

## Verification

Run:

    sh tests/run_current_suite.sh

The suite checks DOM/bootstrap integrity, WebGL viewer regression, MobileSAM
flow, the Stage-5-only DepthAI architecture, JavaScript syntax, and synthetic
metric alignment for both direct-depth and inverse-depth conventions.

## Hotfix4 deployment note — MobileSAM decoder

A successful HTTP fetch is **not** enough to declare MobileSAM usable. Hotfix4
runs a real encoder -> decoder smoke inference. Decoder candidates are tried in
this order:

1. `models/mobilesam.decoder.onnx` (FP32, local)
2. `models/mobilesam.decoder.quant.onnx` (quantized, local)
3. FP32 remote fallback
4. quantized remote fallback

`tools/fetch_mobilesam_models.py` now downloads **encoder + FP32 decoder +
quantized decoder** and writes a manifest. Run it again even if an older deploy
already contains the encoder and quantized decoder.

Same-origin neural assets are fetched network-first with a build query parameter
and the service worker uses a new `951h4` cache namespace. This prevents an old
ONNX/WASM response from surviving a GitHub Pages redeploy.

## Hotfix4 Stage 5 Gaussian fallback

Strict multi-view validation is still used for acoustic/structural inference.
Separately, the measured WebXR Gaussian field is snapshotted before final
pruning. If strict validation leaves too little geometry, Stage 5 can display
that measured provisional snapshot without promoting it to trusted acoustic
geometry. This restores the old WebXR-only visual path even when all AI models
are disabled.

The final viewer also performs an immediate first WebGL render; a lost/invalid
context is surfaced as an error instead of leaving an empty screen.

## Hotfix5W — Mobile AI warm sessions / no camera-blocking reload

Build: `v9.5.1-hotfix5w2-ort-metadata` — deploy revision `951h5w2`.

This revision fixes the semantic preload regression found on the mobile build:
`preflightGuidedObjectSeeding()` used to call `ensureMobileSamSemantic(true)`,
which released and recreated encoder/decoder sessions even immediately after the
user had pressed **Precarica AI**. The preload is now a real in-memory warm-up:
normal Map -> Objects navigation reuses the already smoke-tested sessions with no
network I/O and no `InferenceSession.create()` call. Only an explicit **Riprova
MobileSAM** forces a cold reset.

MobileSAM loading no longer uses the full-screen processing overlay. A compact,
pointer-transparent progress strip appears at the top only when a cold load is
actually necessary. The camera remains visible. Neural sessions are still
released before scientific acoustic measurement so WebXR/camera/audio do not
compete with MobileSAM for memory.

### Coherent MobileSAM bundle

Run:

    python3 tools/fetch_mobilesam_models.py

Hotfix5W deliberately fetches the coherent split model used by
`MobileSAM-in-the-Browser`: the Akbartus encoder plus its matching FP32 and
quantized decoders. Earlier builds fetched the PulpCut encoder under the same
local filename while applying the browser-demo HWC/raw-RGB preprocessing. That
mix is no longer assumed to be valid.

At runtime the app inspects the encoder input metadata and supports both:

- 3-D HWC browser export -> raw RGB values in 0..255;
- 4-D/NCHW/NHWC Hugging-Face-style export -> RGB rescale + ImageNet mean/std.

Complete encoder+decoder pairs are tested with a real smoke inference. Local,
browser-reference and PulpCut-compatibility candidates are isolated and rejected
individually if the full pair does not execute.

### Deployment/cache rule

`room_scanner_v9.html`, `sw.js` and `build_info.json` must all be uploaded from
this same release. Revision `951h5w2` uses network-first/no-store navigation and
neural assets, with cache only as offline fallback. This prevents a phone from
running cached Hotfix4 HTML while the server exposes Hotfix3 (or vice versa).

Before publishing a fully local copy:

    python3 tools/fetch_mobilesam_models.py
    python3 tools/fetch_onnxruntime_web.py
    python3 tools/fetch_depth_anything.py
    python3 tools/fetch_depthai_runtime.py
    python3 tools/check_deploy_bundle.py

Then run:

    sh tests/run_current_suite.sh

The expected app badge is `v9.5.1-hotfix5w2-ort-metadata`.


See `MODEL_CONTRACT_H5W6.md` for the pinned ONNX identities and verified input/output contracts.

## Hotfix5W6 - verified model contracts

H5W6 fixes the H5W5 model-runtime regression and makes AI preload deterministic. MobileSAM uses the normal browser-tested ORT WASM path with an absolute local WASM base; Depth Anything keeps its dedicated worker with an absolute local WASM base. Pinned model bytes/hashes, session contracts and real smoke inference are verified before acquisition. See `MODEL_CONTRACT_H5W6.md`, `PATCH_NOTES_V951_HOTFIX5W6.md` and `TEST_REPORT_V951_HOTFIX5W6.md`.

## H5W7 object picking

Object selection is RGB-first: a user tap freezes the current camera frame and synchronized pose for MobileSAM. XR depth is optional at prompt time; after the 2D mask is produced, metric support is recovered from synchronized depth and/or the continuously maintained WebXR surfel map. Primary live planes render at 4.5% opacity so the camera remains readable.
