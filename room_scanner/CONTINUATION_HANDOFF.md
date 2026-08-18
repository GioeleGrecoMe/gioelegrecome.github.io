# Continuation Handoff - V20.2.1

## Baseline

Canonical entry: `room_scanner_v12.html`

Build: `v20.2.1-20260818-xr-passthrough-depth-fix`

## Non-negotiable architecture

- Capture data is append-only and binary-first.
- WebXR exit performs no processing, export, reload or navigation.
- The page remains usable after XR ends.
- Processing is explicit, restartable and isolated in a worker/page.
- The RAW archive is the durable interchange format.
- Walk-only capture is the default; walls are inferred later.
- Adaptive cells guide quality but never hard-block completion.
- WebXR owns scale inside a segment.
- Cross-segment fitting uses validated markpoints and no scale parameter.
- Deep is optional post-XR densification, not metric authority.
- All surfaces and objects retain stable IDs for later acoustic evidence.

## Highest-value next tests

1. Reproduce XR exit ten times on at least three Android devices and retain diagnostics/crash IDs.
2. Compare wall thickness and metric error against taped room dimensions.
3. Validate markpoint registration after real ARCore relocalization loss.
4. Tune adaptive cell thresholds using object scans with glossy, dark and textureless surfaces.
5. Characterize speaker/microphone processing and chirp SNR across phone models.
6. Add a desktop high-quality reconstruction backend that consumes exactly the same `.rscan.zip` without changing capture code.

## Known limitations

- Raw camera and CPU depth availability vary by device/browser.
- A single-phone monostatic chirp cannot provide a trustworthy absolute system delay without calibration; relative arrivals are used.
- Dynamic objects can create inconsistent surfels and markpoint failures.
- Monocular depth is only as metric as its per-frame anchors.
- The lightweight processor favors acoustic geometry and diagnostics over photorealistic meshing.
