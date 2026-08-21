# V30.40 validation report

Date: 2026-08-21

## Full automated suite

`npm test`: 179 total, 178 PASS, 1 FAIL.

The sole failure is the existing filesystem assertion for `models/model_q4.onnx`. The supplied project tree intentionally has no `models/` directory; no optimizer/runtime test failed.

New V30.40 regression coverage includes:

- default RGB-only warm-up before Deep feedback;
- robust gate accepts a useful scaffold with >10 px raw RMSE when robust reprojection is <3.2 px;
- raw reprojection remains visible as an outlier diagnostic;
- strongly-supported whole-photo RGB edges cannot all disappear without either strong independent reprojection gain or a conservative gate response;
- real `SingleOptimizerRuntime` toy case with ~25% gross RGB outliers: raw RMSE remains >27 px while robust RMSE reaches ~1.2 px and the RGB bootstrap is accepted with no RGB edge rejected;
- single optimizer ESM closure imports as a real recursive graph.

## Project checks

- `npm run check:public`: PASS
- `npm run check:depth`: PASS
- `npm run check:layout`: PASS (243 files in full work tree)
- `npm run check:deps`: PASS (50/50 local references)
- `npm run check:constructors`: PASS (5/5)
- `npm run check:mock`: PASS
- `npm run check:alva`: PASS

Public TUM RGB-D fixture:

- 85 / 86 correct visual matches
- precision 0.9883720930
- recall 1.0
- factor reprojection: 2.2912042940 px -> 0.0285553234 px
- 6 / 6 photo frames connected
- 15 photo edges
- 6 loops
- live photo coverage 0.51
- live depth coverage 0.51419921875

## On-device failure addressed

The supplied V30.39.2 log repeatedly used the same baseline (~19.65 px raw RMSE), produced the same rejected candidate (~19.74 px raw RMSE), switched all 9 RGB photo edges off, and restarted without accepted or working progress. V30.40 changes the bootstrap ordering, reprojection statistic used by the gate, switch annealing and no-progress termination specifically to prevent that cycle.
