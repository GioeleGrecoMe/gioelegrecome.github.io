# Room Scanner V30.38 architecture

## 1. Epistemic hierarchy

The estimator remains deliberately asymmetric:

`multi-view RGB geometry > multi-view-consistent calibrated Depth > single-view Depth`.

AlvaAR supplies initialization and temporal continuity, not final truth. The V30.38 change is not a new geometric model: it is a **runtime control layer** around the V30.37 hierarchical estimator.

## 2. Exact-frame RGB + Depth acquisition

Only a frozen RGB image whose exact immutable frame has a valid/scheduled Deep result is eligible for the photo/depth graph. RGB panorama registration is spherical and photo-only. Alva pose is optional metadata/metric evidence.

## 3. Sparse scaffold and observable Depth

RGB tracks, switchable photo edges and triangulated landmarks remain the highest-authority scaffold. Deep is calibrated as inverse depth

`rho_i(u) = a_i * F_gamma(d_i(u)) + b_i`

with one low-DOF monotone `F_gamma` shared by the scan. Per-frame scale/shift freedom is selected by observability (`full`, `shift-only`, `inherit`).

## 4. V30.38 live state split

The live estimator has three conceptual states:

- **evidence graph**: latest immutable measurements;
- **working state**: solver exploration, never rendered directly;
- **accepted state**: last candidate that passed the live gate and is safe to expose to the user.

A rejected candidate cannot move the visible camera scaffold or surface. If it is not catastrophic under a much looser internal safety gate, it may remain as the next working seed so several small iterations can converge without making the preview oscillate.

## 5. Multi-rate scheduler

### Fast loop

Triggered by RGB keyframes, sparse anchors and useful MVS evidence. Default cadence is about 420 ms, one optimiser step and a small graph window. Photo raster payloads are stripped before structured clone when they are not needed.

### Slow loop

Triggered by same-frame Deep evidence. Default cadence is about 850 ms with 1–2 small steps. It enables the Depth/confidence feedback phase and can request a small confirmed surface preview.

### Adaptive load control

Solve/map time changes the next scheduling interval. Expensive cycles increase a bounded backoff; cheap cycles reduce it. The main capture/tracking loop therefore never waits for mathematical convergence.

## 6. Bounded graph window

Live optimisation does **not** clone the whole historical graph every time. The worker receives:

- recent frames;
- a limited number of strong old loop-closure endpoints;
- immediate temporal neighbours around those endpoints;
- only RGB/Alva/depth/MVS/landmark factors whose frame IDs remain in the window.

Post-scan optimisation still receives the full graph.

The window exports explicit diagnostics: selected frame IDs, excluded count, old loop endpoints, edge/evidence counts and whether photo pixels were retained.

## 7. Conservative acceptance gate

A candidate is compared against the accepted solution on the **same current evidence graph**. Hard rejection includes, among others:

- non-finite reprojection;
- large absolute reprojection that is not clearly improving;
- reprojection regression;
- excessive common-frame translation jump;
- excessive common-frame rotation jump;
- severe Depth-calibration regression.

RGB/Alva switch spikes and large mean corrections are warnings/penalties rather than automatic truth assertions. A score combines reprojection, normalized energy, Depth improvement and jump/switch penalties, but hard physical/visual constraints take precedence.

## 8. Stable visible scaffold

Accepted landmark positions are smoothed toward the new solution rather than teleported. This smoothing belongs only to rendering; the solver snapshot remains unsmoothed.

The HUD exposes phase, accepted reprojection error, gate score and accepted/rejected cycle count.

## 9. Confirmed live surface preview

Only an **accepted slow** cycle can ask the optimiser to rebuild a compact confirmed/submap surface preview. The result is intentionally bounded in surfels, triangles, Deep samples and MVS samples.

New accepted preview surfels are spatially merged with the previous accepted preview. Therefore a local graph window moving to another part of the room does not make already stable geometry vanish from the user interface.

Raw dense fusion continues for evidence persistence/review but cannot overwrite the accepted live optimiser preview while one exists.

## 10. Candidate/confirmed geometry and feedback

The V30.37 causal rules remain intact: Depth is checked leave-one-view-out, visibility is tested, frame/region/pixel confidence is derived, and candidate evidence cannot validate itself. Confirmed/strong evidence is the only dense geometry eligible for committed reconstruction.

## 11. Diagnostics as part of the estimator

Diagnostics are treated as a first-class subsystem. Every live optimiser generation gets a trace ID and records:

- complete graph summary;
- bounded window diagnostics;
- scheduling delay/backoff and time budget;
- accepted baseline and working baseline;
- every optimisation step with duration and feedback phase;
- candidate statistics;
- gate score, hard reasons, warnings and pose deltas;
- accepted/rejected decision;
- working-state retention after a visible rejection;
- preview rebuild time and surface statistics.

Runtime `error`, `unhandledrejection`, worker errors and handled high-level operation failures generate checkpoints and an emergency persisted snapshot.

## 12. Post-scan continuity

The accepted live state is persisted in the session and is used as the initialization for the post-scan probabilistic optimizer. Live optimisation therefore improves the starting point without replacing the more complete final pass.
