# v9.5.1 Hotfix5W2 - ONNX Runtime metadata contract

## Root cause fixed
Hotfix5W read `InferenceSession.inputMetadata` as a name-keyed object. ONNX Runtime JS exposes metadata as an array of `ValueMetadata`, and tensor dimensions are available in `shape` (with compatibility fallbacks retained for older wrappers). As a result the static MobileSAM browser encoder shape `[684,1024,3]` was not detected. The 96x64 smoke image was resized by the dynamic fallback to approximately `[683,1024,3]`, producing `OrtRun error code = 2 / INVALID_ARGUMENT` before the decoder ran.

## Changes
- Added `ortSessionMeta`, `ortMetaShape`, and `ortMetaSummary` compatibility helpers.
- MobileSAM encoder planning now honors exact static ONNX input shapes.
- Browser encoder now receives exactly `684x1024x3` when that shape is declared.
- NCHW exports continue to use their declared static shape and ImageNet normalization.
- Smoke-test errors now identify `ENCODER OrtRun` vs `DECODER OrtRun` and report expected/actual dimensions.
- Preserved warm preload behavior and non-blocking camera UI from Hotfix5W.
- Deploy/cache revision bumped to `951h5w2`.
