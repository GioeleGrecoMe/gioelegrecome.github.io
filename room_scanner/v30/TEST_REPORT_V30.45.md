# V30.45 Test Report

Build: `v30.45.0-20260822-async-rgb-alva-late-deep`

## Executed tests

### New asynchronous-lane regression suite

`node --test tests/v30-45-async-deep-lane.test.mjs`

Result: **9/9 PASS**.

Covered cases:

1. exact-frame queue deduplication;
2. survey -> keyframe upgrade on the same `frameId`;
3. queue-full behavior never evicts an already depth-planned frame;
4. keyframe priority during post-scan drain;
5. MVS dispatch is independent of Deep result;
6. default configuration performs no neural inference during Scan and does not force Deep on every dense keyframe;
7. RGB is registered/planned before late depth attachment;
8. late Deep cannot metric-calibrate against capture-time sparse seeds; fast-lane diagnostics are present;
9. the ONNX worker is released during acquisition and recreated only for the post-scan drain.

### V30.44 RGB pose-scaffold regressions + V30.45 lane regressions

`node --test tests/v30-44-rgb-pose-scaffold-regressions.test.mjs tests/v30-45-async-deep-lane.test.mjs`

Result: **17/17 PASS**.

This verifies that the scheduling change preserves the sign-invariant RGB translation-line estimator, robust epipolar outlier handling, RGB pose-scaffold gating, and dense-surface authorization logic introduced in V30.44.

### Build identity

The V30.45 build identity subtest passes:

- `CONFIG/BUILD = 30.45.0`
- `build_info.json = 30.45.0`
- HTML badge = V30.45
- service worker shell identity = V30.45

### Layout

`node tools/check_v30_layout.mjs`

Result: **PASS**.

### UI boot smoke test

`node tools/mock_ui_boot.mjs` was executed with temporary test-only stubs for unchanged base modules absent from the incremental archive (`logger.js` and `xr/xr_calibration.js`).

Result: **PASS** — controls bind, WebXR failure returns to Home, and measurement start reaches the camera path without a legacy optimizer ReferenceError.

The temporary stubs were deleted immediately after the test and are **not** included in the patch.

### Syntax

Every modified/new `.js` / `.mjs` file passes `node --check`.

## Repository-wide limitations

The supplied V30.44 source is an incremental patch and does not contain all unchanged base files (`js/slam/math.js`, `logger.js`, `styles.css`, `js/xr/xr_calibration.js`, etc.). Tests that directly import/read those unchanged files cannot be executed from this standalone patch tree. They are not reported as product regressions and are not replaced with production stubs.

No optimizer mathematics from V30.44 was loosened in V30.45; the new code path is isolated to acquisition scheduling, exact-frame queueing, late Depth binding, diagnostics, and version/cache surfaces.

## Expected phone behavior

During active Scan:

- `deep.calls` should remain `0` with default settings;
- `fastLane.deepInferenceDuringScan` should remain `false`;
- `mvs-fastlane-dispatch` may continue while Deep queue size grows;
- photo/factor registration should happen at `depthPlanned` time rather than Depth completion time when the live-map base exposes a planned-frame API.

After Finish:

- camera/Alva stop first;
- `deep-postscan-drain-start` appears;
- queued jobs are processed sequentially, keyframes first;
- each result must pass exact `frameId`/signature synchronization;
- raw Depth is attached to the pre-existing frame;
- no capture-time metric Deep calibration is performed;
- final metric calibration remains the responsibility of `ProbabilisticJointOptimizer`.

## Full standalone patch-tree suite

`npm test`

Result: **19/27 PASS, 8/27 unavailable from the incremental tree**.

All V30.45 asynchronous-lane assertions pass. The eight non-passing entries are confined to historical/base-tree tests that require unchanged resources omitted by the supplied V30.44 incremental patch:

- 3 XR/calibration contract cases require `js/xr/xr_calibration.js`;
- 1 calibration/layout contract reads the absent base `styles.css`;
- 2 single-optimizer closure/root cases require unchanged modules outside the incremental archive;
- `tests/v30-42-rgb-submap-regressions.test.mjs` requires `js/slam/math.js`;
- `tests/v30-44-alva-translation-authority.test.mjs` requires `js/slam/math.js`.

No temporary test stub is present in the deliverable. The raw standalone test summary was `27 tests / 19 pass / 8 fail`; these eight are classified here as **base-tree unavailable**, not as V30.45 product PASSes.
