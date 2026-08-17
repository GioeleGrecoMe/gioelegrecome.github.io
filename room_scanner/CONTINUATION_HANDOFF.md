# Continuation handoff - Room Scanner V15.1.0

## Baseline

- Version: `15.1.0`
- Revision: `v15.1.0-wall-targets-recovery-20260817`
- Canonical deploy page: `room_scanner_v12.html`
- Target: Chrome Android, ARCore, HTTPS
- Architecture: one WebXR `local-floor` session for all connected rooms; post-XR Deep only

## Non-negotiable invariants

- Do not add a second camera stack (`getUserMedia`, `ImageCapture`, MediaStream, etc.).
- Keep exactly one Raw Camera `getCameraImage()` call site and invoke it only in an active XR frame path.
- Do not load/run ONNX while WebXR is active.
- Do not introduce ICP, TSDF, global mesh optimization, free room rotation or a second metric coordinate system.
- Do not let neural depth modify wall geometry.
- Keep `room_scanner_v12.html` as the canonical page unless all deploy references are deliberately migrated.
- Keep compatibility aliases byte-identical to the versioned executable files.

## Wall target implementation

Core functions in `roomscan_core_v15_1_0.js`:

- `createWallPhotoTargets(model, options)`
- `evaluatePhotoTarget(target, projection, worldToView, cameraPosition, options)`
- `photoTargetStatus(target)`
- `photoTargetProgress(target)`
- `registerPhotoTargetObservation(target, observation)`
- `registerFramePhotoTargets(targets, frame, options)`
- `photoTargetStats(targets)`

The app generates targets immediately after room height confirmation. IDs are prefixed with the room ID. Lower `objects` targets require two distinct `viewCluster` values; upper `surface` targets require one.

`coverageGuidance()` chooses the highest-priority unresolved physical target. `drawPhotoTargetBox()` projects its four metric corners into the overlay. `drawTargetArrow()` points toward its projected centre or toward the correct turn direction if off-screen.

`roomCompletionReadiness()` intentionally ignores unresolved target count as a hard gate. The hard minimum is three frames and two view clusters. Do not restore the old all-green deadlock.

## Back/recovery implementation

`armHistoryGuard()` adds one same-document history entry when XR starts. A guarded `popstate` calls `handleBrowserBack()`.

`saveAndCloseXR()`:

- blocks repeated exit actions;
- suspends automatic capture;
- invokes `settleCaptureBeforeExit()`;
- marks an unfinished measured room partial;
- persists a checkpoint;
- ends the existing XR session.

`onXREnd()` owns resource cleanup and opens Review. An unexpected XR end follows the same reviewable path and marks the scan interrupted.

IndexedDB:

- database: `room-scanner-v15-checkpoints`
- store: `snapshots`
- key: `latest`

Checkpoint object point arrays are capped at 12,000 points per object to avoid making a navigation save too large. Explicit RAW export retains the complete point data.

## Executable assets

- `roomscan_core_v15_1_0.js` == `roomscan_core.js`
- `roomscan_app_v15_1_0.js` == `roomscan_app.js`
- `depth_ai_worker_v15_1_0.js` == `depth_ai_worker.js`
- `sw_v15_1_0.js` == `sw.js`

After modifying one side, copy it to its alias and run `tests/run_all.sh`.

## Main tests

- `photo_targets.test.js`: physical subdivision, projection and status transitions.
- `coverage_guidance.test.js`: selected box, second-view instruction and completion with unresolved targets.
- `navigation_recovery.test.js`: Back path, single XR end and automatic Review.
- `checkpoint_recovery.test.js`: IndexedDB save and restoration of target/object state.
- `workflow_state.test.js`: two rooms and doorway linkage in one metric frame.
- `static_contract.test.js`: WebXR/camera/deploy invariants.

## Remaining device validation

No container test can validate actual Raw Camera Access, Android browser Back behavior inside a live immersive session, ARCore CPU depth quality, thermal throttling or ONNX memory pressure. Use `TEST_ON_PHONE.md` before calling a release hardware-validated.
