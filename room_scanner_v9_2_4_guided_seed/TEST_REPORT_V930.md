# Room Scanner v9.3 — Validation report

Build: `v9.3-engineered-workflow`

## Architecture decision tested

The acquisition GUI is now an explicit reversible state machine:

`calibration -> map -> objects (optional) -> measurement -> review`

The object stage is deliberately after a short metric map warm-up and before acoustic excitation.

## Workflow regressions

- XR startup enters **Map**, not SAM and not PCM acquisition.
- Map collects pose/depth/RGB-D/Gaussian evidence with no `runAutoSweepLoop()` and no `startAcquisition()`.
- Map Continue performs the EfficientSAM encoder+decoder preflight.
- Successful preflight enters the clean **Objects** screen.
- Failed preflight skips Objects and starts/resumes Measurement with an explicit reason.
- Objects Back returns to the existing map without clearing geometry.
- Measurement Back sets `autoSweepPaused`, increments the sweep token, preserves current PCM/data and returns to setup.
- Returning all the way to Audio after measurement begins requires explicit confirmation.
- Map and Objects UI are descendants of the WebXR DOM-overlay root.
- Object management is also inside the overlay, so deleting a confirmed object does not depend on a sibling page panel.
- SAM sessions are released before normal measurement.

## Static/deep audit

- DOM IDs: 269
- unique DOM IDs: 269
- named functions: 577
- unique named functions: 577
- event-handler targets: 96
- missing handler targets: 0
- missing simple `$('#id')` targets: 0
- module `node --check`: PASS
- service worker `node --check`: PASS

## EfficientSAM integrity

The bundled model hashes remain identical to the user-provided upstream repository archive:

- encoder: `84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951`
- decoder: `a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11`

Provider fallback regression remains PASS: WebGPU run failure can recreate the sessions on WASM.

## Existing scientific regressions

15/15 Python/static regression programs pass, including:

- realtime governor / hot-path budget
- diagnostic ZIP
- preview/final processing
- local EfficientSAM assets
- guided object seed geometry
- semantic preflight
- provider fallback
- v9 multi-view mapping / ghost pruning
- legacy RAW compatibility using `Test_v8.zip`
- semantic boundary + structural graph
- virtual acoustic array localization
- v9.3 engineered workflow

## HTTP asset smoke test

Served from a clean local HTTP root:

- `room_scanner_v9.html`: 200
- `models/efficient_sam_vitt_encoder.onnx`: 200, 24,799,761 bytes
- `models/efficient_sam_vitt_decoder.onnx`: 200, 16,565,728 bytes
- `sw.js`: 200

## Device-only validation still required

The container cannot reproduce the exact Chrome/ARCore/WebXR/WebGPU implementation of the phone. The in-app semantic preflight remains the source of truth for the actual device provider, and Diagnostic ZIP records the provider attempts and flow transitions.
