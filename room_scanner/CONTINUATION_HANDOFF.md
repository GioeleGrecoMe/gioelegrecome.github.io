# Room Scanner project continuation handoff

## Project goal

Build a browser/WebXR room scanner for an acoustic digital twin. The output should be a **closed metric room shell** (walls, floor, ceiling) with visually useful surface textures, plus **separate internal 3D objects** that can be selected/hidden/removed to expose the bare room. The eventual acoustic workflow will characterize surfaces/material groups from video/audio measurements, so stable explicit surfaces are more important than photorealism.

The target hardware is a normal ARCore-capable phone. Robustness, bounded memory/CPU, diagnostics and user-verifiable geometry are preferred over automatic but fragile dense reconstruction.

## User engineering preferences

- Expert-programmer approach.
- Offline-capable where feasible.
- Debug-friendly comments and diagnostics.
- Deliver complete downloadable artifacts, preferably `.tar.gz`.
- Do not paste the large HTML into chat; provide files/packages.
- Keep the deployed page filename `room_scanner_v12.html` unless deliberately migrating the repository.
- Never introduce a second camera stream. Raw RGB must come from the WebXR camera; do **not** use `getUserMedia`, `navigator.mediaDevices`, `ImageCapture`, etc.
- Depth Anything/ONNX should run **after** live XR, not concurrently with tracking.

## Critical WebXR lessons already learned

### Session request / user activation

Stable acquisition originally came from V12.0.2. Keep one `requestSession()` in the direct user-activation path. Do not request a feature-rich session, await/retry and then request again; this previously caused `The requested session requires user activation`.

`camera-access` is required. Depth is optional. Plane/mesh features must not be architectural requirements.

### Raw-camera XRFrame lifetime

V14.0.0 regressed by calling `XRWebGLBinding.getCameraImage()` from the photo button after the XR animation callback had returned. Chrome correctly threw:

`Failed to execute 'getCameraImage' on 'XRWebGLBinding': XRFrame access outside the callback that produced it is invalid`

V14.0.1 and later use the correct pattern:

1. UI/AutoSurvey queues `S.captureRequest` only.
2. The **next valid `XRSession.requestAnimationFrame()` callback** calls `readCameraRGBA(view, ...)` and `sampleDepthGrid(frame, view)` and copies projection + pose from that same frame.
3. The callback resolves a plain snapshot.
4. JPEG encoding, quality analysis and frame-list bookkeeping happen after the callback.

Do not violate this rule again.

### Same-session movement

The scanner should permit walking/moving **within the same `immersive-ar` session**. Movement is useful for ARCore/depth and for actual multi-view object evidence. The old behavior that ended XR after each room was a workflow bug.

Do not assume a new XR session is automatically metrically aligned to the previous `local-floor` reference. V14.1 therefore keeps one active XR session across all cells and treats emergency interruption as terminal for the current metric acquisition.

## Lessons from previous architectures

### V12.1.x

Tried increasingly complex global reconstruction: XR TSDF/signed-ray volumes, Deep TSDF, surfels, planes, local correction fields, structural scoring, room closure and transactional batch processing. It produced useful techniques but became too heavy and had multiple competing geometry authorities.

Useful retained ideas:
- Depth Anything is relative and needs metric calibration.
- Same-view XR depth is a strong anchor.
- Deep should never excavate/free-space-author the metric shell.
- Structural RGB and object RGB are useful, but dense global point fusion is not the desired final model.
- Batch processing and explicit memory budgets are essential.

### V12.2.x

Moved to user-guided floor footprint and wall surfaces. Added textures, optical/outlier handling, object residuals, multi-view corner anchoring and WebXR surfels. This was better but wall/corner refinement still accumulated too many heuristics; walls could visibly move/rotate during later phases.

### V13

Attempted a clean global authoritative shell with multi-view corner bundle adjustment and one room anchor. Mathematically cleaner, but still too complex for the practical UX/hardware target. User explicitly rejected further complexity.

### V14 Room Cells

Accepted architecture: **local simple cells + rigid portal registration**.

A capture station sees one local room region. User traces the visible local floor footprint and intentionally ignores corridors/areas beyond openings. That footprint is authoritative in the cell. A complex room/apartment becomes a graph of cells connected by declared portals or overlaps.

Individual walls in a cell never independently rotate. New cells are aligned to prior cells through a rigid SE(2) transform `(x,z,yaw)` only.

## Current architecture: V14.1.0 Room Cells AutoSurvey

### Primary entities

`CaptureStation`
- camera/world position and yaw at the chosen station.

`RoomCell`
- local footprint polygon selected by user;
- local floor `y`;
- one planar ceiling height in current V14;
- walls generated deterministically from footprint edges;
- station;
- global rigid transform;
- panorama coverage;
- wall coverage grids;
- photos;
- survey state.

