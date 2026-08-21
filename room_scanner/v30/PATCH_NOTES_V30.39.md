# V30.39.0 — Single hierarchical optimizer debug build

## Why this build exists

The V30.38.1 phone diagnostic showed that the new live optimizer was not actually running:

- 31 live optimizer worker creations;
- 30 worker errors;
- zero accepted candidates;
- zero rejected candidates;
- final live optimizer state `ready=false`.

The browser only reported a generic worker error, so the mathematical estimator could not be evaluated from that scan. The same log also showed a large difference between online metric factor-graph RGB edges and the photo panorama graph. This made it hard to tell which path was responsible for the visible result.

V30.39 intentionally removes that ambiguity.

## One optimizer only

There is now one operational optimization implementation:

`ProbabilisticJointOptimizer`

It is wrapped by `SingleOptimizerRuntime` and used for both:

1. live scan optimization;
2. manual REVIEW refinement.

There is no optimizer fallback to:

- `live_probabilistic_worker.js`;
- `probabilistic_opt_worker.js`;
- `gaussian_opt_worker.js`;
- Photo Puzzle optimization;
- Surface Mesh Lab optimization.

Legacy algorithm source files may remain in the full repository for regression tests/history, but the published application does not import, configure, bind, or expose them.

## No optimizer Worker during this debug phase

The single optimizer executes in short main-thread time slices. This is deliberate for diagnosis. A solver exception is now caught at the exact call site and logged with its actual stack rather than being collapsed into a browser `Worker error` with no filename/line.

The expensive neural Depth Anything inference and dense mapping workers remain workers; only *optimization method selection/execution* has been simplified.

## Accepted vs working state

`SingleOptimizerRuntime` keeps:

- accepted state — the only state allowed to affect the stable preview;
- working state — the next hypothesis;
- conservative gate — decides whether working becomes accepted.

A rejected cycle cannot move the accepted preview.

## RGB evidence audit

Before every cycle the current spherical RGB panorama edges are imported into the metric factor graph wherever both photo endpoints possess a metric pose node. The diagnostic contains:

- panorama frame count;
- panorama RGB edge count;
- photo frames with a pose node;
- photo frames without a pose node;
- imported whole-photo RGB edges;
- sparse RGB landmarks;
- Deep frames;
- Alva relative edges.

If fewer than 35% of available panorama edges can enter the metric factor graph, V30.39 emits `single-opt-rgb-edge-coverage-low`. This is diagnostic, not a license to invent poses for photo frames.

## Diagnostic event sequence

A healthy cycle should contain, in order:

- `single-opt-runtime-ready` once;
- `single-opt-scheduled`;
- `single-opt-cycle-dispatch`;
- `single-opt-cycle-start`;
- one or more `single-opt-step`;
- `single-opt-gate`;
- `single-opt-candidate-accepted` or `single-opt-candidate-rejected`.

Errors become `single-opt-exception` / `single-opt-error` with stack traces.

There should be **no** `live-opt-worker-created` or `live-opt-worker-error` in a V30.39 scan.

## Review behavior

Finishing a scan no longer silently launches another post-processing optimizer. REVIEW shows a single card named **OPT UNICO**. Pressing **Continua OPT UNICO** continues the same estimator from the last accepted live state and uses the same acceptance gate.

## Geometry policy unchanged

This patch does not relax the epistemic hierarchy:

- multiview RGB scaffold remains primary;
- Deep remains a calibrated fallible dense prior;
- Alva remains a pose prior, not image-placement truth;
- candidate and confirmed geometry remain separated;
- photo mosaic remains spherical and RGB-driven.
