# V30.28 verification report

Base: V30.27 EXP-4 atomic-boot build.

## New regression coverage

- probabilistic feature association with epipolar + BRIEF + ZNCC + uniqueness evidence;
- Alva pose uncertainty propagation into 3D covariance;
- sequence-level robust Deep calibration with an intentionally corrupted frame;
- independent MVS recovery when a deliberately wrong Deep prior proposes the wrong depth;
- joint pose/landmark factor optimisation with Alva as a soft prior;
- typed probabilistic factor-graph persistence in `.r30`;
- public TUM RGB-D `freiburg1_xyz` data validation.

## Public-data result

Dataset fixture: official TUM RGB-D Freiburg1 XYZ preview + official ground-truth trajectory.

- ground-truth samples: 3000
- trajectory duration: ~30 s
- trajectory length: ~7.11 m
- real-texture feature-association precision: 0.98837
- real-texture feature-association recall: 1.0
- factor-graph reprojection RMSE before refinement: 2.2912 px
- after refinement: 0.03697 px
- mean pose correction: 0.00839 m

The fixture intentionally avoids redistributing the full sequence; it is a reproducible real-data association / trajectory-refinement test, not a claim of full TUM reconstruction accuracy.

## Automated verification

`npm run verify`: PASS

- Node regression suite: 113/113 PASS
- public-data validation: PASS
- Depth diagnostics: PASS
- layout: PASS
- dependency closure: PASS
- EventTarget constructors: PASS 5/5
- mock UI boot: PASS
- Alva runtime contract: PASS
