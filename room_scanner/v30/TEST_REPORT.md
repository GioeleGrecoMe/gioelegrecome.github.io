# V30.29 verification report

Verification command:

```bash
npm run verify
```

Final result: **PASS**.

## Regression suite

- Node tests: **119/119 PASS**
- Depth Anything diagnostic contract: PASS
- layout: PASS (`202` files under one v30 root)
- local dependency closure: PASS (`36` local references resolved)
- EventTarget constructor safety: **5/5 PASS**
- mock UI boot/recovery: PASS
- Alva runtime contract: PASS

## New V30.29 regressions

The new suite explicitly verifies:

1. compact RGB/K/features are stored in one self-consistent frame packet;
2. photo-puzzle Deep calibration uses pose-aware triangulation instead of assuming equal depth for a matched world point;
3. camera optical-Z is converted to normalised-ray range so an off-axis fronto-parallel wall remains planar;
4. noisy shoebox observations are explained by multiple direct planes before particles are allocated;
5. deterministic-annealing particle updates cannot accept an increase of the fixed validation loss;
6. live coverage keeps weak sectors visible and emits revisit guidance.

## Public-data validator

Dataset basis: public **TUM RGB-D `freiburg1_xyz`** material stored under `test/online-data/`.

Observed validator results:

- ground-truth samples: `3000`
- duration: `30.0896 s`
- parsed ground-truth path length: `9.1593 m`
- real-texture feature matches: `86`
- correct matches: `85`
- precision: `0.988372`
- recall: `1.0`
- photo-puzzle views: `6`
- photo-puzzle edges: `8`
- loop edges: `3`
- connected fraction: `1.0`
- factor optimiser reprojection RMSE: `2.2912 px -> 0.03697 px`
- mean pose correction: `0.008394 m`

The public-data test uses real TUM texture and the official TUM trajectory. Controlled image warps and controlled 3D landmarks are used where an exact expected correspondence/optimisation solution is required. This is therefore a reproducible component/integration validation, not a claim of a full TUM end-to-end room-reconstruction benchmark.

## Synthetic geometric stress tests

A noisy six-surface shoebox fixture verifies plane-first extraction. A separate optical-Z regression proves that dense depth points generated across a wide field of view stay on the same metric plane. Particle fitting is stress-tested with noisy non-planar residual geometry and a fixed validation objective.
