# V30.44 — phone test

The goal of this test is **not** to maximize the number of splats. It is to verify that the RGB photo scaffold acquires enough authority to define camera motion before MVS becomes surface.

## Recommended acquisition

1. Start a new session after loading V30.44.
2. Move slowly, but include real translation: roughly 20–50 cm lateral/forward motion between useful viewpoints instead of only rotating in place.
3. Keep textured walls/furniture edges visible across several consecutive viewpoints.
4. Avoid very fast motion and large motion blur.
5. Complete the same room sector long enough for several exact Deep dense keyframes to be added automatically to the RGB+Depth photo graph.
6. Run the final optimization/review and export diagnostics even if committed geometry is withheld.

## What should improve first

In diagnostics, inspect `poseScaffoldPolicy` and RGB edge stats before judging the mesh.

Healthy direction:

- `photoEdgeImportFraction` should rise substantially above the V30.43 run (0.53);
- photo-map `connectedFraction` should approach 1 with one dominant component;
- `translationDirectionMeanInlierFraction` should be high;
- `meanEpipolarPlaneResidualDeg` should be low;
- `meanTranslationDirectionResidualDeg` should fall well below the V30.43 ~63 degrees;
- Alva translation switches should no longer remain near 1 when independent RGB direction strongly disagrees;
- `poseScaffoldPolicy.observed` should become true before MVS surface is authorized.

The production policy currently expects approximately 70% imported photo-edge coverage and, when enough direction edges exist, a pose-vs-RGB line residual below about 28 degrees. Direct epipolar fit quality is also checked when available.

## How to interpret a failure

### Good epipolar fit, bad pose-direction agreement

If `meanEpipolarPlaneResidualDeg` is low and the RGB inlier fraction is good, but `meanTranslationDirectionResidualDeg` remains high, the photographs agree internally and the remaining problem is the camera trajectory / Alva authority.

### Bad epipolar fit itself

If the epipolar-plane residual is high or the robust inlier fraction is poor even with visually good overlap, the next debugging target is camera geometry rather than MVS: crop/intrinsics, distortion, frame orientation, or direct-photo matching.

### Pose scaffold good, MVS still fragmented

Only after `poseScaffoldPolicy.observed=true` should MVS geometry be judged. Then inspect local-vs-authorized MVS telemetry and depth envelopes.

## Files to return

Please return the exported diagnostics JSON. If V30.44 actually produces committed geometry, also return the PLY. If geometry is withheld, the JSON alone is sufficient because the candidate rebuild telemetry is retained.
