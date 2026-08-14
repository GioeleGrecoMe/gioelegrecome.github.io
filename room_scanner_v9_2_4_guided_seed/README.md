# Room Scanner v9.3 — Engineered Workflow

**Build:** `v9.3-engineered-workflow`

## Main workflow

1. **Audio** — calibrate speaker/microphone, or load an existing calibration package.
2. **Map** — open WebXR and walk a short baseline. Pose, depth, XRPlane/XRMesh, RGB keyframes and Gaussian surfels are collected. No chirps are emitted.
3. **Objects (optional)** — only after the map exists, the app runs a real EfficientSAM encoder→decoder preflight. If it succeeds, point at one object, segment, inspect the mask, confirm or retry, then repeat. If SAM fails, this step is skipped automatically.
4. **Measurement** — SAM sessions are released and scientific PCM + short chirp packets begin. Geometry keeps refining. Back pauses new chirps without destroying captured PCM.
5. **Twin** — cooperative final processing, Gaussian visual/acoustic field, optional structural inference, exports and explicit virtual RIR generation.

The detailed transition contract is in `ENGINEERING_WORKFLOW_V93.md`.

## Why objects are after the initial map

A good 2-D mask is not enough to localize an object metrically. The guided object stage starts only after WebXR has already collected pose, depth and a small multi-view baseline. The confirmed mask therefore labels visible 3-D evidence immediately; later views refine or reject that geometry using the same probabilistic map.

EfficientSAM never promotes a point to geometrically valid by itself. Metric truth remains WebXR/depth/XR geometry + multi-view confirmation.

## Back navigation

- Map → Audio: closes XR and keeps the acoustic calibration.
- Objects → Map: no geometry is lost.
- Measurement → previous setup: pauses new chirps and keeps the PCM/data already acquired.
- Returning all the way to Audio after measurement has begun asks for explicit confirmation because it terminates the active acquisition.
- Final viewer → Review: use the close/back control.

## EfficientSAM

Bundled upstream EfficientSAM-Ti split ONNX models:

- `models/efficient_sam_vitt_encoder.onnx`
- `models/efficient_sam_vitt_decoder.onnx`

The app also accepts the original `EfficientSAM-main.zip` or a ZIP containing an encoder and decoder ONNX.

Provider policy:

1. WebGPU smoke test;
2. if session creation **or inference** fails, retry with WASM;
3. if both fail, skip the optional Objects stage and continue the scan.

See `SAM_FAILURE_ANALYSIS.md`, `SAM_MODEL_ZIP_FORMAT.md`, and `EFFICIENTSAM_OFFLINE_SETUP.md`.

## Desktop / offline projects

On a desktop browser the app can open existing RAW/project ZIP or a processed digital-twin JSON without WebXR or microphone access. RAW audio processing remains lazy so opening a large project does not block the UI.

## Realtime policy

The live stage is budgeted. Full multi-view validation, structural fitting, full acoustic analysis and expensive quality reports are kept out of the XR hot path. The device governor can reduce RGB readback/preview work before it reduces metric depth fusion.

## Diagnostics

Use **Diagnostica ZIP** during or after a problematic run. It records workflow state, realtime load, mapping counts, semantic provider/preflight attempts, object state, audio packets/RIR state, tracking integrity and recent errors without exporting the heavy media payload.

## Validation

The package includes Python/static regressions in `tests/`. `TEST_REPORT_V930.md` summarizes the final extracted-package verification.
