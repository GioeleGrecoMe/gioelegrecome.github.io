# V30.47 Test Report

## Targeted regressions

`49 / 49 PASS`

This includes all relevant V30.42–V30.46 RGB/scaffold/async-lane tests plus six new V30.47 tests:
1. new MVS factors persist exact reference/source pose bindings;
2. pose-bound MVS survives a global gauge translation when relative geometry is unchanged;
3. a materially changed source relative pose is rejected;
4. legacy `posePrior` MVS is explicitly revalidated rather than silently relabelled;
5. REVIEW uses effective optimizer iterations, preserves provenance, and hard-gates exports;
6. finalizer override can ignore only `rgb-consensus-insufficient-for-commit`, never `rgb-consensus-collapsed` or other hard failures.

## Wider incremental-overlay suite

`50 / 54 PASS`.

The four failures are pre-existing baseline-file availability checks for files not present in the incremental overlay (`js/xr/xr_calibration.js` and `styles.css`). No V30.47 functional regression failed.

## Real V30.45 `.r30` replay

Input: the previously supplied 121-frame real scan.

RGB reconciliation still recovers the direct RGB scaffold:
- 112 photo edges;
- 72 translation-direction edges;
- direct line backbone observed;
- line inlier fraction ≈ 0.884;
- epipolar-plane residual ≈ 2.09°;
- direction/trajectory residual after recovery ≈ 20–22°.

The commit-stage legacy RGB guard no longer reverts that recovered scaffold (`directScaffoldOverride=true`).

With V30.47 MVS provenance filtering enabled, 8771 legacy MVS samples are quarantined because all their usable source relations moved too far. Remaining legacy MVS can still form a diagnostic candidate, but the old archive remains topology-rejected rather than being falsely committed. This is expected: its dense estimates were generated before exact pose binding existed.

## Static checks

- all changed JavaScript files: `node --check` PASS;
- single-optimizer ESM closure/import PASS;
- V30 layout/version audit PASS;
- no `?v=30.45.0` or `?v=30.46.0` imports remain in the V30.47 source closure.
