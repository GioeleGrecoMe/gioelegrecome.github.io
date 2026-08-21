# V30.38 patch notes · live multi-rate optimiser and diagnostics

## Live optimisation

- dedicated module worker for probabilistic optimisation during measurement;
- independent `working` and `accepted` solver snapshots;
- conservative live acceptance gate based on RGB reprojection, pose jumps, Depth regression and switch behaviour;
- rejected candidate never changes the visible preview;
- safe-but-not-visible rejected working state may continue converging internally;
- fast RGB/pose and slow Depth/confidence cycles with separate time budgets;
- adaptive scheduling backoff from measured solve/map cost;
- bounded live factor-graph windows with recovery of selected old loop endpoints;
- post-scan optimiser seeded from the last accepted live state.

## Stable preview

- accepted sparse anchors are render-smoothed;
- only accepted slow cycles can rebuild a compact confirmed/submap surface preview;
- accepted surface previews are spatially accumulated instead of replacing the whole visible map;
- raw dense-fusion output remains evidence/review data and cannot overwrite an accepted live preview.

## Diagnostics

- `ROOMSCAN-V30-DIAGNOSTICS-2` structured event log;
- monotonic event sequence + wall and monotonic timestamps;
- event scopes and live-optimiser trace IDs;
- full graph versus exact bounded graph-window diagnostics;
- per-step solver timings and feedback phase;
- baseline/candidate/gate details for every accepted/rejected cycle;
- manual **Log** export directly in the measurement map header;
- compact checkpoints at measurement start, dispatch, acceptance, rejection and failures;
- emergency tail persisted on runtime/worker/handled operation errors and page hide;
- previous emergency tail automatically attached to the next diagnostic export;
- diagnostic summary counts included in every JSON snapshot.

## Compatibility

- spherical RGB panorama unchanged;
- RGB panorama still excludes Alva from image placement;
- exact same-frame RGB+Depth eligibility unchanged;
- V30.37 candidate/confirmed causal feedback retained;
- no model files are added by this patch.
