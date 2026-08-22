# V30.45 — phone test

The purpose of this test is to verify scheduling before judging final geometry.

## 1. Fresh build

Reset cache and confirm the badge shows **V30.45.0**.

Start a new scan; do not reuse the V30.44 geometry as evidence of the new scheduler.

## 2. During Scan

Move exactly as you normally would: slow translation, overlap, and a few revisits.

Expected UI:

- `FAST: Alva+RGB+MVS · Deep accodata per post-scan`
- `RGB FAST ✓ · Deep in coda N`
- no multi-second pause is expected merely because a Depth frame was selected.

If convenient, export one diagnostic log **before pressing Finish**. In that log check:

- `deep.calls = 0`
- `fastLane.deepInferenceDuringScan = false`
- `deep.lateQueue.queued > 0`
- `mvs-fastlane-dispatch` events exist
- `rgb-depth-planned-photo` events exist
- `live-map-depth-planned-api` tells us which planned-photo API is actually present

The most useful number is `fastLane.maxGapMs`.

## 3. Finish

Press Finish once.

The camera should stop first. Only then should the UI show Deep post-processing. Expected event order:

1. `deep-postscan-drain-start`
2. repeated `deep-late-dispatch`
3. matching `deep-frame-sync-ok`
4. `deep-late-raw-bound` / `deep-late-photo-bound`
5. `deep-postscan-drain-complete`
6. `fast-lane-frozen-deep-bound`

The first Deep job may include model startup cost. This is acceptable because tracking is already stopped.

## 4. Exact-frame contract

There should be no `deep-frame-sync-rejected` events. If one occurs, return the diagnostics immediately; do not judge the mesh yet.

`deep-late-raw-bound` should report `metricCalibrationDeferred:true`.

## 5. Photo graph

Inspect `rgb-depth-planned-photo`:

- ideal: `mapRegistered:true` with a concrete `mapMethod`;
- if `mapRegistered:false`, include the log. The factor graph still receives pose-bearing RGB frames immediately, but the unchanged live-map base does not expose a fast planned-photo insertion method and should be patched next.

Compare the final photo graph with V30.44:

- photo-edge import fraction;
- active / weak / rejected RGB edges;
- epipolar inlier fraction;
- epipolar plane residual;
- pose-vs-RGB translation-line residual.

## 6. Geometry

Only after the scheduling checks above pass, run the explicit final optimization/rebuild and inspect splats/mesh.

A withheld geometry is still preferable to a non-adherent room. Please return the final diagnostics JSON; return the PLY only if geometry becomes committed or if a candidate PLY is explicitly exportable for diagnosis.

During active Scan also verify that the diagnostics contain `deep-worker-deferred` and no `deep-late-dispatch`; the ONNX worker is recreated only after Finish.