`Portal`
- source cell + source wall;
- interval `[s0,s1]` along the source wall;
- optional/inferred top height;
- linked target cell/wall;
- acts as graph edge and shell cutout.

`ObjectCluster`
- persistent RGB voxel population from XR and/or Deep;
- point cloud is the real geometry;
- OBB is an interaction/measurement proxy only;
- optional voxel surface mesh for OBJ/viewer.

### Authoritative shell rule

Inside a cell, the user footprint is authoritative. Deep, XR point evidence and object reconstruction **must not rotate or reshape those walls**. Cell-to-cell registration may move the entire target cell rigidly.

### Current single-session workflow

1. Press Start XR once.
2. Choose capture station.
3. Trace local visible floor footprint.
4. Close footprint.
5. AutoSurvey rotation stage runs.
6. AutoSurvey short parallax stage runs.
7. If height confidence is weak, photograph/tap a wall-ceiling junction.
8. Cell is ready.
9. Mark portal/opening using two floor points on the wall.
10. Walk through portal while XR remains active.
11. Press `Nuova stazione`, choose next station, trace its local footprint.
12. Repeat steps 4-11 for all cells.
13. Only then press `Termina intera scansione`.
14. Run Deep batch.
15. Review shell/textures/objects and export.

`Interrompi XR` is an emergency action with confirmation. It must not be the normal way to finish a room.

## AutoSurvey design

### Why

Manual "take a 360 panorama" was ambiguous and produced too few/non-diverse frames for objects.

### Rotation stage

- 24 angular panorama sectors.
- Find the weakest sector.
- Guide user with arrow left/right toward it.
- Ask user to raise/lower if pitch is too large.
- Estimate angular and linear device motion from consecutive camera poses.
- Show `RALLENTA` until stable.
- Show `FERMO` and automatically queue a synchronized WebXR capture.
- Repeat until angular and wall-surface coverage are adequate.

### Parallax stage

After rotation coverage:
- generate up to 3 short movement targets, about 0.38 m from the station when the footprint permits;
- targets must remain inside the footprint and not too close to walls;
- guide user toward target with arrow/distance;
- once reached, ask user to point toward the weakest wall;
- stop/stabilize and auto-capture.

This creates true spatial baselines without requiring a heavy live mapper.

### Capture semantics

The auto guide never calls raw-camera APIs itself. It only queues `capturePanorama(mode)` -> `captureFrame()` -> `S.captureRequest`. The XR callback fulfills the request with synchronized camera/pose/depth data.

## Furniture / object reconstruction

The shell is known. For an XR/Deep observation, compare observed depth to analytically rendered cell-shell depth along the same ray.

- near shell => structural/texture evidence;
- significantly closer than shell => foreground/object evidence;
- significantly behind shell => optical/opening/outlier evidence; must not expand the shell.

Object voxels are currently about 5.5 cm. `objectMaxVoxels` is bounded.

### Critical persistence fix in V14.1

Do not use timestamps as view identities. Older code could make the same stationary evidence look multi-view simply because time changed.

`spatialViewId(worldFromView)` quantizes camera position. Repeated frames from the same physical location share the same view ID. A voxel is retained by connected-component extraction when:
- it has at least 2 distinct spatial view IDs, **or**
- XR and Deep both support it.

Deep frame IDs also use the same spatial view cluster.

### Why parallax matters

Object shape cannot be recovered reliably from several rotational frames taken at exactly the same camera center. The guided short translations are specifically intended to create geometric baseline while staying within a simple local cell and the same XR map.

## Depth Anything policy

Depth Anything is batch-only after XR finalization.

It provides relative depth. Current V14 core uses robust direct/inverse affine fitting to metric anchors; the shell and same-view XR depth constrain the metric conversion. Deep never defines wall orientation.

AutoSurvey creates more images, so select only a bounded subset per cell for Deep:
- Fast: max 7;
- Balanced: max 9;
- High: max 12.

Priority:
1. height frames;
2. parallax frames;
3. high-quality, directionally/spatially diverse rotation frames.

All useful photos can still contribute to wall texture even if not selected for Deep.

Full Deep maps should be released (`k.deep=null`) after classification.

## Height and ceiling

Current V14 assumes one planar ceiling height per local cell.

Prefer automatic height from an image in which a known wall shows the wall-ceiling junction. The wall plane is already metric from the footprint. The image edge supplies a ray; ray-wall intersection determines metric height without requiring the edge pixel itself to have correct depth.

If automatic confidence is weak, show the inferred line overlay and ask the user to tap the actual wall-ceiling junction. Height photos are also useful for texture and Deep.

Do not silently make the architecture dependent on Deep metric depth for room height.

## Portal / cell merge policy

The user declares a source opening. The next cell is independently traced. The code automatically searches target walls compatible with the source portal and estimates a rigid target-cell transform.

Do **not** deform either cell to force a match.

