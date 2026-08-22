# Room Scanner V30.43 — parallax-observable global geometry

Build: `v30.43.0-20260822-parallax-observable-global-geometry`
Date: 2026-08-22

## Why this revision exists

The real V30.42 device replay removed the previous mesher-loss bug: all 1211 final surfels reached the global mesher. The geometry was still physically wrong, however. The exported result contained 44 connected components spread over a roughly 31.5 m diagonal volume. V30.42 had revalidated 3240 / 6476 MVS samples photometrically and then called 1211 output splats `strong`, even though the result was not room-scale coherent.

The failure was upstream of TSDF. V30.42 equated multi-view photometric agreement with depth observability. That is invalid under small-baseline / near-pure-rotation motion: the same patch can match well for many depths. It also allowed a globally poor monocular Depth calibration to create thousands of committed samples.

V30.43 changes the definition of evidence. A sample is not committed because several images agree locally; it must provide independent information about **where the surface is in 3-D**.

## 1. MVS requires real depth observability

`final_mvs_revalidation.js` now separates:

- photometric support;
- geometrically observable support.

A source view counts as a 3-D witness only when it has both:

- sufficient triangulation/parallax angle;
- sufficient reprojection sensitivity to a perturbation of candidate depth.

The final MVS search also:

- ranks source frames by baseline rather than taking the first source IDs;
- uses the optimized final camera poses;
- can use local sparse RGB depth only as a hint/independent rescue, never as a replacement for photometric support;
- rejects flat/ambiguous photometric minima;
- constrains candidate depth to the robust sparse RGB depth envelope;
- records rejection reasons and observability diagnostics.

A committed MVS sample therefore needs either two observable source views, or one observable source plus an agreeing local sparse RGB anchor.

## 2. Deep Anything cannot self-confirm global geometry

A new global `depth_commit_policy.js` evaluates the complete final inverse-depth calibration before any Deep sample can create surface.

The gate uses:

- global observability/non-linearity state;
- informative frame/anchor counts;
- median and P90 relative residual;
- calibration/reliability confidence.

The real V30.42 state (median relative residual about 0.553 and mean depth confidence about 0.045) is rejected as `depth-calibration-residual-high`.

Even when the global Deep calibration passes, a local Deep sample must also be:

- cross-view `trusted` with genuinely independent parallax support;
- anchored locally by independent RGB sparse geometry or an already validated MVS anchor.

Two nearby Deep predictions no longer validate one another merely because the same model is consistent with itself.

## 3. RGB consensus needed for authoritative dense geometry is stronger

V30.42 could authorize commit with only 4 active whole-photo edges out of 42. V30.43 requires a distributed active RGB backbone. Direct photo matches now also test current translation direction epipolarly, so a visually consistent edge can gain authority even when shared landmark overlap is sparse. For 42 edges the real state needs at least 8 active edges, not 4.

The optimizer may continue using weak edges and Alva while trying to recover; this stricter condition applies to **authoritative dense commit**, not to continuing optimization.

If RGB is insufficient, the final rebuild still runs in candidate-only diagnostic mode so that MVS/Deep rejection statistics remain visible.

## 4. RGB photo matches constrain submap translation direction, not fake scale

V30.42 correctly removed fabricated metric photo translation but left photo submap edges mostly rotation-only.

V30.43 estimates a monocular translation **direction** from epipolar RGB matches after applying the observed rotation. This direction can bend an Alva-dominated submap baseline toward the visual geometry while preserving metric magnitude under the metric prior.

No RGB edge invents a metric translation length.

## 5. Cross-depth consistency now requires geometric independence

`cross_depth_consistency.js` no longer calls multiple near-pure-rotation views independent. `trusted` requires independent triangulation support, not only different frame IDs.

## 6. Final geometry is a hypothesis until topology and scale agree

A new `geometry_commit_policy.js` audits the dense result after meshing. Severe/catastrophic fragmentation or gross scene-scale explosion prevents authoritative commit.

The mesh/splats may still be built internally for diagnostics, but the app clears `state.mesh`, `state.gaussians` and `__ROOMSCAN_METRIC_MESH` when final policy fails. The rejected dense result remains only in candidate diagnostics.

This deliberately prefers **no committed geometry** to a visually convincing but false room.

## 7. Diagnostics added

Final `mvsValidation` now reports, among other fields:

- `input`, `committed`, `rejected`, `commitFraction`;
- `rejectReasons`;
- `meanObservableParallaxDeg`;
- `meanDepthSensitivityPx`;
- `meanObservableSources`;
- robust sparse `depthEnvelope`;
- maximum relative pose drift.

Final stats also report:

- `depthGeometryPolicy`;
- `geometryPolicy`;
- `deepAnchoredBySparse`;
- `deepAnchoredByMvs`;
- `deepUnanchoredRejected`;
- `submapPoseGraph.translationDirectionEdges`;
- `submapPoseGraph.meanTranslationDirectionResidualDeg`.

If RGB consensus is insufficient, expect `single-opt-commit-candidate-rebuild`; after the diagnostic rebuild expect `single-opt-commit-withheld` / `committed-surface-withheld` unless all final policies pass.

## Non-goals

- Sparse RGB landmarks are still scaffold, never TSDF surface.
- Alva remains the metric prior, not a photographic panorama placement mechanism.
- There is still exactly one estimator: `ProbabilisticJointOptimizer`.
- V30.43 does not loosen Deep or MVS thresholds merely to fill holes.
