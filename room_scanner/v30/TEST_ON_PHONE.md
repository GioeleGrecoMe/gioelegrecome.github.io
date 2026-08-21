# V30.38 phone validation

The goal of this test is not merely to see whether the final mesh looks plausible. It verifies that live optimisation improves the estimate **without making the preview unstable** and that diagnostics are sufficient to explain every correction.

## 1. Normal scan

1. Start on a textured region with foreground and background.
2. Acquire a few RGB+Depth frames with modest lateral translation.
3. Watch `OPT LIVE` in the measurement screen.
4. Revisit an already seen region to create at least one useful loop.

Expected:

- the RGB mosaic remains spherical/photo-only;
- `OPT LIVE` eventually reports accepted cycles and a reprojection value;
- sparse/confirmed preview geometry moves smoothly rather than teleporting;
- old accepted regions remain visible when scanning another part of the room.

## 2. Deliberately bad short segment

Briefly create a difficult interval (fast turn, weak texture, partial occlusion), then return to the good textured region.

Expected:

- a bad optimisation candidate may be rejected;
- the HUD explicitly says the preview is unchanged;
- the visible accepted geometry does **not** jump to the rejected candidate;
- later good evidence can recover and produce new accepted cycles.

## 3. Depth feedback

Include one nearly planar wall view and one richer view containing multiple depth layers.

Expected:

- Deep arrival schedules slower feedback cycles;
- planar/weak views do not destabilize camera pose or invent large calibration changes;
- confirmed preview updates happen less frequently than RGB/pose updates;
- conflicting candidate Depth does not immediately become committed surface.

## 4. Performance/back-pressure

Scan continuously for at least 30–60 seconds.

Expected:

- camera/tracking remains responsive while optimisation runs in the worker;
- the solver may increase its scheduling interval on a slow phone instead of blocking capture;
- it should not remain permanently `working…`.

## 5. Export diagnostics

While still measuring, open **Mappa** and press **Log** at least once. Also export after any visible anomaly.

For a good trace verify that the JSON contains:

- `format = ROOMSCAN-V30-DIAGNOSTICS-2`;
- `summary`;
- `runtime.optimizer`;
- `live-opt-dispatch` events with `fullGraph` and `window`;
- `live-opt-solve-start` traces;
- at least one accepted or rejected gate decision once enough scaffold exists;
- checkpoints.

If the page unexpectedly closes or reloads, reopen it and export a Log **before clearing site data**. The previous emergency tail should appear under `previousSessions`.

For debugging, send the JSON log and, when available, the corresponding `.r30` session.
