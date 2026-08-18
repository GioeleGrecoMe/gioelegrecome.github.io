# V20.4.2 Test Report

## Scope

Patch only changes capture visualization and processing preview:

- adaptive coverage overlay: point splats + sparse adjacency mesh;
- processing preview: local WebGL orbit viewer with CPU fallback;
- no XR capture/depth/database/worker/config changes.

## Automated checks

PASS `node --check`:

- `js/grid_v20_2_0.js`
- `js/model_preview_v20_4_2.js`
- `js/processing_ui_v20_2_0.js`

PASS legacy behavior suite:

- point batch roundtrip
- adaptive grid quality
- markpoint validation
- registration without scale
- floor/ceiling/wall structural fit
- plane-aware decimation
- RGB object/acoustic faces
- rapid ESS contract
- relative RIR latency handling
- stored ZIP contract
- safe handoff/raw-first contract
- adaptive grid/no mandatory wall marking
- isolated processing page

PASS dense preview data test with 250,000 synthetic surfels. The viewer bounded the rendered subset without using `push(...largeArray)` and produced finite auto-fit bounds.

## Browser note

A headless Chromium screenshot could not be completed in the container because the local Chromium GPU/DBus/zygote setup timed out. Therefore no visual-browser PASS is claimed here. The viewer has an explicit CPU canvas fallback when WebGL cannot be created.
