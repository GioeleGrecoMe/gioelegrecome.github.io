# Deploy Hotfix5W4

Build expected in the page badge:

`v9.5.1-hotfix5w4-object-ui-fullscreen-viewer`

Deploy revision:

`951h5w4`

## Upgrade over an existing GitHub Pages folder

Extract this package **over** the current `room_scanner_v9_2_4_guided_seed/`
folder. Do not delete `models/` or `vendor/` first if the ONNX/WASM binaries are
already installed there; this source archive intentionally does not duplicate
those large binaries.

Run before publishing:

```bash
python3 tools/fetch_mobilesam_models.py
python3 tools/fetch_onnxruntime_web.py
python3 tools/fetch_depth_anything.py
python3 tools/fetch_depthai_runtime.py
python3 tools/check_deploy_bundle.py
```

For a fully self-contained deployment the final command should report
`FULL_LOCAL_READY=yes`. The application shell itself can still use its documented
remote fallbacks when local neural assets are absent.

After publish, reload until the build badge shows H5W4. H5W4 uses new cache names
and network-first navigation so old H5W3 HTML should not remain authoritative.

## Phone smoke test

1. Complete acoustic calibration.
2. Start AR and build a short metric map.
3. Enter Objects: tap an object in the camera image; the reticle must move to the
   tapped point. With local depth, `Segmenta qui` must become enabled.
4. Confirm the mask, move around the object, collect independent views and
   finalize the compact proxy.
5. Run/finish measurement. Stage 5 should open automatically as a full-screen
   Gaussian preview with only the gear button visible by default.
6. With MobileSAM and DepthAI disabled, Stage 5 must still show the WebXR-derived
   visual Gaussian/surfel reconstruction.
