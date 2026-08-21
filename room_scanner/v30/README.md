# Room Scanner V30.31 · Photo-first panorama + overlap depth consensus

V30.31 deliberately improves the acquisition layer before changing any later 3D reconstruction. The live measurement screen now exposes two coupled products: a photographic pseudopanorama and a depth panorama covering the same visual atlas.

## Authority hierarchy

The key change is the hierarchy of evidence:

`RGB overlap -> robust visual registration -> local parallax warp -> Deep overlap consensus -> Alva metric prior -> later 3D`

AlvaAR is still captured for every photo, with pose and covariance, but it no longer vetoes a valid photographic correspondence through an epipolar gate. This is intentional: an approximate pose must be correctable by the observations rather than suppressing them.

## Photo panorama

Every Deep-survey photo freezes one exact packet before asynchronous inference:

`frameId + timestamp + RGB/gray + K + Alva pose/covariance + 2D features`.

New photos are connected by BRIEF/ZNCC appearance matching, mutual uniqueness, homography RANSAC and calibrated-ray rotation estimation. Pairwise visual rotations form a robust panorama graph. On top of the spherical base warp, verified RGB correspondences build a small spatially varying displacement grid that absorbs residual parallax locally. This is deliberately lightweight enough for a browser and prevents the panorama from depending on Alva translation.

Compositing is best-source rather than indiscriminate averaging, so a disagreement does not automatically become blur. Exposure gain is estimated from matched regions and only small, colour-consistent seam blending is allowed.

## Depth panorama

Raw Depth Anything maps are retained in their original relative form. For each verified RGB edge, raw depth samples are compared at the matched pixels and a robust affine relation is estimated between the two maps. The strongest mutually consistent overlaps propagate a common latent depth coordinate through the photo graph.

This live overlap-consensus layer is confidence-weighted and rejects weak/suspicious maps instead of averaging them. If the existing metric Deep/Alva scale graph has enough support, the DEPTH view can switch to metric values; otherwise it stays explicitly relative. Relative and metric units are never mixed in one atlas.

The metric 3D reconstruction pipeline itself is unchanged in this release.

## Pose evidence retained for the next step

Session snapshots and `.r30` export now retain the probabilistic factor graph, raw Deep sequence and photo-panorama evidence. The panorama state stores visual rotations, RANSAC residuals, up to 120 2D correspondences per edge, Alva pose/covariance for every frame and visual-vs-Alva disagreement diagnostics. That is the evidence needed to later optimise camera positions without treating Alva as ground truth.

## Measurement UI

The camera is again the dominant surface. Top telemetry is compressed into a small HUD; PHOTO/DEPTH panorama, Deep preview and coverage sphere live in one collapsible diagnostics dock. Desktop landscape can open the dock beside the camera; on a phone it behaves as a bottom sheet and starts camera-first.

## Verification

Run `npm test` for the complete Node suite and `npm run check:public` for the public TUM registration fixture. Because the supplied project intentionally omits `models/`, the local ONNX presence test is expected to fail until the normal model files are restored; this is not a panorama regression.
