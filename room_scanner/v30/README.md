# WebXR calibration patch: real 3D pins + verification + persistence

This package is a dependency-free, offline-capable patch layer for an existing WebXR calibration flow.

## What changes

1. **Calibration pins are real `XRAnchor`s.** A pin is created only from `XRHitTestResult.createAnchor()`; copying the reticle matrix is intentionally rejected.
2. **Per-frame pin state comes from WebXR tracking.** The manager checks `frame.trackedAnchors`, reads `frame.getPose(anchor.anchorSpace, referenceSpace)`, and projects each pin through the current `XRView` matrices.
3. **The 3x3 rule is real.** A calibration pose is eligible only when at least 3 tracked anchors are inside the camera frustum. Three sufficiently different eligible camera poses are required.
4. **Calibration can be verified.** Restored anchors are checked using pairwise 3D distance consistency, a rigid saved-reference -> current-reference fit, and (with >=4 pins) leave-one-out cross-validation. Their current projected positions are exposed for a visual overlay.
5. **Calibration can be improved.** Capture additional valid poses and re-run the existing solver on the enlarged observation set; `manager.improve()` passes the previous solution as initialization/context.
6. **Calibration is persistent.** Profiles are stored locally and can be exported/imported as JSON.
7. **Native persistent anchors are used when available.** Each pin requests a persistent handle; a later XR session restores it with `session.restorePersistentAnchor()`.

## Critical session setup

Ask for both hit-test and anchors. Keep them optional if the app must still start on devices without anchor support, but calibration must then be disabled rather than silently falling back to fake pins.

```js
const session = await navigator.xr.requestSession("immersive-ar", {
  requiredFeatures: ["hit-test", "anchors"],
  optionalFeatures: ["local-floor"],
});
```

Because calibration explicitly requires real `XRAnchor`s, requesting `anchors` as a required feature is the safest mode. If the application intentionally keeps it optional so non-calibration AR can still start, the calibration UI must remain disabled unless anchor creation is actually available.

## Minimal integration

```js
import {
  WebXRCalibrationManager,
  CalibrationVerificationOverlay,
  XRAnchorScenePinRenderer,
  openIndexedDBVersionSafe,
} from "./src/index.js";

const calibration = new WebXRCalibrationManager({
  minPinsPerPose: 3,
  minCalibrationPoses: 3,

  // Keep your existing numerical solver. It now receives correct observations:
  // poses[*].visiblePins[*].position is the actual XRAnchor 3D position and
  // projections contain the pin location in the current XR camera view.
  solveCalibration: async ({ mode, previousCalibration, poses, pins }) => {
    return existingCalibrationSolver({ mode, previousCalibration, poses, pins });
  },

  // Optional: reject a refinement if your reprojection/validation score worsens.
  validateCalibration: async ({ candidate, previousCalibration, poses }) => {
    const metrics = existingCalibrationValidator(candidate, poses);
    return {
      accepted: metrics.reprojectionRmsePx < 3.0,
      score: metrics.reprojectionRmsePx,
      details: metrics,
    };
  },
});

// DEBUG ONLY: screen-space projection of the live anchors.
const overlay = new CalibrationVerificationOverlay(document.body);
overlay.bind(calibration).show();

// CANONICAL PIN VISUAL: a real scene object whose world matrix is updated from
// XRAnchor.anchorSpace every XR frame. This example assumes Three.js-like
// Object3D instances are already bundled by the application.
const pinSceneRenderer = new XRAnchorScenePinRenderer(calibration, {
  scene,
  createObject: ({ pinId }) => createCalibrationPinMesh(pinId),
});
```

### When the user places a pin

Use the actual hit-test result from the current frame:

```js
await calibration.addPinFromHitTest({
  hitResult: hitTestResults[0],
  frame,
  referenceSpace,
  label: `P${pinIndex + 1}`,
});
```

Do **not** create the calibration pin from `reticle.matrix`, a Three.js Object3D pose, or a cached hit-test matrix.

