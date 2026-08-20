# Room Scanner V30.14.2

## Rendering/calibration recovery

- WebXR calibration no longer requires `camera-access` or `XRView.camera`. Hit-test, depth, world-locked XRAnchor placement and pin projection use the XR reference space, `XRView.projectionMatrix` and XR viewport. Raw camera texture is optional and only enriches visual templates.
- Added every static runtime host used by measurement guidance, metric surface HUD and mesh review.
- The static metric mesh button is now always bound, whether it was already present in HTML or dynamically created.
- AlvaAR is not prefetched/compiled during app boot or WebXR calibration. It loads on measurement start, preventing a multi-megabyte compile from contending with XR rendering.
- Scan overlay now draws AlvaAR current tracked frame points in green and supports a persistent user reference marker.
- MVS, Gaussian accumulation and live meshing now also run in scale-free Alva world. Metric calibration changes the unit to metres; it is no longer a prerequisite for reconstruction.
- The official AlvaAR runtime remains mandatory. A physical `vendor/alva_ar.js` is preferred. When not vendored, the app directly imports a configured official mirror and stores a validated copy in CacheStorage for later offline sessions.

## Important packaging fact

This release does **not** pretend the small `wasm/slam_core.wasm` is AlvaAR. If `vendor/alva_ar.js` is absent, first-run Alva tracking requires network access to one of the configured official mirrors. Run `npm run vendor:alva` on a machine with GitHub/CDN access to make the folder completely first-run offline.
