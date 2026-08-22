# Room Scanner V30.39.1 — single-optimizer start hotfix

## Root cause found from the phone diagnostic

The V30.39 cleanup correctly removed the operational Surface Mesh Lab path, but `beginBridge()` still called the deleted `stopSurfaceLabWorker()` function. Pressing **Start** therefore threw a `ReferenceError` before camera, AlvaAR, factor graph, or the single `ProbabilisticJointOptimizer` could initialize.

## Fix

- Removed the stale legacy Surface Mesh Lab teardown call from `beginBridge()`.
- The acquisition transition can now stop only the current single optimizer runtime when one is actually active.
- Added a source contract that rejects any reachable `SurfaceLab`/Puzzle legacy optimizer hook in `app.js`.
- Extended the mock UI boot test to press **Start** and verify that execution reaches `CameraController` rather than failing on a removed optimizer symbol.
- Bumped the atomic shell/build identity to **30.39.1** so GitHub Pages/service-worker module caches cannot mix the broken V30.39.0 `app.js` with the hotfix.

No reconstruction, panorama, Depth Anything, AlvaAR, or optimizer mathematics were changed in this hotfix.
