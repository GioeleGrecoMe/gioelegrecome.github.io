# WebXR calibration patch — debug verification report

Build: package `webxr-calibration-patch` 1.1.0, profile schema v5.

## Bugs found and corrected during verification

1. **Stale `XRFrame` after asynchronous anchor creation.** The old implementation awaited `XRHitTestResult.createAnchor()` and then queried the old frame. The fixed code never calls `frame.getPose()` after that `await`; the first authoritative anchor pose is acquired only by `updateFrame()` from a later active XR animation frame.
2. **Insufficient cross-session validation.** Matching only pairwise pin distances cannot recover the new session reference frame. The manager now estimates the full rigid saved-reference -> current-reference transform from restored anchors and exposes it to the consumer/rebase callback.
3. **`XRReferenceSpace.reset` mixing.** Poses captured before and after a reference-space discontinuity are no longer mixed. The manager automatically observes the active reference space; on reset it clears current pose collection and requires re-verification of an existing calibration.
4. **Loaded-profile refinement mixing old and new XYZ.** Saved calibration observations are kept separately from current-session observations. Refinement requires a verified old->current alignment first.
5. **Single bad anchor partially hidden by least-squares.** With >=4 common pins, alignment now includes leave-one-out prediction in addition to all-point RMSE, max residual and pairwise geometry checks.
6. **NaN/Infinity propagation.** Non-finite 3D correspondences and invalid view matrices/points are rejected instead of producing a nominally successful transform containing NaNs.

## Deterministic compiler/tests

Environment used for this report:

- Node.js 22.16.0
- npm 10.9.2
- Chromium 144.0.7559.96 (binary present; see browser limitation below)
- FFmpeg 7.1.5

`npm run debug` completed with exit code 0.

- JavaScript syntax compilation: PASS for every file under `src/`.
- Node unit/integration suite: **28/28 PASS**.
- Real-anchor eligibility: fake reticle rejected; `trackedAnchors` loss immediately removes pin visibility.
- 3 poses x 3 real visible pins: PASS.
- Duplicate-pose gate: PASS.
- Persistent-anchor restore/missing/error paths: PASS.
- Cross-session reference alignment/rebase handoff: PASS.
- Loaded calibration blocked before verification: PASS.
- Reference-space reset invalidation: PASS.
- v3 -> v5 storage migration: PASS.
- UI verification overlay and Save/Load/Verify/Improve wiring with a deterministic DOM stub: PASS.

## Randomized geometry stress test

Deterministic seed: `0x5eedc0de`.

- Exact random rigid transforms: **2000 cases**, maximum fit RMSE `1.6574518010108025e-14 m`.
- Added Gaussian coordinate noise: sigma `0.003 m`.
  - median fit RMSE `0.0039305130 m`
  - p95 fit RMSE `0.0055861143 m`
  - maximum fit RMSE `0.0067888273 m`
- Deliberate single-anchor displacement: **500 cases**, 8–18 cm corruption.
  - all-point alignment checks alone rejected 486/500; this exposed why plain least-squares is insufficient.
  - full verification (geometry + alignment + leave-one-out) rejected **500/500**.
- Near-collinear anchor configurations: **100/100 rejected**.
- Projection/frustum property checks: **20,000/20,000 PASS**.

Machine-readable numbers are in `test/debug-stress-report.json`.

## Public online data/media verification

The external fixture is from the Technical University of Munich RGB-D SLAM Dataset and Benchmark (CC BY 4.0 unless otherwise noted by the dataset).

Used checks:

- `freiburg1_rpy`: real public ground-truth quaternion/translation excerpt drives the pose-diversity test; it produces >=3 valid distinct rotational calibration poses.
- Freiburg1 RGB published intrinsics (`fx=517.3`, `fy=516.5`, `cx=318.6`, `cy=255.3` at 640x480): WebXR-style projection agrees with the direct pinhole pixel formula to floating-point precision.
- Official `freiburg1_xyz` RGB preview: downloaded and verified as a 640x480 RGB PNG.
- A 2 s / 30 fps / 640x480 H.264 debug replay is generated locally from that official frame and decoded fully by FFmpeg: PASS.

Attribution and source URLs are in `test/online-data/SOURCES.md`.

## Browser/device limitation

The optional `npm run test:browser` harness was attempted. In this execution container Chromium itself fails to complete even a trivial headless page because the minimal environment lacks working DBus/zygote services; the harness exits 2 with `BROWSER-HARNESS-UNAVAILABLE`. This is an environment failure, not a WebXR assertion failure, and `browser-debug.log` is included.

No container can truthfully replace the final physical-device check for ARCore/WebXR native anchor stability, persistent-anchor behavior across browser restarts, camera permission/lifecycle, thermal throttling, or real tracking relocalization. The package therefore includes `test/browser/browser-harness.html` and the browser script for a normal desktop/browser environment, while the native WebXR path should ultimately be exercised on the target phone.

## Commands

```sh
npm run debug
npm run test:stress
npm run test:media
npm run test:browser   # optional; requires a functioning Chromium environment
```
