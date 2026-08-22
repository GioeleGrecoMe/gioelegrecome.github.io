# V30.53.0 validation

## Real-session replay

Source replay: `roomscan-1787408462091.r30` captured by V30.52.0.

The V30.52 post-scan jobs independently derived depth ranges ranging from approximately `0.0217..0.6848` to `0.1525..44.538` in the same Alva world. V30.53 replaces those private view scales with one scan-wide depth envelope whose preferred authority is the optimized RGB landmark scaffold.

Replay with V30.53:

- depth consensus mode: `shared-landmark-consensus`
- shared near/far: `0.17176 .. 16.89142` Alva units
- RGB landmark seeds used: 1006 across 8 MVS views
- reliable local sparse seeds: 544 across 8 MVS views
- revalidated MVS samples in replay: 143 / 477
- mean observable parallax: 9.62 deg
- mean independent observable sources: 2.64
- global consensus: 142 input -> 140 clusters -> 140 authoritative
- authoritative median confidence: 0.4471
- `splatCommitReady = true`
- candidate TSDF mesh: 20,286 kept vertices / 39,605 faces
- mesh components after cleanup: 9
- raw discarded vertex fraction: 2.23%
- `meshCommitReady = false` (`mesh-severely-fragmented`)

This is intentional: V30.53 commits/exports the authoritative global splat map while continuing to withhold a topologically incoherent mesh.

## Regression suite

`npm test`:

- total: 285
- pass: 284
- fail: 1
- sole failure: `models/model_q4.onnx` is absent from this no-model package (`ENOENT`)

The new `v30-53-mvs-global-scale-regressions.test.mjs` tests all pass, including shared scale authority, sparse fallback, MVS radius persistence, split splat/mesh commit gates, and source-level production wiring.

Additional checks:

- layout: PASS (323 files under the V30 root)
- dependency closure: PASS (63 local references, 5 ESM roots)
- EventTarget constructors: PASS 5/5
- mock UI boot: PASS
- AlvaAR runtime contract: PASS
- Depth worker diagnostics: PASS
- TUM public-data validation: PASS (85/86 correct matches; precision 0.988; recall 1; reprojection 2.291 px -> 0.0308 px)

## Scope

Depth Anything inference/model code is unchanged. The patch changes post-scan MVS scale orchestration, geometric validation/fusion bookkeeping, surface commit policy, diagnostics/tests, and V30.53 cache/build identities.
