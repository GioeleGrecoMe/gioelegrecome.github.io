# Room Scanner v9.5.1 Hotfix5W — verification report

Build: `v9.5.1-hotfix5w2-ort-metadata`  
Deploy revision: `951h5w2`

## Root causes addressed

- Hotfix4 semantic preflight forcibly called `ensureMobileSamSemantic(true)`, so
  a successful `Precarica AI` was discarded and encoder/decoder sessions were
  recreated when entering Step 3.
- Earlier fetch/config revisions could store a PulpCut encoder under the same
  local filename while using the HWC/raw255 tensor contract of the
  MobileSAM-in-the-Browser export.
- Mixed HTML/service-worker revisions could leave a phone executing a cached
  page different from the server page.
- Strict final pruning could make Stage 5 visually empty even though WebXR had
  measured a provisional Gaussian field; the Hotfix4 visual-only fallback is
  retained.

## Hotfix5W changes verified

- Warm semantic preload is reused; ordinary Map -> Objects flow has no forced
  semantic reset.
- Explicit Retry is the only normal path that passes `force:true`.
- Compact `#aiMiniProgress` is pointer-transparent; MobileSAM does not use the
  full-screen processing overlay.
- Encoder metadata selects HWC/NHWC/NCHW and raw255 vs ImageNet preprocessing.
- Complete encoder/decoder candidates are smoke-tested as pairs.
- Preferred fetch bundle is MobileSAM-in-the-Browser; previous PulpCut export is
  retained only as a compatibility candidate.
- Semantic sessions are released before scientific measurement.
- Stage-5 WebXR visual Gaussian fallback remains isolated from strict solver
  geometry.
- Service worker and HTML use revision `951h5w2`, network-first/no-store for
  navigation and neural assets.

## Automated suite

`sh tests/run_current_suite.sh` -> PASS.

Highlights:

- mapping probability/pruning tests: PASS
- semantic/structural tests: PASS
- bootstrap (`pumpSemanticQueue`, mic, speaker): PASS
- Step-3 failure/retry UI: PASS
- Stage-5 single WebGL renderer + rollback: PASS
- Depth Anything metric alignment direct/inverse + bad-frame rejection: PASS
- WebXR display Gaussian fallback: PASS
- deploy-integrity test: PASS
- Hotfix5W warm-AI regression test: PASS
- DOM IDs: 282
- DOM references: 255
- handler targets: 100
- named functions: 631
- duplicate functions: 0
- JavaScript syntax (`room_scanner_v9.html`, `depth_ai_worker.js`, `sw.js`): PASS

## Sandbox limitation

The verification environment cannot execute a real smartphone WebXR session and
this generated archive does not contain the large ONNX/WASM payloads. Therefore
actual on-device inference latency and mask quality are not claimed as tested in
this report. The release compensates by performing a real encoder -> decoder
smoke inference in the browser before declaring MobileSAM ready and by exporting
encoder variant/layout/preprocessing/decoder diagnostics.

`tools/check_deploy_bundle.py` intentionally returns `FULL_LOCAL_READY=no` in the
sandbox archive until the fetch scripts are run or the archive is overlaid on
the existing deployment containing the neural binaries.
