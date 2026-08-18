# V20.2.4 Architecture

## Design invariants

The following invariants are intentional and should be preserved in subsequent revisions.

### Metric authority

- WebXR `local-floor` is the metric authority inside one immersive segment.
- Monocular depth may densify and shape local surfaces only after metric calibration to XR depth, stable surfels or structural intersections.
- Segment registration may estimate yaw and translation but never an independent scale.
- Failed registration leaves a segment separate.

### XR lifecycle

- `requestSession()` is issued directly from the user gesture path.
- Raw camera access is confined to an active XR animation frame.
- The XR animation frame performs bounded sampling and queueing only.
- The exit path never starts Deep, reconstruction, FFT, ZIP creation, reload or navigation.
- Large binary payloads are persisted incrementally as Blob/ArrayBuffer records.
- `session.end()` is called once; cleanup follows the XR `end` event.
- Waiting for pending work is bounded. Diagnostic events record anything abandoned.

### Storage

IndexedDB stores independent append-only entities:

- `sessions`: small session summaries and state;
- `records`: poses, depth metadata, frame metadata, chirps, markpoints and grid snapshots;
- `blobs`: JPEG, compact depth, PCM and generated assets;
- `events`: diagnostics and state transitions;
- `models`: restartable reconstruction/acoustic products.

No full-session base64 snapshot is created. A crash can lose the last small in-flight batch, not the complete capture.

## Capture pipeline

### Pose stream

Viewer pose samples are packed into small chunks. Each sample includes segment ID, monotonic timestamps, position, orientation, motion estimates and tracking status.

### Metric depth

CPU WebXR depth is sampled sparsely. Points are transformed to world space immediately and packed in `RSPT v1` relative to the camera origin:

- signed millimetre XYZ offsets;
- compact normal;
- RGB when available;
- confidence/source flags.

The format uses 14 bytes per point and preserves the relationship to the source frame and pose.

### RGB keyframes

A keyframe is requested by one or more of:

- weak/red/yellow grid cells in view;
- a markpoint request;
- sufficient viewpoint novelty;
- explicit user action.

Only a low-resolution readback is attempted in XR. Encoding and storage are task-tracked and bounded. Failure disables camera readback without ending the metric capture.

### Adaptive metric grid

The online map worker maintains bounded surfel cells and projects quality tiles onto estimated local tangent planes.

Each tile stores:

- center, tangent basis, normal and metric extent;
- observation support and source mix;
- position variance and normal resultant;
- distinct view origins, baseline and parallax;
- frame references and photo quality;
- structural/object/edge classification;
- Deep request status;
- red/yellow/green state and reason codes.

Object and edge tiles are finer than broad planar tiles. Stable tiles propagate neighboring predicted targets, including floor and ceiling. Predicted cells remain red until observed and are pruned if unsupported for too long.

### Markpoints

A markpoint candidate combines RGB patch statistics, local geometry and view context. A valid mark should be:

- visually distinctive, preferably saturated and textured;
- sharply imaged and not clipped;
- geometrically stable;
- sufficiently separated from existing marks;
- confirmed in more than one view when possible.

Descriptors are compact; original supporting frames remain linked in RAW.

### Acoustic observations

The AudioWorklet writes bounded Int16 chunks directly to the persistence queue. Chirp records refer to expected microphone frames and browser/audio timing observations. Capture never retains the entire recording as a single in-memory buffer.

## Safe exit state machine

```text
CAPTURING
  -> EXIT_REQUESTED
  -> STOPPING_PRODUCERS
  -> XR_END_REQUESTED
  -> XR_ENDED
  -> RESOURCES_RELEASED
  -> CAPTURE_SAVED
```

Any timeout is recorded and the state machine continues toward `CAPTURE_SAVED`. Reconstruction is not a state in this machine.

## Processing pipeline

Processing occurs in a separate page and worker.

1. Replay append-only records and validate references.
2. Register metric segments through validated markpoints.
3. Decode and transform compact metric batches.
4. Apply topology-aware incremental decimation.
5. Calibrate and merge optional monocular depth per frame.
6. Estimate floor and ceiling using gravity and robust height support.
7. Extract wall planes from vertical surfels; merge compatible coplanar patches.
8. Infer room cells/openings from plane support and trajectory connectivity.
9. Cluster persistent residual geometry into RGB object surfaces.
10. Build an acoustic-ready surface graph with stable IDs.
11. Optionally analyze RIR windows and associate relative reflections probabilistically.

### Intelligent decimation

The decimator is not uniform random sampling. It allocates budget according to:

- local curvature/normal discontinuity;
- plane boundaries and openings;
- low-support but repeatable regions;
- object evidence;
- markpoint neighborhoods;
- photo and RIR relationships;
- spatial occupancy quotas.

Redundant points from nearly identical poses are merged first. Representative points retain accumulated source-frame IDs, view counts and confidence statistics.

## Failure containment

- A failed RGB frame does not stop depth/pose/audio.
- A failed Deep inference does not invalidate WebXR geometry.
- A failed acoustic analysis leaves PCM and chirp records exportable.
- A failed segment registration does not corrupt registered segments.
- A failed processing run does not modify capture records; models are versioned outputs.
- A renderer loss after XR still leaves previously committed records recoverable on next page load.
