# V30.43 test report

## Real V30.42 failure used as the regression target

The supplied V30.42 diagnostic and PLY were treated as the primary failure case, not as a visual anecdote.

The recorded final state had:

- 117 frames, 42 imported photo edges from 43 inputs, 116 Alva edges, 1379 landmarks, 52 Deep frames and 6476 MVS samples;
- final reconcile RGB switches: 4 active / 31 weak / 7 rejected, mean about 0.304;
- all Alva edges still active;
- V30.42 MVS validation: 3240 / 6476 committed (about 50%);
- final Deep calibration median relative residual about 0.553 and mean depth confidence about 0.045;
- 1211 committed splats, all reaching the mesher;
- mesh topology: 44 connected components, largest component about 3.26% of used vertices, fragmentation about 0.967 and diagonal about 31.5 m.

Direct PLY parsing independently matched the diagnostic topology and showed many small patches scattered through the large volume. This established that the failure was already present in the dense 3-D evidence, not introduced by surfel loss in the V30.42 mesher.

## Real-log policy replay under V30.43

The actual uploaded V30.42 JSON was replayed against the V30.43 policies:

- RGB reconcile `4 active / 42` -> `commitReady=false`, `requiredActive=8`;
- global Deep calibration -> `commitAllowed=false`, reason `depth-calibration-residual-high`;
- final 44-component mesh -> `commitReady=false` through catastrophic/severe fragmentation policy.

Therefore the exact bad V30.42 state can no longer become authoritative geometry in V30.43.

## Targeted regression suite

Combined result: **24/24 PASS**.

Coverage includes:

1. single-optimizer transitive ESM closure is complete and build-tagged;
2. `ProbabilisticJointOptimizer` root imports as a real ESM graph in the incremental-overlay harness;
3. lazy loader evicts rejected imports and probes optimizer closure;
4. observable final-pose MVS can correct deliberately stale depth;
5. unverifiable source photographs cannot authorize historical MVS depth;
6. disconnected pieces of one physical surface share a conflict layer without surfel loss;
7. nearby parallel sheets remain separate surface layers;
8. severe surfel loss is classified fragmented even below the old component threshold;
9. real V30.41 collapsed RGB state cannot commit;
10. real V30.41 reconcile state with zero active RGB edges cannot commit;
11. a genuinely distributed moderate RGB graph can commit;
12. a good RGB edge gains authority;
13. a legacy low-switch RGB edge can recover when geometry agrees;
14. a geometrically bad RGB edge loses authority even with perfect rotation;
15. a rotation-only photo submap edge cannot alter/fabricate translation;
16. an RGB translation-direction edge bends a wrong submap direction without inventing magnitude;
17. tiny-baseline photometric agreement cannot authorize metric MVS depth;
18. baseline ranking prevents near-duplicate frames from hiding the observable views;
19. the real V30.42 Deep calibration is rejected globally;
20. a well-observed synthetic Deep calibration remains eligible;
21. the real V30.42 `4/42` RGB backbone is insufficient for dense commit;
22. the real V30.42 44-island geometry is withheld;
23. epipolar RGB matches recover translation direction but do not output translation magnitude;
24. direct photo epipolar direction raises a correct translation edge and suppresses a direction-inconsistent edge even without shared landmarks.

## Static checks

- all changed/new JavaScript files parse with `node --check`;
- build identity is `30.43.0` / `v30.43.0-20260822-parallax-observable-global-geometry`;
- entry HTML, service worker and changed module cache tags use V30.43;
- the historical V30.42 notes/report are preserved unmodified.

## Incremental archive limitation

The source supplied for this work is itself an incremental V30.42 patch layered on the existing Room Scanner V30 tree. It does not contain several unchanged production modules (`js/slam/math.js`, `pose_uncertainty.js`, `live_optimization_gate.js`, `styles.css`, XR modules, etc.).

The ESM/targeted test harness therefore overlays minimal **test-only** implementations of the omitted imports. Those stubs are never copied into the deliverable archive and are not reported as production replacements. A repository-wide full suite is not claimed from the incomplete incremental source tree.

## What the next physical test must prove

The next run should not be judged by whether it produces a dense-looking room. It must demonstrate that the surviving MVS samples have measurable depth observability and that any Deep contribution is globally calibrated and independently anchored.

A sparse or withheld result is considered safer/correct if those conditions are not met.
