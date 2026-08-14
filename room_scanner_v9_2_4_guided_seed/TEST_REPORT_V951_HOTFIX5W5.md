# Test report — Room Scanner v9.5.1 Hotfix5W5

Build: `v9.5.1-hotfix5w5-cooperative-xr-ai`  
Deploy revision: `951h5w5`

## Result

- Full historical + H5W5 regression suite: **PASS**
- JavaScript module syntax: **PASS**
- DepthAI worker syntax/shape tests: **PASS**
- MobileSAM encoder/decoder contract regressions: **PASS**
- Cooperative XR/AI scheduler regression: **PASS**
- WebXR-only Gaussian/fullscreen Twin regressions: **PASS**
- Audio/microphone/speaker bootstrap regressions: **PASS**

## Static integrity

- DOM IDs: 283
- simple DOM references: 669
- UI handler targets: 101
- named functions: 654
- duplicate named functions: 0 (`none`)

## Cooperative invariants verified

1. XR render/pose callback does not await MobileSAM or DepthAI.
2. Expensive XR geometry fusion is gated by `cooperativeGeometryPeriodMs=100` (10 Hz).
3. Object mode keeps Gaussian + primary surface preview visible.
4. A tap freezes one exact RGB-D map frame and protects it from bitmap/ring eviction.
5. MobileSAM uses the frozen RGB image; mask geometry is derived afterwards from synchronized XR depth.
6. MobileSAM ORT WASM proxy worker is enabled when Web Worker is available.
7. SAM and DepthAI share an AI mutex; explicit SAM actions have priority.
8. DepthAI uses a cumulative keyframe counter and can run periodically for the entire scan.
9. DepthAI runs in its worker, is rejected when XR metric alignment is poor, and adds low-weight detail surfels only.
10. Remaining unprocessed DepthAI keyframes are still handled in Stage 5.
11. Primary surfaces are a live visual layer; strict acoustic solver geometry remains separate.

## Binary asset note

The build environment could not download external `application/octet-stream`/model assets and has no direct network resolution for the fetch scripts. Therefore this tar contains the corrected application, tests and fetch/deploy tools, but **not** the large ONNX/WASM binaries. Deploy it over the site's existing `models/` and `vendor/` folders, or run the included fetch scripts in a networked local checkout. See `DEPLOY_ASSET_STATUS_H5W5.txt`.
