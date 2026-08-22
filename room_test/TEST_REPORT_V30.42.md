# V30.42 test report

## Basis

The revision was driven by the supplied V30.41 device diagnostic and PLY rather than by synthetic thresholds alone. The relevant observed failure state was:

- 31 factor frames, 24 photo edges, 30 Alva edges, 351 landmarks, 14 Deep frames and 1626 MVS samples;
- robust reprojection about 0.867 px but raw reprojection about 27.6 px;
- RGB switches `0 active / 4 weak / 20 rejected`, mean about 0.044;
- Alva switches `30 active / 0 rejected`, mean about 0.995;
- V30.41 global reconcile: RGB `0 active / 16 weak / 8 rejected`, mean about 0.197;
- committed surface: 866 splats, but V30.41 mesher reported only 22 source surfels and seven final mesh components;
- several Deep calibrations rejected as `metric-residual-too-large`.

These numbers are explicitly represented in V30.42 regression/policy tests where possible.

## New targeted regressions

Final result: **13/13 PASS**.

1. Final-pose MVS rescoring corrects a deliberately stale depth after the camera geometry changes.
2. MVS cannot be committed when source photographs are missing/unverifiable.
3. Two disconnected pieces of the same physical surface share one global conflict layer and no surfel is discarded.
4. Two nearby parallel sheets remain separate layers without an intermediate phantom sheet.
5. Mesh audit declares severe surfel loss fragmented even with fewer than eight connected components.
6. Real V30.41 pre-commit RGB state is classified collapsed and cannot commit dense geometry.
7. Real V30.41 reconcile RGB state is no longer “collapsed” but is still insufficient to authorize commit (zero active edges).
8. A distributed moderate RGB consensus can authorize commit without requiring every edge to be active.
9. A good photo edge gains authority instead of collapsing simply because support is finite.
10. A legacy edge seeded at about 0.044 can recover when independent geometry agrees.
11. A photo edge with bad landmark reprojection loses authority even if its rotation is perfect.
12. A rotation-only photo submap edge cannot fabricate or alter metric translation.
13. Photo-edge import audit counts unresolved panorama constraints and survives factor-graph persistence.

The final TAP output is stored during development as `v3042_targeted_tests_final.txt`; temporary base-module stubs used only to satisfy imports of files omitted from the incremental V30.41 archive were not included in the patch.

## Static checks

- every JavaScript file present in the incremental patch parses with `node --check`;
- no runtime/import/cache tag referring to `30.41.0` remains in the V30.42 patch;
- build identity is consistently `30.42.0` / `v30.42.0-20260822-final-pose-dense-consensus` in the changed entry/build files.

## Historical/full-suite limitation

The supplied V30.41 archive is an **incremental patch**, not a complete project tree. It intentionally omits unchanged base files such as `js/xr/xr_calibration.js`, `styles.css`, `js/slam/math.js`, `js/probabilistic/pose_uncertainty.js`, `live_optimization_gate.js` and other modules.

Therefore the historical repository-wide suite cannot truthfully be executed from this archive alone. An attempted build-contract run confirms the V30.42 identity check passes, then stops on missing unchanged base files. This is an archive-completeness limitation, not treated as a V30.42 PASS or as a source failure.

The new V30.42 tests were run against an overlay harness containing minimal test-only implementations for the two unchanged imports required by those isolated tests (`slam/math.js` and `pose_uncertainty.js`). Those stubs are not packaged and do not replace production modules.

## What still requires a physical-device test

No desktop test can reproduce the phone camera, AlvaAR tracking, exposure, WebAssembly Depth model timing or real photometric parallax. The next device run must therefore validate the behavioural invariant, not simply whether a mesh appears:

**authoritative splats must either be independently final-pose validated, or the geometry must be withheld.**

If the scene still lacks enough independent support, V30.42 is expected to show candidate diagnostics and produce no committed surface rather than export a nonsensical room.

## Additional development checks

- `tools/check_v30_layout.mjs`: **PASS** after updating the changed build tooling to V30.42.
- Real diagnostic replay (not a hard-coded approximation): the supplied V30.41 final state evaluates to `collapsed=true, commitReady=false`; its actual `single-opt-commit-reconcile` candidate evaluates to `collapsed=false, commitReady=false`, exactly matching the intended V30.42 safety policy.
- The mock-UI tool cannot be run from the incremental archive by itself because unchanged production `js/logger.js` is not present. It is therefore not reported as PASS.
