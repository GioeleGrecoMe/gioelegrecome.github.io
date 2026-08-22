# V30.43 phone test

Expected build badge / diagnostic build:

`30.43.0 · v30.43.0-20260822-parallax-observable-global-geometry`

## Test procedure

1. Reset the V30 shell cache once after publishing V30.43 and verify the service-worker version is `30.43.0`.
2. Start a fresh room scan where possible. Move translationally as well as rotating: sidestep / walk arcs so that repeated surfaces are observed from a real baseline.
3. Keep the exact-frame RGB + Deep acquisition flow unchanged.
4. Finish the acquisition and run `OPT UNICO` review.
5. Export the diagnostic JSON and, only if a committed surface exists, export the PLY as well.

## What to inspect

The decisive final events are:

- `single-opt-commit-reconcile`;
- optionally `single-opt-commit-candidate-rebuild` when RGB is not strong enough;
- `single-opt-mesh-quality`;
- `single-opt-rebuild`;
- either a valid committed result or `single-opt-commit-withheld` / `committed-surface-withheld`.

In `mvsValidation`, inspect:

- `input` / `committed` / `commitFraction`;
- `rejectReasons`;
- `meanObservableParallaxDeg`;
- `meanDepthSensitivityPx`;
- `meanObservableSources`;
- `depthEnvelope`.

Also inspect:

- `depthGeometryPolicy`;
- `geometryPolicy`;
- `deepAnchoredBySparse`, `deepAnchoredByMvs`, `deepUnanchoredRejected`;
- `submapPoseGraph.translationDirectionEdges` and `meanTranslationDirectionResidualDeg`;
- RGB `active / weak / rejected` counts after final reconcile.

## Expected behaviour

V30.43 may intentionally produce **no committed geometry** when the scan is mostly rotational, Deep calibration is poor, RGB consensus is too weak, or final topology is implausible. This is not a regression by itself.

The desired success case is a smaller set of splats that are visibly attached to actual room surfaces and have real parallax support. Only after that invariant is satisfied should mesh density/continuity be optimized further.
