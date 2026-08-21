# V30.35.0 test report · layer-wise probabilistic Depth

## Automated suite

`npm test`: **146/147 PASS**.

The only failure is the expected filesystem test for `models/model_q4.onnx`; the user-supplied development package intentionally omits `models/`. No panorama, Depth, persistence, UI or reconstruction regression failed.

New V30.35 tests verify:

- exact affine monocular maps synchronize on one global scale;
- strongly nonlinear but monotone response changes synchronize through layer transfers;
- overlap-derived layer anchors are created;
- incompatible depth surfaces remain separate instead of averaging;
- compatible observations reduce posterior uncertainty;
- Hann weighting applies only in RGB overlap and cannot erase single-source coverage.

## Additional checks

- `check:public`: PASS. TUM RGB-D fixture: 98.84% feature precision, 100% recall, 6/6 photo frames connected, 15 photo edges, 6 loops, live graph connected 100%.
- `check:depth`: PASS.
- `check:layout`: PASS.
- `check:deps`: PASS, 40 local dependencies resolved.
- `check:constructors`: PASS, 5/5.
- `check:mock`: PASS.
- `check:alva`: PASS.

## Scope

Tests confirm that AlvaAR still has no authority over RGB placement and that downstream 3-D reconstruction contracts remain unchanged.
