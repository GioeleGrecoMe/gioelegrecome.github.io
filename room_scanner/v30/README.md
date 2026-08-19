# Room Scanner V30.12.0

Offline-capable WebXR room scanner with real XRAnchor calibration pins, visual metric relocalisation, camera-only metric tracking, two-view geometric MVS, live Gaussian accumulation and automatic metric mesh generation in Review.

Run the local verification suite with:

```bash
npm run verify
```

During scanning, make small lateral motions while preserving overlap. `tri` should increase first, then `GS`. When the scan is finished, Review automatically builds the metric occupancy mesh and reports its vertex/face count.
