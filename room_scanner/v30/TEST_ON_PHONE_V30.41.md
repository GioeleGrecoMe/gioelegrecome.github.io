# V30.41 phone validation

The main purpose is to verify that a numerically stable scaffold now produces a geometrically coherent committed surface.

1. Deploy V30.41 and confirm the badge/build is `30.41.0`.
2. Scan a textured room with overlap and deliberate lateral translation; avoid a pure rotation panorama.
3. During acquisition verify that `OPT UNICO` continues to report robust/raw reprojection and accepted/rejected cycles.
4. Finish the scan and run **Continua OPT UNICO** for a modest number of accepted iterations. Do not use hundreds of attempts as a substitute for new evidence.
5. Export diagnostics and the committed mesh.

Expected committed diagnostics:

- `single-opt-commit-reconcile` identifies whether the full graph was safely reconciled;
- `single-opt-mesh-quality` is always emitted after committed rebuild;
- `sparseLandmarksMeshed` must be `false`;
- `globalFinalTsdf` must be `true`;
- `mesh.consensusMode` must be `multi-layer-tsdf`;
- `eligibleCommittedFrames` and `excludedUnacceptedFrames` explain exactly which poses were allowed to create final dense geometry;
- `meshQuality.componentCount`, `largestComponentFraction`, `fragmentationScore` and `status` must be present;
- if `meshQuality.status == fragmented`, the program emits `committed-mesh-fragmented` rather than silently presenting the mesh as reliable.

For a normal connected room scan, the desired trend is a dominant connected component rather than hundreds of tiny islands. Multiple components are legitimate for physically disconnected objects, so component count alone is not a pass/fail criterion; inspect largest-component fraction and spatial support together.
