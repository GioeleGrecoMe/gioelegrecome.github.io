# Room Scanner V30.47 — REVIEW provenance + pose-bound MVS

Build: `v30.47.0-20260822-review-provenance-pose-bound-mvs`

## Why this patch exists

The V30.46 REVIEW log proved that the A/B RGB canonicalization worked, but a reloaded session could still reuse MVS depths estimated under older camera poses. Those samples were photometrically rechecked under the new poses but their *source-camera geometry at estimation time* was not persisted, so stale MVS could be promoted into a final rebuild. The observed symptom was a large diagnostic candidate (1865 splats / 10758 faces) split into 99 components and rejected as `mesh-catastrophically-fragmented`.

## Changes

### 1. Every new MVS factor is pose-bound
`ProbabilisticFactorGraph.addMvs()` now persists:
- exact reference pose used by MVS;
- exact source poses used by MVS;
- evidence build;
- stage (`postscan-final-pose` for the dense path);
- optional scaffold id.

A factor is marked `poseBound=true` only when an explicit MVS reference pose was supplied. Missing caller metadata is no longer silently relabelled as an exact binding.

### 2. Stale MVS is quarantined before photometric revalidation
`filterMvsSourcesByEstimatePose()` compares the current reference→source relative pose with the relative pose under which the depth was estimated.

A source is removed when its relative translation/rotation changed materially. If no source survives, the whole factor is rejected with one of:
- `mvs-pose-binding-unavailable`;
- `mvs-relative-pose-drift-high`.

Rejected stale factors do not create diagnostic candidate points.

Legacy factors explicitly tagged `estimatedUnder: posePrior` are handled conservatively by treating the stored frame `posePrior` as their legacy binding. They are still revalidated and can be quarantined.

### 3. REVIEW state hydration fixed
The REVIEW iteration counter now uses the maximum authoritative optimizer state rather than only the old generic `optimization.iterations` field. A saved 117-iteration optimizer can therefore no longer display `ottimizzazione 0 iterazioni`.

The factor graph/optimizer is persisted even when committed geometry is zero.

### 4. Evidence provenance survives reload/save
Session snapshots now retain `evidenceProvenance` with:
- original/source build;
- last processing build;
- pose-bound/unbound MVS factor counts.

Re-saving a V30.45/V30.46 evidence graph under V30.47 no longer erases its origin semantically.

### 5. `.r30` now preserves the optimizer state
Future `.r30` exports include:
- probabilistic optimizer snapshot;
- live accepted snapshot/gate;
- evidence provenance;
- effective iteration count;
- `geometryCommitted`.

Non-committed Gaussian/mesh candidates are deliberately excluded from authoritative `.r30` geometry.

### 6. Export buttons are truly gated
PLY and TSDF export are disabled in the UI unless the corresponding geometry is committed. The export functions independently enforce the same condition, so a stale enabled button cannot bypass the policy.

An externally loaded PLY is treated as an already-materialized external artifact and remains viewable/exportable.

### 7. Final RGB scaffold cannot be undone by one legacy guard
When full-graph RGB reconciliation produces an observed direct-line scaffold and the reprojection remains safe, `rebuildAccepted()` may ignore *only* the legacy hard reason `rgb-consensus-insufficient-for-commit`.

`rgb-consensus-collapsed` and every other hard failure remain blocking.

## Expected behavior with old V30.45/V30.46 sessions

Old archives may no longer produce the large fragmented candidate previously visible. This is intentional. MVS whose estimation geometry cannot be reconciled with the current scaffold is quarantined rather than projected into a new world pose.

A fresh V30.47 scan is the meaningful validation of the dense path, because its post-scan MVS factors carry exact pose bindings from creation time.
