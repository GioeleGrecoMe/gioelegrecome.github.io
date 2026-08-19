# V30.7 Internal Test Report

Automated tests cover:

- JS syntax for all runtime modules/workers;
- strict standalone contract (no V20 runtime path, no Deep/IMU runtime modules);
- DOM/bootstrap ID contract;
- portrait/landscape analysis sizing;
- actual WASM FAST/BRIEF execution and portrait frame;
- metric ray triangulation;
- WebXR -> V30 coordinate/intrinsics conversion;
- visual calibration-template reacquisition;
- camera-only synthetic MVS with known stereo baseline/depth;
- PLY and R30 round trips;
- HTTP availability and WASM MIME;
- JSON manifest/build metadata.

See `TEST_RUN_FINAL.txt` for the exact final run.

WebXR hardware calibration itself requires a real supported Android/Chromium/ARCore device and is therefore explicitly not claimed as container-validated.
