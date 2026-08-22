# V30.41 · global accepted state + dense-only multi-layer surface

V30.41 is a structural correction driven by the real V30.40 diagnostics and exported PLY, not a threshold retune.

The V30.40 optimizer was genuinely running and could reach sub-pixel robust reprojection, yet the exported mesh remained severely fragmented. Analysis of the supplied PLY found 1443 vertices / 1362 faces split into 133 connected components; the largest component contained only 60 vertices (~4.2%). This showed that the dominant failure had moved from optimizer bootstrap to the evidence-to-surface path.

## Corrections

1. **Sparse RGB landmarks are never meshed.** They constrain pose and calibrate Depth only. Committed surface comes from dense MVS or independently-confirmed calibrated Deep evidence.
2. **Accepted local optimizer states are merged globally by persistent IDs.** A new local window can no longer erase older accepted poses, landmarks, RGB switches, Alva switches or per-frame Depth calibration.
3. **Committed Depth calibration is recomputed over the complete current scaffold.** Local windows freeze the raw-Depth normalization domain; final commit deliberately resets it and estimates one full-session domain.
4. **Depth residual is truly dimensionless.** It is measured in inverse-depth as `|rho_pred-rho_geom| / max(eps, |rho_geom|)` with median/P90 diagnostics.
5. **Alva authority starts from tracker confidence.** Translation/rotation switches are initialized from `priorConfidence`; legacy unit-switch factors are repaired on load.
6. **Alva is evaluated after an RGB-first pose proposal.** It can no longer largely validate itself through poses already pulled toward its own prior. Translation and rotation remain independently switchable.
7. **MVS normals are camera-local.** They rotate consistently when an optimized pose changes. Old ambiguous world-normal factors are treated conservatively.
8. **Submaps remain the reversible live representation, but final meshing is global.** Confirmed surfels are transformed through optimized rigid submap poses and remeshed once; local TSDF meshes are not concatenated.
9. **Final TSDF is multi-layer.** Nearby incompatible surfaces keep separate signed-distance fields, avoiding an artificial average sheet. Compatible layer meshes are welded at real intersections (e.g. wall/floor corners).
10. **Mesh topology is measured and logged.** Component count, largest-component fraction, degenerate faces, bounding box, edge statistics and fragmentation score are included in committed diagnostics. A fragmented final mesh emits an explicit warning.
11. **Rejected full-graph reconciliation is conservative.** If the complete RGB reconciliation cannot be accepted, dense commit is restricted to frames already present in the accumulated accepted state rather than trusting untouched raw Alva poses.

There is still exactly one operational mathematical optimizer: `ProbabilisticJointOptimizer`. No Gaussian/Puzzle/Surface-Lab optimizer fallback is reintroduced.
