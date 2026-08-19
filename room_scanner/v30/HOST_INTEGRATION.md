# Host integration checklist for the fixed-screen pin / IndexedDB regressions

The package can enforce correct anchor semantics, but the host application must route its visible calibration pin through the scene renderer rather than continuing to draw the old tap/reticle DOM marker.

1. Request the XR session with `anchors` and `hit-test` enabled. For calibration, prefer them as required features.
2. Create pins only with the current `XRHitTestResult.createAnchor()` path. If unavailable, disable calibration rather than drawing a fallback calibration pin.
3. Call `calibration.updateFrame({ frame, referenceSpace, viewerPose })` from every `XRSession.requestAnimationFrame` callback.
4. Instantiate `XRAnchorScenePinRenderer` and use the application's existing 3D scene/mesh factory. This is the canonical visible pin.
5. Remove/hide the old fixed DOM/tap marker used as the calibration pin. `CalibrationVerificationOverlay` is debug-only; when used, call `.bind(calibration)` so its projection is refreshed every frame.
6. On the phone, require status `tracking=XRAnchor`. If it shows `tracking=MANCANTE`, do not count any calibration pose.
7. Treat `worldlock=warning` / `worldlockwarning` as a hard integration failure: the viewer moved while the displayed/projection data remained stale.
8. Replace `indexedDB.open(DB_NAME, 2)` (or any fixed lower version) with `openIndexedDBVersionSafe()`. Preserve the host's existing monotonic `onUpgrade` migrations.

`examples/host-integration.js` shows the complete wiring with extensive debug comments.
