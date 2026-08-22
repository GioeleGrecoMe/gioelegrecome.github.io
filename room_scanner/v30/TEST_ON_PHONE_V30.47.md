# V30.47 — test on phone

For the decisive test, make a **new scan**. Old V30.45/V30.46 sessions are useful to test safe quarantine/reload, but they cannot contain exact MVS pose bindings that did not exist when they were acquired.

## A. Fresh scan

1. Deploy V30.47 and use **Reset cache** once.
2. Verify badge/build `30.47.0`.
3. Scan the room with normal translation and overlap; finish the scan.
4. In REVIEW, press `Continua OPT UNICO` only if needed.
5. Export diagnostics and `.r30`.

Expected diagnostics:
- `mvsPoseBoundFactors > 0` and ideally close to the number of post-scan MVS factors;
- `mvsPoseUnboundFactors = 0` for newly generated V30.47 MVS;
- new dense factors have stage `postscan-final-pose`;
- MVS pose-rejection counters may be nonzero after further optimization, but stale factors must be quarantined rather than committed;
- REVIEW iteration count must agree with the optimizer (no `0 iterazioni` when the optimizer has accepted cycles);
- if geometry is not committed, PLY and TSDF buttons are disabled;
- if geometry is committed, export buttons enable normally.

## B. Reload an old session

Open the previous V30.45/V30.46 saved session.

Expected:
- old/unbound dense evidence is reported as legacy/unbound;
- old committed/candidate geometry is not silently promoted;
- running OPT may produce less candidate geometry than V30.46 because inconsistent MVS is now quarantined;
- this is a safety result, not a regression.

## What to send back

Please send:
- diagnostics JSON;
- `.r30` from the **fresh V30.47 scan**;
- a screenshot of REVIEW if the model is fragmented, empty, or visually wrong.

The most useful fields will be `mvsPoseBoundFactors`, `mvsPoseUnboundFactors`, `poseRejectedFactors`, `poseRejectedSamples`, final pose-scaffold policy, mesh component count, largest component fraction, and depth calibration residuals.
