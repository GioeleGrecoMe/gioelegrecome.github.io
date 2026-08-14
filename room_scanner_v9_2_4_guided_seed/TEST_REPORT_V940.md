# Room Scanner v9.4 test report

Build: `v9.4-picosam-readiness-gate`

## Result

All 16 regression suites pass after the v9.4 changes.

### New v9.4 regression

`tests/test_v940_picosam_readiness.py` verifies:

- PicoSAM2 is attempted before EfficientSAM;
- missing optional PicoSAM weights do not block the workflow;
- PicoSAM2/PicoSAM3 ONNX files can be supplied through the existing browser upload path;
- the white/green reticle is gated by local depth, verified surfels, stable surfels, independent views, metric extent, compact depth, and local normal/orientation evidence;
- the readiness function uses voxel-local surfel lookups and does not scan the full surfel map;
- the segment button cannot be enabled while the reticle is not ready;
- confirmed object seeds retain the local orientation evidence of the green frame;
- the optional PicoSAM2 file is cacheable when deployed but is not service-worker install-critical.

Synthetic gate cases include:

- many depth points but one view: rejected;
- sufficient position support but insufficient normals/orientation: rejected;
- insufficient metric span: rejected;
- sufficient depth + multi-view + stable + normal evidence: accepted.

## Deep audit

`tests/DEEP_AUDIT_V940.json`:

- 269 DOM IDs, zero duplicates;
- 586 named functions, zero duplicates;
- 244 simple DOM references, zero missing targets;
- 96 direct event-handler targets, zero missing targets;
- JavaScript module syntax: PASS;
- service worker syntax: PASS;
- readiness full-map scan: absent;
- green-marker and segment-button gates: consistent;
- bundled EfficientSAM hashes: unchanged/PASS.

The report deliberately records `picosam_local_file_present=false`: the
preferred PicoSAM2 binary is not bundled in this build. This is expected and is
not hidden by the tests. When absent, preflight falls back to the bundled
EfficientSAM-Ti pair.

## Historical regressions rerun

The full suite also rechecks:

- v9 multi-view mapping and ghost pruning;
- semantic/structural priors;
- virtual acoustic array;
- RAW compatibility;
- realtime governor;
- Diagnostic ZIP;
- sparse-preview/final-processing fixes;
- local EfficientSAM integrity;
- guided object seeding geometry;
- clean semantic preflight;
- WebGPU -> WASM fallback;
- engineered five-stage workflow.

See `tests/FULL_SUITE_V940.log` for the complete outputs.
