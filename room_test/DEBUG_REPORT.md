# WebXR calibration patch — debug verification report

Build: package `webxr-calibration-patch` 1.2.0, profile schema v5.

## User-reported failures addressed in 1.2.0

1. **Pins looked fixed to the screen instead of fixed to the room.** The old package exposed a CSS `position: fixed` verification overlay and did not include a canonical scene-object binder. The overlay was therefore easy to mistake for the actual pin visualization. Version 1.2.0 adds `XRAnchorScenePinRenderer`, which consumes only the live 4x4 `XRAnchor` pose from `frame.getPose(anchor.anchorSpace, referenceSpace)` and applies it to the renderable scene object on every manager `frameupdate`. It never reads screen `u/v` coordinates.
2. **The DOM overlay could be stale if the host only refreshed it at placement/verification time.** `CalibrationVerificationOverlay.bind(manager)` now refreshes the debug projection synchronously on every `frameupdate`. The overlay remains explicitly debug-only.
3. **`getPose()` fallback could make a pin appear valid without authoritative anchor tracking.** Real calibration mode now defaults to `requireTrackedAnchors: true`. If `XRFrame.trackedAnchors` is absent, visible/eligible real-anchor count is zero. A compatibility fallback exists only when explicitly opted in.
4. **No automatic detector for the exact fixed-screen integration bug.** The manager now compares camera motion with successive live anchor projections and emits `worldlockwarning` when the reported viewer moves but common anchor projections remain suspiciously static.
5. **IndexedDB startup failed after a newer DB had already been created.** The reported error (`requested version 2` while the installed DB is version `3`) is handled by `openIndexedDBVersionSafe()`. It probes with `indexedDB.open(name)` first, never requests a lower version, upgrades only when the existing DB is older, and recovers from an inter-tab version race.
6. **Three.js-style renderables could overwrite a manually assigned anchor matrix.** The default scene adapter sets `matrixAutoUpdate = false`, applies the current anchor matrix with `matrix.fromArray()`, and marks `matrixWorldNeedsUpdate = true`.

## Existing correctness fixes retained

- No stale `XRFrame` query after asynchronous `XRHitTestResult.createAnchor()`.
- Cross-session rigid saved-reference -> current-reference alignment from restored anchors.
- `XRReferenceSpace.reset` invalidation and separation of pre/post-reset observations.
- Loaded-profile observations are kept separate from current-session refinement observations.
- >=4-pin leave-one-out validation catches a single drifting restored anchor.
- NaN/Infinity and degenerate anchor geometry are rejected.

## Deterministic compiler/tests

`npm run debug` completed with exit code **0**.

- JavaScript syntax compilation: PASS for every source module, including the new scene renderer and IndexedDB helper.
- Node unit/integration suite: **39/39 PASS**.
- Exact IndexedDB regression `existing v3 / target v2`: PASS; the fake factory records only an unversioned open, never `open(name, 2)`.
- IndexedDB normal upgrade `v1 -> v3`: PASS.
- IndexedDB version-race recovery: PASS.
- `trackedAnchors` strict-authority regression: PASS; no `getPose()` call is made when authoritative tracking is unavailable.
- Scene renderer uses anchor 4x4 matrix and ignores screen `u/v`: PASS.
- Scene object hides immediately on anchor tracking loss: PASS.
- Optional reference-space -> scene-space matrix composition: PASS.
- Bound debug overlay changes CSS position on every `frameupdate`: PASS.
- Stale-XRView/fixed-screen watchdog: PASS and emits one warning in the deliberately broken test.
- Correct moving-XRView case: PASS with no false warning.
- 3 poses x 3 real visible tracked pins: PASS.
- Persistence/restore/reference-space reset/refinement gates: PASS.

## 120-frame world-lock replay

`npm run test:worldlock` simulates a camera moving laterally by 0.6 m in front of three real tracked anchor mocks at about 2 m distance. For all 120 frames:

- 3/3 anchors remain in `trackedAnchors` and locatable.
- The scene-object world transform is exactly the live anchor world/reference transform.
- Measured scene anchor world drift: **0 m**.
- Each pin moves by approximately **0.15 normalized viewport width**, which is the expected projection change for this geometry/FOV.
- World-lock warnings in the correct replay: **0**.

This directly tests the required behavior: the anchor remains fixed in the XR world while its screen projection changes as the camera moves.

## Randomized geometry stress test

Deterministic seed: `0x5eedc0de`.

- Exact random rigid transforms: **2000 cases**, maximum fit RMSE `1.6574518010108025e-14 m`.
- Added Gaussian coordinate noise: sigma `0.003 m`.
  - median fit RMSE `0.0039305130 m`
  - p95 fit RMSE `0.0055861143 m`
  - maximum fit RMSE `0.0067888273 m`
- Deliberate single-anchor displacement: **500 cases**, 8–18 cm corruption.
  - all-point alignment alone rejected 486/500;
  - full verification rejected **500/500**.
- Near-collinear anchor configurations: **100/100 rejected**.
- Projection/frustum property checks: **20,000/20,000 PASS**.

Machine-readable numbers are in `test/debug-stress-report.json`.

## Public online data/media verification

The external fixture remains the Technical University of Munich RGB-D SLAM Dataset and Benchmark (CC BY 4.0 unless otherwise noted by the dataset).

- `freiburg1_rpy`: real ground-truth quaternion/translation excerpt drives pose-diversity checks.
- Freiburg1 RGB intrinsics (`fx=517.3`, `fy=516.5`, `cx=318.6`, `cy=255.3` at 640x480): WebXR-style projection agrees with the direct pinhole projection check.
- Official `freiburg1_xyz` RGB preview: 640x480 PNG fixture.
- Generated replay: H.264, 640x480, 30 fps, 2.0 s; full FFmpeg decode PASS.

Attribution/source information is in `test/online-data/SOURCES.md`.

## Browser/device limitation

The optional `npm run test:browser` harness was attempted again for this build. Chromium is present but the execution container cannot complete the headless page because the minimal Linux environment lacks working DBus/zygote services. The harness exits 2 with `BROWSER-HARNESS-UNAVAILABLE`; `browser-debug-v1.2.0.log` is included. This is an environment failure before a usable WebXR/browser assertion can execute.

A physical WebXR/ARCore device is still the authoritative final test for native anchor stability, hit-test attachment, tracking relocalization and persistent-anchor restore. The new on-device status fields make that test diagnostic rather than visual-only: inspect `tracking=XRAnchor` and `worldlock=ok/camera-static`; `tracking=MANCANTE` or `worldlock=warning` must block calibration.

## Commands

```sh
npm run debug
npm run test:worldlock
npm run test:stress
npm run test:media
npm run test:browser
```