### Every XR animation frame

```js
const viewerPose = frame.getViewerPose(referenceSpace);
if (viewerPose) {
  // This single call updates authoritative XRAnchor poses. The scene renderer
  // and bound debug overlay receive the synchronous frameupdate event and refresh
  // from this exact frame; do not cache placement-time screen coordinates.
  calibration.updateFrame({ frame, referenceSpace, viewerPose });
}
```

### Why the pin no longer stays fixed on the screen

There are now two intentionally separate visual paths:

- `XRAnchorScenePinRenderer`: the real calibration pin. It reads only the live 4x4 anchor pose matrix and applies it to a scene object. It never consumes `u`, `v`, CSS `left`, or CSS `top`. If tracking is lost, the object is hidden immediately.
- `CalibrationVerificationOverlay`: a diagnostic DOM layer. It remains `position: fixed` by design, but `bind(calibration)` recomputes its `left/top` from the current `XRView` on every XR frame. It must never be treated as the world object.

For a Three.js-style object the renderer sets `matrixAutoUpdate = false`; otherwise the engine could overwrite the anchor matrix on the next render pass. The reference space passed to `calibration.updateFrame()` must also be the reference space represented by the scene. If your engine has an extra world-root transform, pass it as `sceneFromReferenceMatrix`.

The manager defaults to `requireTrackedAnchors: true`. If `frame.trackedAnchors` is absent, calibration reports zero real tracked pins instead of silently accepting `getPose()` as a compatibility fallback.

### Capture a calibration pose

```js
const capture = calibration.captureCalibrationPose();
if (!capture.accepted) {
  console.log("Pose rejected:", capture.reason);
} else {
  console.log(calibration.getCoverageReport());
}
```

`getCoverageReport().ready` becomes true only after 3 distinct poses, each with 3 real tracked+visible pins.

### Initial solve and improvement

```js
if (calibration.getCoverageReport().ready) {
  await calibration.solve();
}

// Later, while calibrated, the user moves to another useful viewpoint:
const refinementPose = calibration.captureCalibrationPose({ tag: "refinement" });
if (refinementPose.accepted) {
  await calibration.improve();
}
```

A recommended validator should compare reprojection error on verification observations and only accept the refined result when it improves or stays within tolerance.

### Save and restore without recalibrating every time

At the end of calibration:

```js
calibration.saveProfile("my-room");
```

At app startup, before the XR session:

```js
const saved = calibration.loadProfile("my-room");
```

After creating the new XR session:

```js
if (saved) {
  const restore = await calibration.restorePersistentAnchors(session);
  console.log("Restored pin anchors:", restore);
}
```

Then call `updateFrame()` every frame. The manager automatically listens to the active `XRReferenceSpace` for `reset`; a reset invalidates mixed-space pose collection and forces a new anchor-based alignment before an existing calibration can be trusted. Once at least 3 restored pins are visible:

```js
const verification = calibration.verifyCurrentFrame();
if (verification.ok) {
  // The saved XR reference frame has now been related to this session.
  // Use getCurrentSessionCalibration() rather than reading calibration directly.
} else {
  // Keep the calibration loaded but do not trust it yet.
}
```

### Export / import

```js
calibration.downloadProfile("my-room");

// <input type="file" accept="application/json">
await calibration.importProfile(file, { saveAs: "my-room" });
```

Important: native persistent-anchor handles are origin/device/browser state. Importing the JSON elsewhere still restores the calibration numbers and observations, but the XR runtime may not recognize those handles. In that case the pins must be rebound/relocalized; the library never treats the old serialized matrices as live anchors.

## IndexedDB version-safe startup

If the host application has previously created an IndexedDB database at version 3, opening the same database with `indexedDB.open(name, 2)` fails with `VersionError`. Replace fixed-version startup with the helper below:

