# Room Scanner V30.13.0

Room scanner camera-only with WebXR metric calibration pins, AlvaAR-first visual SLAM, metric MVS, robust live splat fusion and metric mesh extraction.

## Scan UI

The camera is the primary view. The transparent AR layer is registered with the same metric camera pose used by MVS and can cycle through **GS**, **GS+Mesh**, **Mesh**, and **Off**. Review is secondary and supports one-finger orbit, two-finger pan/pinch, wheel zoom, double-click fit, and top/front/side presets.

## AlvaAR runtime

The application tries `vendor/alva_ar.js` first. Put the official AlvaAR `dist/alva_ar.js` there for a fully self-contained/offline deployment. If it is absent, the runtime tries the configured online fallback and clearly labels the lower-quality JavaScript fallback if AlvaAR cannot be loaded. See `vendor/README_ALVAAR.md`.

## Verification

```bash
npm run verify
```

During scanning, move slowly with lateral baseline and overlap. `tri` should increase before `GS`; the live AR overlay should stay registered to the camera image while the pose is tracked.
