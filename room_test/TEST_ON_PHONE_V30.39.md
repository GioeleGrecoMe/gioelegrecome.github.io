# V30.39 phone diagnostic checklist

Make a short 30–60 s scan before judging geometry quality. The purpose of this build is first to prove that the intended optimizer actually executes.

1. Start measurement and open **Mappa → Log** after several RGB+Depth frames.
2. Confirm that `OPT UNICO` changes from `inizializzazione` / `attendo scaffold` to a phase such as `RGB/pose` or `Deep/confidenza`.
3. Export diagnostics.

A valid log should contain:

- `single-opt-runtime-ready`;
- `single-opt-cycle-dispatch`;
- `single-opt-cycle-start`;
- `single-opt-step`;
- `single-opt-gate`;
- at least one `single-opt-candidate-accepted` or `single-opt-candidate-rejected`.

It must not contain:

- `live-opt-worker-created`;
- `live-opt-worker-error`;
- `optimizer-progress` from the old Gaussian optimizer;
- Surface Mesh Lab / Photo Puzzle optimization events.

When a candidate is rejected, inspect `hardReasons`, baseline/candidate reprojection error and pose deltas. When `single-opt-rgb-edge-coverage-low` occurs, inspect `panoramaEdges`, `importedPhotoEdges`, `posedPhotoFrames` and `unposedPhotoFrames`: this tells us whether the metric graph is starved of whole-photo RGB constraints even though the photo mosaic itself is connected.
