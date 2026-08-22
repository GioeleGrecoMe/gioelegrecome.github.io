# AlvaAR runtime status

Room Scanner V30.14.2 accepts only the official AlvaAR ES module API (`AlvaAR.Initialize`, `findCameraPose`, `getFramePoints`).

Preferred first-run/offline path:

```text
v30/vendor/alva_ar.js
```

If that file is absent, measurement start imports the official distribution from the configured mirrors (jsDelivr first) and caches a validated source copy. Calibration does not load AlvaAR. The tiny local `wasm/slam_core.wasm` is only a frontend sentinel/fallback utility and is never accepted as Alva SLAM.