If cells share only part of a wall, suppress only the duplicated target interval, not the entire wall. The source wall remains a real wall with the portal cutout. Deep can refine the portal top (door lintel vs full-height passage) from persistent behind-shell evidence.

## Texture policy

Each wall has metric `(s,h)` coordinates. Multiple photographs project to a per-wall atlas. Prefer better/front-facing/clearer observations. Foreground/object pixels should not be baked into the wall texture when sufficient depth evidence identifies them. Optical regions may contribute RGB while their depth is rejected.

The final model is surface-and-texture oriented, not a dense structural point cloud.

## Viewer / exports

- Orthographic/isometric viewer to avoid perspective distortion.
- Bare-room mode hides all internal objects without changing the model.
- Objects can be hide/remove/restore.
- RAW stores cells, portals, frames, coverage, texture/object state.
- PLY primarily represents active object RGB clouds.
- OBJ contains cell shell geometry plus active voxel object meshes.

## Device/performance boundaries

Live WebXR should remain restricted to:
- camera pose;
- floor pointer;
- raw RGB copy only when needed;
- small optional depth samples;
- simple coverage/motion calculations.

Never run live:
- Depth Anything;
- global TSDF;
- global ICP;
- Gaussian optimization;
- continuous connected-components clustering;
- complex wall/plane fitting.

Connected components/OBBs are built on demand or during batch.

## Current V14.1 important config

- RGB capture long edge: 720 px
- XR saved depth grid: 28 x 16
- panorama bins: 24
- stable hold: ~300 ms
- min gap between auto captures: ~850 ms
- parallax radius: ~0.38 m
- parallax reach tolerance: ~0.14 m
- up to 3 parallax targets
- wall coverage: 18 x 10
- Deep classification grid: 54 x 36
- object voxel: ~0.055 m
- max object voxels: 42000
- max total saved frames: 84

These are phone-oriented budgets; tune only after real-device profiling.

## Bugs already fixed - do not regress

1. Two `requestSession()` calls / retry after user activation.
2. Optional raw-camera permission allowing XR session but no camera frames: `camera-access` must be required.
3. Concurrent `ensureDepth()` lifecycle terminating a worker another call was using.
4. Wrong worker call signature (`workerRequest(S.worker,'infer',...)` required in old architecture).
5. `getCameraImage()` outside XR rAF callback.
6. UI click path using stale XRFrame/current view.
7. Session ending after every room.
8. Timestamp-based fake multi-view persistence.
9. Deep processing silently ending an incomplete XR scan.
10. Heavy Deep/ONNX execution during ARCore tracking.

## Things deliberately rejected

Do not casually reintroduce these without a new explicit design decision:
- global TSDF reconstruction;
- continuously changing global floor plan;
- free wall rotations from XR point populations;
- dense Deep meshes as structural geometry;
- global Gaussian Splatting optimization;
- a semantic neural network merely to separate wall/furniture;
- one XR anchor per wall;
- second camera stream;
- multi-session metric continuation pretending reference spaces are identical.

## Recommended next physical tests

### Test A - multi-room session lifecycle

Room + narrow corridor.
- Start XR once.
- Complete cell A AutoSurvey.
- Mark portal.
- Walk through without exiting XR.
- Add cell B.
- Confirm cell A stays unchanged and XR remains active.

### Test B - AutoSurvey usability

Simple rectangular room.
- Follow arrows without manual photos.
- Verify turn / raise-lower / slow / STOP cues are understandable.
- Confirm automatically captured frames span directions and at least 2-3 spatial positions.

### Test C - furniture persistence

Place chair/cabinet in front of a wall.
- Rotation-only frames should not immediately create a high-confidence object.
- Short parallax frames should add distinct `viewCluster`s.
- Final object should contain a colored point population, not just an empty box.

### Test D - narrow corridor

One wall cannot fit in one image.
- Multiple partial views should increase wall coverage.
- Deep frame selection should preserve parallax and directional diversity.
- Wall shell must remain authoritative.

## Failure diagnosis order

When something goes wrong, diagnose in this order instead of adding a new global optimizer:

1. Was the local footprint traced correctly?
2. Is the same XR session still active?
3. Did synchronized frames contain correct pose/projection/raw RGB/depth?
4. Does portal rigid registration choose the correct target wall?
5. Is the wall/angle coverage sufficient?
6. Do object voxels have genuinely distinct spatial view clusters?
7. Does Deep agree with XR/shell foreground classification?
8. Is texture projection masking foreground correctly?

Only after these checks consider new algorithms.

## Current deploy files

V14.1 package should contain:
- `room_scanner_v12.html`
- `v14_cells.js`
- `sw.js`
- `build_info.json`
- docs/tests/handoff files

The repository must already contain and keep:
- `depth_ai_worker.js`
- Depth Anything Q4 ONNX model(s)
- ONNX Runtime JS/WASM assets

Current version: **14.1.0 - Room Cells AutoSurvey**.
