# V30.38 debugging · live optimisation

V30.38 diagnostics are designed so a failed measurement can be reconstructed from the log without guessing what the optimiser was doing.

## Export during measurement

Open **Mappa** and press **Log** at any moment. The JSON format is `ROOMSCAN-V30-DIAGNOSTICS-2`.

The export contains:

- `summary`: event/checkpoint counts by level/scope plus the most frequent events;
- `runtime`: current screen, tracking status, complete factor-graph summary, current live-map state and accepted live-optimiser state;
- `checkpoints`: compact snapshots at important state transitions;
- `entries`: ordered structured events;
- `previousSessions`: an emergency snapshot from the preceding crashed/hidden session, when available.

Each event has `seq`, `at`, `tMs`, `level`, `event`, `scope`, optional `traceId`, and `data`.

## Most useful live-optimiser events

### Scheduling / load

- `live-opt-scheduled`: requested cadence, wait time and current backoff.
- `live-opt-coalesced`: new evidence arrived while the worker was busy; it was not lost, but coalesced into the next cycle.
- `live-opt-deferred-main`: not enough RGB scaffold yet.
- `live-opt-dispatch`: generation, trigger, fast/slow mode, complete graph, bounded graph window and budget.
- `live-opt-solve-start`: accepted/working baselines, selected graph window and worker budget.

A healthy phone should not show continuously increasing backoff or a permanent stream of coalesced events.

### Solver steps

`live-opt-solve-start` is followed by the final accepted/rejected event containing `steps[]`. For every step inspect:

- `ms`;
- `phase` (`RGB/pose` or `depth-feedback` internally);
- `reprojectionRmse`;
- `deepRelativeError`;
- `poseShiftMean`.

This distinguishes an algorithmic divergence from a cycle that was simply too expensive for the device.

### Acceptance gate

- `live-opt-candidate-accepted`
- `live-opt-candidate-rejected`

For a rejection inspect `gate.hardReasons`, `gate.warnings`, `gate.poseDelta` and the baseline/candidate statistics.

Typical hard reasons:

- `non-finite-reprojection`: numerical failure;
- `reprojection-absolute`: solution still implausible and not clearly improving;
- `reprojection-regression`: RGB geometry became worse;
- `pose-translation-jump`: preview would teleport spatially;
- `pose-rotation-jump`: preview would rotate abruptly;
- `depth-calibration-regression`: Deep feedback became substantially less consistent.

`workingRetained=true` means the candidate was unsafe to display but still numerically reasonable enough to continue as an internal seed. The visible state stays unchanged.

### Graph-window diagnosis

Inside `live-opt-dispatch.window` / `live-opt-solve-start.windowDiagnostics` inspect:

- `selectedFrameIds`;
- `excludedFrames`;
- `oldLoopFrames`;
- RGB/Alva edge counts;
- landmark/Deep/MVS counts;
- `includePhotoPixels`.

If a good loop is missing from a bad optimisation cycle, this section tells us whether it was absent from the graph or merely rejected by the solver.

### Preview diagnosis

Accepted slow cycles report `previewMap`/`previewStats`. The live UI stores a persistent spatially merged accepted map, so a local window change should not erase an old room region.

If the solver accepts normally but the visible geometry jumps, compare the accepted pose delta against the displayed stable-map count: that points to rendering/merge rather than estimation.

## Emergency diagnostics

`window.error`, `unhandledrejection`, live-worker errors and high-level caught operation errors create a checkpoint and persist a compact emergency snapshot in local storage. `pagehide`/backgrounding also saves the latest tail.

On the next launch that snapshot is attached as `previousSessions` and then removed from local storage. Therefore, after an unexpected close/reload, **export one new Log immediately before clearing cache/site data**.

## What to send for a useful bug report

Prefer the measurement JSON exported with **Log**, plus the `.r30` session when the scan reached review. If possible describe approximately when the visible problem occurred; `tMs` and `traceId` let the corresponding optimiser generation be isolated quickly.
