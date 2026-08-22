# V30.46 phone test

Apply this archive over the complete V30.45 project, publish it, then reset the V30 service-worker/cache once before testing.

## 1. Verify build

The diagnostics header must show:

- version `30.46.0`;
- id `v30.46.0-20260822-canonical-rgb-postscan-dense`.

## 2. During acquisition

Move normally and include real translation, not only rotation. Expected behavior:

- Alva/RGB remain the fast lane;
- Deep inference does not run;
- no plane-sweep MVS job runs during acquisition;
- logs contain `mvs-postscan-planned`, not repeated `mvs-postscan-dispatch` while scanning;
- sparse preparation is throttled;
- `fast-lane-frame-gap` should be substantially reduced relative to V30.45.

## 3. Press Fine

Expected order in the log:

1. post-scan RGB scaffold recovery;
2. `mvs-postscan-pose-rebound`;
3. `mvs-postscan-drain-start` / `mvs-postscan-dispatch`;
4. Deep post-scan drain;
5. final reconcile/rebuild.

Inspect:

- `photoEdgeAudit.swappedMatchEdges` / `asStoredMatchEdges`;
- `translationDirectionEdges`;
- `translationDirectionMeanInlierFraction`;
- `meanEpipolarPlaneResidualDeg`;
- `meanTranslationDirectionResidualDeg`;
- `poseScaffoldPolicy.observed` and `directLineBackbone`;
- MVS `locallyValidated`, `committed`, and `poseScaffoldWithheld`.

## 4. Review behavior

There are now two legitimate outcomes:

### Geometry passes all policies

Review says `GEOMETRIA COMMITTED`; PLY/mesh export is enabled through the normal committed state.

### Geometry is reconstructed but rejected

Review says `CANDIDATO NON COMMITTED` and still displays the candidate splats/mesh. Export must remain blocked. Record:

- component count;
- largest component fraction;
- fragmentation score;
- dense diagonal / camera trajectory diagonal;
- withholding reason.

This second case is useful diagnostic output and must no longer appear as an empty viewer.

## 5. Existing V30.45 `.r30`

You can also load the previous `.r30` and run the single optimizer/rebuild. V30.46 canonicalizes legacy photo-edge matches on import, so old data can be used to verify the fix without rescanning.
