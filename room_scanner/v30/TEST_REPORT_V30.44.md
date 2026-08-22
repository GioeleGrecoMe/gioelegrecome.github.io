# V30.44 Test Report

Build: `v30.44.0-20260822-rgb-line-pose-scaffold`

## Result

### Relevant integrated regression group

**35 / 35 PASS**

The group executes the real ESM closure of `ProbabilisticJointOptimizer` under the available overlay and covers V30.42–V30.44 geometry regressions.

Key V30.44 cases:

- monocular RGB translation is sign invariant (`t` and `-t` are the same line);
- RGB translation estimation never chooses sign from Alva/current pose;
- robust epipolar-line estimation survives a substantial minority of gross match outliers;
- the real V30.43 40-frame pose-scaffold statistics cannot authorize dense surface;
- a healthy synthetic RGB scaffold can authorize dense surface;
- exact Deep dense keyframes are eligible for the RGB+Depth photo stream;
- locally valid MVS cannot enter strong surface integration while the global RGB pose scaffold is unobserved;
- direct-photo bearing can selectively suppress Alva translation without suppressing rotation;
- 2x Alva translation-scale mismatch is much less severe than wrong motion direction;
- reversed RGB translation-line sign does not create a 180-degree submap error;
- previous V30.42/V30.43 final-pose MVS, Deep calibration, multi-layer mesher and geometry-withholding regressions remain green.

### JavaScript syntax

All `.js` and `.mjs` files in the incremental V30.44 work tree pass `node --check`.

### Layout/version audit

`node tools/check_v30_layout.mjs`: **PASS**.

No runtime/source references to V30.43 remain outside historical V30.43 documentation.

## Wider overlay suite

`node --test tests/*.test.mjs` on the available incremental-overlay harness:

- total: 41
- PASS: 37
- FAIL: 4

All four failures are missing unchanged base resources, not V30.44 assertions:

- three tests require `js/xr/xr_calibration.js`;
- one test requires `styles.css`.

Those files are not present in the incremental V30.43 patch used as the development baseline and are intentionally not fabricated/stubbed into the delivered patch.

## Phone-log replay policies

The V30.43 40-frame run is rejected as a globally observed pose scaffold before dense surface authority because it had approximately:

- photo import fraction 0.533;
- 8 RGB edges, 0 active / 2 weak / 6 rejected;
- mean RGB translation-direction residual 63 degrees;
- 39/39 Alva edges active.

The previous local-MVS result (1285/3644 passing final-pose revalidation) is therefore diagnostic/candidate evidence only under V30.44, not strong surface evidence.

## Adversarial tests added during development

A first IRLS-only robust estimator was rejected during development because a coherent minority of gross outliers could rotate the initial null-space. It was replaced by deterministic bounded hypothesis generation followed by IRLS. The adversarial test now passes.

This is intentionally recorded because it demonstrates that the final implementation was selected after a failure-producing toy case rather than only tuned on the phone log.

## Expected behavior on device

V30.44 may legitimately produce **zero committed geometry** while the photo pose scaffold is weak. This is not a regression. The diagnostic candidate rebuild should still report local MVS/Depth statistics and the new pose-scaffold telemetry.
