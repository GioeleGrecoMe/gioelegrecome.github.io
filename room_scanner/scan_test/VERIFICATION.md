# Scan Test v3.2.1 - verification record

Build: `scan-test-v3.2.1-continuous-native-depth-pipeline`

## Root causes corrected

1. **File-upload ordering race:** `startRecording()` now executes before `processUploadedVideo()`.
2. **Invalid frame stepping:** the uploaded-file path no longer resumes/pauses playback once per frame. It captures t=0 and then runs one continuous `requestVideoFrameCallback` chain with a single `play()` call.
3. **Aspect/orientation destruction:** Alva gets a full-frame aspect-preserving raster with 960 px long side; portrait remains portrait and widescreen remains widescreen.
4. **Tracker/archive coupling:** all unique decoded frames go to Alva while archive retention is independently rate/memory limited.
5. **Manual Depth tensor path removed:** the worker uses Transformers.js `depth-estimation`, Q4, WASM and the model's official `DPTImageProcessor`.
6. **Depth fail-closed:** provider/numerical/flip checks execute before frame assignment; one failed map clears the whole partial batch and disables preview/final geometry.

## Executed checks on delivered files

### JavaScript syntax

PASS:

```text
node --check app.js
node --check camera.js
node --check deep_depth_worker.js
```

### Application contract

Command:

```text
node tools/test_app_contract.mjs
```

PASS:

```json
{
  "build": "v3.2.1",
  "recordingBeforeDecode": true,
  "continuousRvfc": true,
  "t0FrameExplicit": true,
  "singlePlaySession": true,
  "alvaLongSide": 960,
  "deepAssignmentAfterGate": true,
  "deepPartialBatchClearedOnReject": true,
  "deepUiFailClosed": true
}
```

### AlvaAR browser path - landscape fixture

Command:

```text
python3 tools/test_alva_browser_path.py fixtures/alva_dynamic_regression.mp4 20 .25
```

Result:

```text
source       640x480
Alva raster  960x720
decoded      120
poses        94/120 (78.3%)
first pose   26
duplicates   0
last time    3.966667 s
median gap   0.033333 s
```

The first decoded times were `0, 0.033333, 0.066667, 0.1, 0.133333, ...`.

### AlvaAR browser path - portrait fixture

Command:

```text
python3 tools/test_alva_browser_path.py fixtures/alva_dynamic_portrait_regression.mp4 20 .25
```

Result:

```text
source       480x640
Alva raster  720x960
decoded      118
poses        94/118 (79.7%)
first pose   24
duplicates   0
last time    3.966667 s
```

This specifically guards against the previous portrait-to-landscape 4:3 conversion.

### AlvaAR browser path - independent hallway clip

Command:

```text
python3 tools/test_alva_browser_path.py fixtures/external_hallway_validation.mp4 1 .25
```

Result:

```text
source       480x270
Alva raster  960x540
decoded      50/50
poses        45/50 (90%)
first pose   5
duplicates   0
last time    7.84 s
median gap   0.16 s
```

This clip is independent of the synthetic regression fixture and is used only to verify initialization/data flow, not geometric accuracy.

### Depth contract / fail-closed regression

Command:

```text
node tools/test_depth_contract.mjs
```

PASS verifies:

- local Q4 SHA-256 `5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`;
- ONNX input `pixel_values`, float32, NCHW/dynamic H/W;
- ONNX output `predicted_depth`, float32;
- official `DPTImageProcessor` config: 518, keep-aspect-ratio, multiple of 14, bicubic, ImageNet normalization;
- Transformers.js `depth-estimation` path;
- WASM + Q4 only;
- no manual `InferenceSession.create` / hand-built `ort.Tensor` in the worker;
- mirrored-frame spatial validation;
- rejected depth is gated before `f.deep` assignment;
- a failed frame clears all already accepted maps in that Deep batch.

## Browser sandbox limitation for Deep

A numerical Transformers.js/ONNX Runtime WASM inference was not executable in this build environment because the hardened Chromium sandbox blocks localhost navigation and the runtime cannot fetch its CDN module/artifacts. Therefore no numerical Deep success is claimed here.

The delivered browser path is intentionally fail-closed: it cannot turn an unverified/random-looking output into geometry. The definitive runtime check on GitHub Pages is the explicit `Test Deep` preflight; only a WASM/Q4 result that also passes the mirrored-frame spatial check is accepted.

## Full-app localhost test limitation

`tools/test_app_file_video.py` was also attempted against the final directory, but hardened Chromium returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` for `http://127.0.0.1:<port>/index.html`. The lower-level browser regression still executes the same delivered `camera.js` and bundled `vendor/alva_ar.js`, including real `<input type=file>`, decoded video frames, `requestVideoFrameCallback` and `AlvaAR.findCameraPose()`.
