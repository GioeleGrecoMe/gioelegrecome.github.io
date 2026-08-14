# Room Scanner v9.2.4 — validation report

Build: `v9.2.4-guided-object-seeding`

## Functional regressions

All packaged Python regression tests pass:

- v9 HTML / DOM / JavaScript syntax
- v9 multi-view Gaussian mapping
- v9 semantic + structural graph
- v9 virtual acoustic array
- legacy RAW project compatibility
- v9.1 semantic integration
- v9.2.1 diagnostic ZIP generation
- v9.2.1 realtime governor hot-path audit
- v9.2.2 preview/final-processing regression
- v9.2.3 bundled EfficientSAM model integrity
- v9.2.4 guided object-seeding workflow
- v9.2.4 guided seed geometry regression

`node --check` passes for both the extracted module script and `sw.js`.

## Deep static audit

- DOM IDs: 249, all unique.
- Named functions: 558, no duplicate definitions.
- Simple `$()` ID references: all resolve to real DOM IDs.
- Direct click/change/input handler targets: all resolve.
- No automatic `setTimeout(...runSyntheticRIR...)` path remains.
- No old synchronous full-map `pruneLowProbabilitySurfels(..., true)` final-processing path remains.

## EfficientSAM integrity

The packaged models are byte-for-byte identical to the corresponding files in the user-provided `EfficientSAM-main.zip`:

- encoder SHA-256: `84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951`
- decoder SHA-256: `a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11`

Remote EfficientSAM weight URLs are disabled.

## Guided-seed regression

A synthetic mask test verifies that:

- visible surfels inside a confirmed SAM mask can receive semantic identity even while their geometric existence probability is still low;
- SAM confirmation does **not** increase geometric existence probability;
- later multi-view-confirmed object surfels refine the object extent;
- nearby high-confidence background points that were not assigned to the object do not enlarge the final object box.

## RIR viewer regression

- opening the final viewer does not calculate a synthetic RIR;
- source/receiver may be positioned for a useful validation pair, but the RIR result stays `non calcolata`;
- `Genera RIR` executes the real local solver before enabling the plot;
- the plot is collapsed inside the scrollable drawer and never overlays the 3-D canvas controls;
- moving source, receiver, source/receiver height, or a receiver following the virtual camera invalidates the old RIR.

## Browser-runtime note

The EfficientSAM ONNX model weights are bundled. ONNX Runtime Web itself is a separate dependency and is not present in the uploaded EfficientSAM repository. The app prefers the three matching runtime artifacts in `vendor/`; see `vendor/README.md` and `tools/fetch_onnxruntime_web.py` for full-offline deployment.
