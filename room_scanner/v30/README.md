# Room Scanner V30.41 · global accepted state + dense-only multi-layer surface

V30.41 keeps exactly one operational estimator, `ProbabilisticJointOptimizer`, but corrects the downstream failure exposed by the real V30.40 diagnostic and PLY: a good robust RGB fit could still produce a mesh made of many tiny TSDF islands.

The committed pipeline is now:

`RGB scaffold -> globally accumulated accepted state -> observable inverse-Depth calibration -> independent dense confirmation -> rigid submaps -> one global multi-layer TSDF -> topology audit`

Key rules: sparse RGB landmarks never create surface; local accepted windows are merged by persistent IDs; Alva translation/rotation authority starts from tracker confidence and is evaluated after an RGB-first proposal; local Depth calibration keeps a fixed normalization domain; final commit recalibrates Depth across the full eligible graph; MVS normals are camera-local; and final submap geometry is remeshed globally rather than concatenating local TSDF meshes.

The final mesher preserves mutually incompatible nearby surfaces in separate TSDF layers, then welds compatible layer meshes at genuine intersections. The committed output reports a `meshQuality` topology audit and explicitly warns when the result is fragmented.

See `PATCH_NOTES_V30.41.md`, `TEST_ON_PHONE_V30.41.md` and `TEST_REPORT_V30.41.md`.


## Bootstrap rules

- Deep cannot influence the first RGB recovery passes.
- Sparse landmark/pose refinement runs before whole-photo RGB switches are reassessed.
- RGB whole-edge switches are annealed during bootstrap so one poor initial pose cannot immediately destroy the visual graph.
- Individual robust RGB tracks retain a minimum authority even when a whole-photo edge is weak.
- A rejected candidate may be retained internally as a **working-only** state if it makes measurable safe progress. The visible preview still stays on the last accepted state.
- Four consecutive cycles with no accepted or internally retained progress produce `single-opt-stalled`; the solver stops instead of repeating the same candidate hundreds of times.

## Reprojection diagnostics and gate

Acceptance is based primarily on robust weighted reprojection. The logger also records raw RMSE, median, P90 and fraction below 4 px. Raw RMSE is intentionally not an absolute acceptance criterion because a minority of mismatches can dominate a squared mean while the robust scaffold remains useful.

The preview never follows a working-only candidate. Only `single-opt-candidate-accepted` changes accepted pose/surface state.

## Depth hierarchy

After RGB bootstrap, Deep uses the existing hierarchical inverse-depth model

`rho_i(u) = a_i * F_gamma(d_i(u)) + b_i`

with `full`, `shift-only` or `inherit` freedom selected by observability. `F_gamma` remains one low-DOF monotone response shared by the scan. Candidate/confirmed geometry and leave-one-view-out checks remain unchanged.

## Useful diagnostic sequence

A healthy difficult scan may show:

`single-opt-cycle-start (bootstrap:true)`
`-> single-opt-step (phase:rgb-bootstrap)`
`-> single-opt-bootstrap-progress`
`-> single-opt-gate`
`-> single-opt-candidate-accepted`
`-> later depth-feedback`

If the RGB scaffold cannot improve, the expected terminal diagnostic is `single-opt-stalled`, with robust/raw/median/P90 reprojection and RGB switch statistics.
