# V30.37 phone validation

The most useful real-device test is no longer only “does the mesh look plausible?”. Check whether the estimator attributes failures to the right source.

1. Scan a textured part of a room with some lateral translation, then revisit it for a loop closure.
2. Keep at least one nearly planar wall view and several geometrically richer views containing foreground + background.
3. Briefly make Alva tracking difficult (fast turn / low texture), then return to a previously seen textured area.
4. Inspect the live RGB+Depth mosaic: RGB placement must remain photo-only and Deep must remain exact-frame paired.
5. Finish the scan and run the probabilistic optimizer.

Expected diagnostics:

- planar views should tend toward `shift-only`/`inherit`, not invent a new scale;
- relative Alva edges around a tracking failure may become weak/rejected while RGB reprojection improves;
- local Deep failures should increase local-Depth suspicion instead of moving the whole camera;
- candidate Deep count may be non-zero: this is expected and preferable to phantom surface;
- committed output should report `strong`/`confirmed` evidence and a rigid submap pose graph;
- revisiting an old area should add loop constraints without visibly tearing already fused local geometry.

For a useful debug export, include the `.r30`/diagnostic session after the scan; V30.37 persists the factor graph and switch state needed to reproduce these decisions.
