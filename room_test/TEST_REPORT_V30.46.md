# V30.46 test report

## Targeted integration suite

Result: **33/33 PASS** in the overlay containing the unchanged base dependencies.

Coverage includes:

- `ProbabilisticJointOptimizer` ESM closure;
- RGB switch/submap regressions from V30.42-V30.44;
- Alva translation-authority regressions;
- sign-invariant RGB translation lines;
- robust direct-match fitting;
- V30.45 late-Depth queue semantics;
- Deep absent from the acquisition critical path;
- plane-sweep MVS post-scan only;
- 4.2 s minimum sparse-preparation cadence during scan;
- canonicalization of reversed A/B direct matches without transposing `rotationBToA`;
- strong direct epipolar backbone pose-scaffold authorization;
- final-reconcile direct-scaffold override;
- diagnostic rendering of withheld geometry while export remains blocked.

All JavaScript files in the incremental source pass `node --check`.

## Real V30.45 `.r30` regression

Input: user-provided `roomscan-1787388793897.r30` (not included in the patch).

### RGB canonicalization replay

- imported photo edges: 112 / 139;
- usable direct translation-line edges: **72**;
- `swappedMatchEdges`: **112**;
- median epipolar residual: **2.2059 deg**;
- median parallax: **20.3254 deg**;
- median confidence: **0.2336**.

### Full final rebuild replay

- reconciled scaffold selected: yes;
- `directLineBackbone`: true;
- translation-direction edges: 72;
- mean translation-line residual: 20.0598 deg;
- inlier fraction: 0.8837;
- epipolar residual: 2.0883 deg;
- MVS input evaluated: 25,000;
- MVS committed: **8,841**;
- MVS commit fraction: 0.35364;
- mean observable parallax: 13.7227 deg;
- generated Gaussian/surfels: **1,921**;
- generated faces: **9,213**;
- meshed-surface retention: 1.0.

### Geometry quality

The output is intentionally not committed:

- connected components: **115**;
- largest component fraction: **0.0840**;
- fragmentation score: **0.9160**;
- mesh diagonal: **22.3797 m**;
- camera trajectory diagonal: **8.0954 m**;
- final reason: `mesh-catastrophically-fragmented`.

This is an important regression result: the old zero-output behavior is removed, but the quality gate still catches the remaining incorrect geometry.

## Standalone incremental-tree limitation

The patch is intentionally incremental and does not duplicate unchanged project files such as `styles.css`, `js/logger.js`, XR calibration modules, or the unchanged SLAM math module. Tests that require those files cannot run from the patch directory alone. They were run in an overlay with the unchanged base files/stubs needed by the existing test harness. No such stubs are included in the deliverable.
