# V30.42 phone test

Apply this incremental archive over the complete V30.41/base tree. Clear the V30 service-worker/cache so the UI reports:

`30.42.0 · v30.42.0-20260822-final-pose-dense-consensus`

Use a **fresh scan** first. Old V30.41 saved geometry with a factor graph is deliberately withheld and requires a V30.42 rebuild.

## During acquisition

The raw dense worker may generate candidate data, but it must not accumulate as authoritative green/final splats. If optimized poses change, old preview splats must disappear rather than remain as ghosts.

The live diagnostics should expose photo-edge coverage. In particular inspect:

- `photoEdgeInput`;
- `photoEdges` / imported edges;
- `photoEdgeUnresolved`;
- `photoEdgeImportFraction`.

## At OPT UNICO / final review

The important checks are:

- `reprojectionIndependentRobustRmse` versus `reprojectionOptimizationRobustRmse`;
- RGB `active / weak / rejected / mean`;
- `rgbConsensusCollapsed` and `rgbConsensusCommitReady`;
- `single-opt-commit-reconcile`;
- either a valid rebuild or `single-opt-commit-withheld`;
- `mvsValidation.input`, `committed`, `rejected`, `commitFraction`;
- `mvsValidation.meanDepthCorrectionRel` and `meanPhotometricCost`;
- `mvsValidation.maxRelativePoseDriftTranslation` / `RotationRad`;
- `deepConfirmed` versus `deepCandidate`;
- `submapPoseGraph.photoTranslationFabricated` must be `false`;
- mesh `inputSurfels`, `sourceSurfels`, `meshedSurfelFraction`, `surfaceLayers`, component count and fragmentation status.

## Correct failure behaviour

If RGB consensus remains like the supplied V30.41 log (`0 active` edges), **V30.42 should not create committed geometry**. This is intentional and preferable to plausible-looking but spatially false splats.

If commit succeeds, visually check the splats before judging the mesh:

1. splats must lie on recognizable physical surfaces;
2. revisiting the same wall/object must reinforce the same world surface rather than create a duplicate shell;
3. no historical splat cloud should remain after a pose correction;
4. only then inspect mesh continuity.

For the next debug upload, export the diagnostics after final review. If geometry commits, also export the PLY. If commit is withheld, the diagnostics alone are the most useful artifact.
