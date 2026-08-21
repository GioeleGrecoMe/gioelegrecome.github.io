# Room Scanner V30.38 · live multi-rate optimisation + capillary diagnostics

V30.38 keeps the V30.37 causal hierarchy but moves a conservative subset of the optimisation **inside the measurement loop** so the user can see a stable, interpretable preview while scanning.

The core rule is:

`working solver state -> acceptance gate -> accepted visible state`

The optimiser may explore a working solution; the UI never renders it directly. Only a candidate that passes explicit reprojection, pose-jump, Depth-calibration and switch-consistency gates is promoted to the accepted state. Rejected candidates leave the visible preview untouched.

## Multi-rate runtime

1. **Fast RGB/pose loop** — triggered by new RGB keyframes, sparse anchors and MVS evidence. It uses a bounded local graph, one small optimisation step and no dense preview rebuild.
2. **Slow Depth/confidence loop** — triggered by same-frame Deep evidence. It uses a somewhat larger graph, 1–2 time-sliced steps and may rebuild a small confirmed/submap preview.
3. **Post-scan loop** — still receives the complete factor graph and is not constrained by the live time budget.

The live worker receives the recent graph window plus a few old loop-closure endpoints. This bounds CPU and structured-clone cost without throwing away useful loop evidence. If a live cycle is expensive, the scheduler automatically backs off; cheap cycles gradually restore the nominal cadence.

## Stable preview

Sparse anchors are temporally smoothed after acceptance. Confirmed surface preview is updated only on accepted slow cycles and merged into a persistent spatial hash, so old scanned regions do not disappear simply because the current local window moved elsewhere.

The dense fusion pipeline continues collecting evidence in the background, but it cannot overwrite an already accepted optimiser preview during measurement.

## Diagnostics

Diagnostics use `ROOMSCAN-V30-DIAGNOSTICS-2` and are structured rather than free-form. Every event contains a monotonic sequence number, wall/monotonic time, level, scope, optional trace ID and compact structured data.

For live optimisation the export records:

- trigger and generation;
- full graph size and exact bounded graph window;
- selected frame IDs and recovered old loop endpoints;
- solver time budget and per-step duration;
- accepted and working baselines;
- reprojection/Depth error and RGB/Alva switch statistics;
- every gate reason and warning;
- whether a rejected candidate was retained internally as safe `working` state;
- scheduler backoff and live preview size;
- checkpoints for dispatch, acceptance, rejection and runtime errors.

The measurement panel has a direct **Log** button. Runtime/worker errors also preserve an emergency diagnostic snapshot in local storage; if the page is killed/reloaded, that snapshot is attached to the next exported diagnostic session instead of being silently lost.

The RGB panorama remains pure-photo spherical registration, and only exact RGB+Depth frame pairs enter its graph. Alva remains probabilistic metric evidence and never places photographs in the panorama.
