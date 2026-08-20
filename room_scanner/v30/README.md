# Room Scanner V30.14.2

Room scanner with **AlvaAR as the autonomous long-lived visual SLAM/world tracker**. WebXR calibration is optional and is used only to bootstrap a fixed metric transform; after that, AlvaAR owns the trajectory. Metric MVS, robust live splat fusion and mesh extraction remain downstream consumers of the Alva pose.

## Tracking architecture

- **ALVA TRACKING** — current Alva pose is valid.
- **ALVA LOST** — the world pose is frozen; no keyframe/MVS update is generated.
- **ALVA RELOCALIZED** — Alva has returned a valid pose and reconstruction resumes in the same fixed world transform.

There is intentionally no optical-flow pose fallback. A substitute trajectory would move the world while Alva is lost and would destroy persistent objects.

With a valid WebXR calibration, the pin matcher is only a short metric bootstrap. It estimates several metric camera poses, pairs them with the same running Alva session, solves one fixed Alva→metric Sim(3), and then disconnects from Scan.

Without calibration, **Avvia AlvaAR** starts a scale-free Alva world immediately. This mode is useful for testing tracking/relocalization and AR persistence independently of metric calibration.

## Scan UI

The camera is the primary view. The transparent AR layer uses the same Alva/metric camera pose as reconstruction and can cycle through **GS**, **GS+Mesh**, **Mesh**, and **Off**. Review is secondary and supports one-finger orbit, two-finger pan/pinch, wheel zoom, double-click fit, and top/front/side presets.

## AlvaAR runtime

The application tries `vendor/alva_ar.js` first. Put the official AlvaAR `dist/alva_ar.js` there for a fully self-contained/offline deployment. If the local file is absent, the runtime tries the configured CDN URL. If AlvaAR cannot be loaded, Scan reports the error instead of silently substituting another pose tracker. See `vendor/README_ALVAAR.md`.

## Verification

```bash
npm run verify
```

During scanning, move slowly with lateral baseline and image overlap. When Alva is valid, `tri` should increase before `GS`; if tracking is lost, the reconstruction should stop growing until `ALVA RELOCALIZED` appears.

See `docs/CHANGES_V30_14_0.md` for the architectural details and `docs/VERIFY_V30_14_0.log` for the release verification.
