# Room Scanner V30.40 · robust RGB bootstrap optimizer

V30.40 keeps the single hierarchical `ProbabilisticJointOptimizer`, but fixes the bootstrap failure observed on a real V30.39.2 scan: the optimizer repeatedly restarted from the same poor baseline, entered Depth feedback immediately, switched every RGB photo edge off, and was then rejected by an absolute raw-RMSE gate.

The operational estimator is now:

`RGB scaffold bootstrap -> accepted RGB/pose state -> observable Deep calibration -> causal feedback -> confirmed submaps`

There is still exactly one optimizer in live measurement and REVIEW. There is no Gaussian/Puzzle/Surface-Lab optimizer fallback.

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