```js
const { db, version, newerThanTarget } = await openIndexedDBVersionSafe({
  name: "YOUR_EXISTING_DB_NAME",
  targetVersion: 2, // the schema this build knows how to create/migrate up to
  onUpgrade: ({ db, oldVersion }) => {
    // Keep the application's existing monotonic migrations here.
    if (oldVersion < 1) { /* create v1 stores */ }
    if (oldVersion < 2) { /* apply v2 migration */ }
  },
});

console.debug("IndexedDB opened", { version, newerThanTarget });
```

The helper first calls `indexedDB.open(name)` without an explicit version. Therefore an already-installed v3 database is opened as v3 rather than being downgraded or rejected. It requests `targetVersion` only if the existing database is older.

## Suggested UI states

- `empty`: no calibration.
- `collecting`: pin/pose collection.
- `calibrated`: solution exists in current session.
- `loaded-needs-anchor-restore`: saved solution loaded before XR anchor restoration.
- `loaded-needs-verification`: anchors restored; user must move until >=3 are visible.
- `verified`: restored anchor geometry is consistent.
- `verification-failed`: saved calibration must be refined/recalibrated or pins rebound.

Useful buttons after calibration:

- **Verifica**: turns on projected pin overlay and runs `verifyCurrentFrame()` when >=3 pins are visible.
- **Migliora**: captures another eligible pose and runs `improve()`.
- **Salva**: `saveProfile()`.
- **Esporta**: `downloadProfile()`.
- **Carica**: `loadProfile()` then `restorePersistentAnchors(session)`.
- **Importa**: `importProfile(file)` then restore/verify.

## Debugging guarantees

Use `manager.getStatus()` and `manager.getFramePinState()` to inspect why calibration is blocked. Each pin reports separately:

- `anchored`: a runtime XRAnchor object exists;
- `tracked`: it appears in `frame.trackedAnchors` (when exposed);
- `locatable`: `frame.getPose(anchor.anchorSpace, referenceSpace)` succeeded;
- `visible`: its 3D position is in the current XRView frustum;
- `projections`: normalized image coordinates and the rejection reason if outside the frustum.

`getStatus().frame.worldLockDiagnostic` also reports whether the viewer moved while the current projected anchor locations remained suspiciously unchanged. A `worldlockwarning` event is emitted for that integration failure. `getStatus().frame.realAnchorTrackingAvailable` tells you whether `XRFrame.trackedAnchors` was actually present.

This makes a false 3x3 readiness condition directly diagnosable.

## Cross-session/reference-space safety (schema v5)

A loaded profile is deliberately split into two observation sets:

- `savedCalibrationPoses`: observations belonging to the XR reference frame in which the saved solution was computed;
- `calibrationPoses`: only observations captured in the current XR reference frame.

This prevents a subtle but severe refinement bug where old-session and current-session XYZ coordinates are mixed in one solve. A loaded/ref-reset calibration cannot be refined until anchor verification has recovered `savedReferenceToCurrentReferenceMatrix`. The solver callback receives that matrix and a `previousCalibrationRequiresRebase` flag. If the project calibration contains reference/world-space transforms, provide `rebaseCalibration`; intrinsics-only payloads may be reference-invariant.

`XRReferenceSpace` reset events are handled automatically after the first `updateFrame()` for that space. Current pose collection is cleared; the existing calibration and canonical saved anchor snapshot remain available for re-verification.

## Full debug suite

Run:

```sh
npm run debug
```

It performs syntax compilation checks, deterministic unit/integration tests, a 120-frame world-lock replay (fixed 3D anchors + moving camera), randomized rigid-alignment/frustum stress tests, public TUM RGB-D trajectory/intrinsic checks, and FFmpeg encode/decode validation of a small replay generated from the official TUM Freiburg1 RGB preview.

`npm run test:browser` is provided as an optional real-Chromium DOM harness. Some minimal containers cannot start Chromium because DBus/zygote services are missing; this does not affect the deterministic Node UI tests. A physical WebXR/ARCore device is still required to validate the browser/device implementation of native anchors, persistence and tracking stability. See `DEBUG_REPORT.md` for the exact results from this package build.
