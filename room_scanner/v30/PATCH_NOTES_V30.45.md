# Room Scanner V30.45 — async RGB/Alva fast lane + late-bound Deep

Build: `v30.45.0-20260822-async-rgb-alva-late-deep`

V30.45 removes Depth Anything from the acquisition critical path. The change is architectural: RGB/Alva/MVS are allowed to run at their own cadence, while exact RGB frames selected for neural depth are frozen and processed later. Depth completion time has zero authority over camera tracking, photo placement, or MVS scheduling.

## Why

The V30.44 phone log showed a good improvement in photo coverage (39 photo frames, 36 visually registered, 86 photo edges), but Deep inference remained much slower than the fast visual lane. A Deep request could complete many seconds after the source frame and the dense scheduler still serialized MVS behind that result. This wastes the visual information rate and can starve the monocular pose scaffold exactly when it needs continuity.

## 1. MVS never waits for Deep

`dispatchDensePayload()` now has two independent outputs:

1. an immutable exact-frame copy may be queued for future Deep;
2. the MVS payload is dispatched immediately to `denseDepthWorker`.

`denseBusy` now represents MVS work only. Deep result/error handlers cannot set `denseBusy`, cannot own `denseActivePayload`, and never resend a payload to MVS.

New trace: `mvs-fastlane-dispatch`.

## 2. Deep inference is post-scan by default

New defaults:

- `deepPostScanOnly: true`
- `deepInferEveryDenseKeyframe: false`
- bounded `deepLateQueueMaxItems`
- a small survey-frame budget plus geometry-selected dense keyframes

During Scan, `requestLiveDeepPreview()` does not call the ONNX worker. It only freezes a selected exact RGB frame and enqueues it.

With the default post-scan policy, any ONNX worker left warm by the explicit model test is also terminated at scan start and recreated only after camera/Alva acquisition is frozen. This removes idle WASM/model memory from the fast lane as well as inference compute.

When the user finishes the scan:

1. camera/Alva acquisition stops;
2. the live optimizer is paused;
3. pending MVS is allowed to finish;
4. the Deep queue is drained sequentially;
5. raw relative depth is attached to the original immutable `frameId`;
6. photo edges are re-imported and the session is persisted.

Keyframe jobs are prioritized over survey-only jobs because they contain useful sparse/MVS context.

## 3. `depthPlanned` photos may enter RGB immediately

The project invariant remains intact: a photo may enter the RGB graph only if it already has Depth or is explicitly destined to receive Depth on that exact immutable frame.

V30.45 registers a selected frame as `depthPlanned` immediately after it has been successfully accepted into the bounded Deep queue. It then attempts to register the RGB frame with the existing live photo map through a feature-detected planned-frame API (`addDepthPlannedFrame`, `addCameraFrame`, or `addFrame`). The metric factor graph receives a pose-bearing node immediately when available.

New trace: `rgb-depth-planned-photo`, including `mapRegistered`, `mapMethod`, and `metricGraphNode`.

The scanner also logs `live-map-depth-planned-api` at scan startup so the phone log reveals exactly which planned-frame API the deployed base exposes. No capability is silently assumed.

## 4. Late Depth binding does not move the RGB photo

When Deep returns, `attachLateDepthToPhoto()` first calls `updateRelativeDepth(frameId, ...)` on an already-registered photo. Only if the deployed live-map base could not register a planned frame does it fall back to the older atomic RGB+Depth commit.

Photo placement therefore remains photo-derived. Deep supplies depth for the same frame; it does not create a new photo clock and does not place a photo from Alva.

## 5. No stale online metric calibration

A late Deep map is stored in the factor graph as raw relative depth with `calibration:null`.

V30.45 deliberately does **not** call `DeepSequenceModel.calibrate()` or `calibrateRelativeDepth()` using the capture-time sparse seeds. Those seeds can be stale after global RGB pose refinement. Metric scale/non-linearity is recomputed later by `ProbabilisticJointOptimizer` from the current/final pose scaffold.

New trace: `deep-late-raw-bound` with `metricCalibrationDeferred:true`.

## 6. Bounded exact-frame queue

New `js/dense/deep_late_binding_queue.js`:

- deduplicates by immutable `frameId`;
- upgrades a survey job to a geometry-bearing keyframe job for the same frame;
- never evicts a frame already admitted as depth-planned;
- prioritizes keyframes during post-scan drain;
- exposes queue telemetry.

If the queue is full, a new candidate is rejected **before** being admitted to the planned photo stream.

## 7. Fast-lane diagnostics

The log context now contains:

- `fastLane.frames`
- `fastLane.lastGapMs`
- `fastLane.maxGapMs`
- `fastLane.deepInferenceDuringScan`
- Deep queue counts and in-flight state
- planned/depth-bound photo counts

A long camera cadence gap emits `fast-lane-frame-gap` with current Deep/MVS state. With the default V30.45 policy, `deepInferenceDuringScan` should remain false for the entire acquisition.

Post-scan traces:

- `deep-postscan-drain-start`
- `deep-late-dispatch`
- `deep-frame-sync-ok`
- `deep-late-photo-bound` / `deep-keyframe-photo-late-bound`
- `deep-late-raw-bound`
- `deep-postscan-drain-complete`
- `fast-lane-frozen-deep-bound`

## Safety behavior

V30.44 pose-scaffold, MVS observability, Deep calibration, and final geometry gates remain unchanged. V30.45 changes scheduling and evidence timing; it does not loosen any geometry acceptance criterion.

If the deployed `LivePhotoPuzzleMap` does not expose a planned-frame registration method, the log reports `mapRegistered:false`; pose-bearing RGB frames still enter the factor graph immediately, and late Depth falls back to the existing exact RGB+Depth commit. This limitation is explicit rather than hidden.
