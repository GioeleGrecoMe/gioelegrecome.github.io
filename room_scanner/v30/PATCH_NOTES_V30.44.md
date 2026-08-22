# Room Scanner V30.44 — RGB line pose scaffold

Build: `v30.44.0-20260822-rgb-line-pose-scaffold`

V30.44 is an upstream geometry correction. It does **not** try to repair a bad room with extra TSDF smoothing or looser Depth/MVS thresholds. The V30.43 phone logs showed that the safety gates were working, but the camera scaffold feeding MVS was still mostly Alva-driven.

## Evidence from the V30.43 phone logs

The new 40-frame scan ended with only 8 imported photo edges out of 15 inputs and the live photo map had 16 exact RGB+Depth frames split into 6 components; only 5 were visually registered. All 39 Alva edges remained active near unit authority while the 8 RGB edges had 0 active, 2 weak and 6 rejected. The RGB translation-direction residual was about 63 degrees.

The final candidate surface contained 244 strong MVS-derived Gaussians, but formed 72 components over a dense diagonal of about 25.6 m. Deep was already excluded from the final candidate (`deepCount=0`), so Depth Anything was not the immediate source of those islands. The submap graph also reported about 120 degrees mean translation-direction residual.

This exposed two distinct problems:

1. a monocular essential matrix observes the translation **line** `span(t)`, not an oriented vector; V30.43 oriented the sign using the current pose/Alva and then compared it as a directed vector;
2. local MVS observability is conditional on the camera poses. A locally sharp photometric minimum can still be geometrically wrong if the global pose scaffold is wrong.

## 1. RGB translation is now an unoriented epipolar line

`rgb_translation_direction.js` no longer uses current/Alva poses to choose the sign of monocular translation.

All RGB consumers use a sign-invariant angular residual:

`angle(line_a, line_b) = acos(abs(dot(a,b)))`.

A representative sign is selected only locally when applying a residual to the current baseline. It is not stored as new visual information.

This removes the V30.43 self-confirmation loop:

`Alva pose -> choose RGB t sign -> compare RGB t to Alva -> Alva appears consistent`.

## 2. Robust direct-photo translation estimator

The direct-photo estimator is no longer plain weighted least squares. It now uses deterministic bounded hypothesis generation from intersections of epipolar planes followed by robust IRLS refinement.

Diagnostics now separate the quality of the photo geometry itself from its disagreement with the current pose:

- `translationDirectionMeanInlierFraction`
- `meanEpipolarPlaneResidualDeg`
- `meanTranslationParallaxDeg`
- `meanTranslationDirectionResidualDeg`

This distinction is important. A low epipolar-plane residual with a high pose-direction residual points at a bad trajectory. A bad epipolar fit itself instead points toward matching, camera intrinsics/crop, or distortion.

## 3. RGB can now falsify Alva translation independently

The photo edge model exposes an independent translation-contradiction map derived from direct-photo bearing evidence. It is not multiplied away by the whole-edge switch.

The Alva switch model consumes that contradiction selectively:

- rotation remains separately trusted;
- translation direction remains useful;
- monocular Alva translation **magnitude** is treated as a weak scale prior rather than a rigid metric measurement;
- strong independent RGB direction disagreement can reduce only the Alva translation authority.

The optimizer also decomposes the Alva translation residual into a stronger direction component and a much weaker magnitude component.

## 4. Dense surface requires a globally observed RGB pose scaffold

New module: `js/probabilistic/pose_scaffold_policy.js`.

MVS is still fully revalidated at final poses for diagnostics, but local MVS validation no longer implies surface authority. A sample can be:

- locally MVS-valid;
- kept as a candidate/diagnostic;
- **withheld from strong surface integration** because the camera pose scaffold is not sufficiently constrained by RGB.

The pose-scaffold policy evaluates:

- photo-edge import coverage;
- active/weak/rejected RGB support;
- translation-line coverage;
- pose-vs-line angular residual;
- direct epipolar inlier fraction and plane residual when available.

Deep surface integration is gated by the same pose-scaffold authority in addition to the existing Depth calibration policy.

New MVS telemetry distinguishes local validation from global authorization:

- `locallyValidated`
- `poseScaffoldWithheld`
- `localValidationFraction`
- `meanLocalDepthCorrectionRel`
- `meanLocalPhotometricCost`
- `meanLocalObservableParallaxDeg`
- `meanLocalDepthSensitivityPx`
- `meanLocalObservableSources`

## 5. More exact RGB+Depth photo nodes without extra Deep inference

The V30.43 phone run had only 5 visually registered frames out of 16. Dense keyframes that already received Depth Anything on the exact same frozen RGB frame were not being reused by the photo mosaic.

V30.44 now commits those exact Deep dense keyframes into the same RGB+Depth photo stream after their depth result returns.

This does not add any neural inference and preserves the project invariant: **no user-visible photo enters the photo graph unless that exact frame has Depth**.

Because dense keyframes already have factor-graph pose nodes, photo edges between them can be imported without the earlier silent pose-binding loss.

## 6. Diagnostics and safety behavior

`mesh-quality`, `preview-map-withheld` and `commit-withheld` traces now include `poseScaffoldPolicy`.

V30.44 deliberately permits a complete candidate rebuild even when the pose scaffold is invalid, so diagnostics can still report MVS/Deep behavior. The candidate does not become committed surface.

## Known limitation outside this incremental patch

The V30.43 browser self-test `alva-deep-ray-consensus-pipeline` still expects legacy live dense wiring with `type:'mesh'`. V30.42+ intentionally stopped treating live worker mesh output as authoritative geometry. The unchanged base `self_test.js` is not present in the incremental source patch supplied here, so V30.44 does not replace that unrelated base file.

Likewise, the repository-wide overlay test cannot execute tests that require unchanged base files absent from the incremental archive (`js/xr/xr_calibration.js`, `styles.css`). These missing-file failures are reported separately rather than marked PASS.
