# Room Scanner V14.1.0 - Room Cells AutoSurvey

V14.1.0 keeps the deliberately simple **Room Cells** model from V14, but fixes the acquisition workflow so a complete multi-room scan remains inside **one WebXR `immersive-ar` session**.

## Core idea

A complex environment is represented as a graph of simple local cells. For each capture station the user traces the visible floor footprint. That footprint is authoritative inside the cell; individual walls are never rotated by Deep or by a point-cloud optimizer. Portals connect cells and the next cell is registered rigidly in SE(2): X, Z and yaw only.

## V14.1 acquisition workflow

1. Start WebXR once.
2. Set capture station and trace the local visible footprint.
3. Close the footprint. AutoSurvey starts automatically.
4. **Rotation stage:** follow the on-screen arrow. Slow down when requested. When the direction and device motion are stable, the display says `FERMO` and a synchronized WebXR photograph is captured automatically.
5. **Parallax stage:** after adequate angular coverage, follow 2-3 short in-footprint movement targets (roughly 30-40 cm where geometry permits). Stop and look at the requested weak wall; another synchronized frame is captured automatically.
6. If height is not reliable, capture a wall that visibly connects floor to ceiling. The image overlay shows the inferred wall/ceiling line and the user can tap the actual line.
7. Mark an opening, walk through it while WebXR remains active, choose the next capture station, and repeat.
8. Press **Termina intera scansione** only after all cells are acquired.
9. Run Depth Anything in batch.

`Interrompi XR` is an emergency exit. An interrupted session is not silently restarted as though a new `local-floor` reference space were identical.

## Synchronized raw-camera capture

A DOM click or AutoSurvey event never calls `XRWebGLBinding.getCameraImage()` directly. It only queues a capture request. The next valid `XRSession.requestAnimationFrame()` callback copies the raw-camera pixels, projection, pose and optional depth grid from the same XR frame. JPEG encoding and quality analysis happen after the callback. This is required because XR frame-scoped camera access is invalid outside the callback that produced the `XRFrame`.

## Object evidence

The shell remains simple and closed. Evidence significantly in front of the shell is accumulated into ~5.5 cm RGB voxels. Persistence uses **spatial view clusters**, not timestamps: repeated frames from nearly the same camera position count as one view. A voxel is retained when it is supported from multiple spatial baselines or when XR and Deep agree. Connected components become colored point clouds with an OBB proxy; the box is not the object geometry.

## Deep processing

Depth Anything remains batch-only after XR is finished. To bound phone workload, per-cell Deep frame counts are capped by quality profile:

- Fast: 7 frames/cell
- Balanced: 9 frames/cell
- High: 12 frames/cell

Height frames and parallax frames have priority, followed by directionally/spatially diverse panorama frames. All useful photographs may still contribute to wall textures.

## Deployment

Replace/add:

- `room_scanner_v12.html`
- `v14_cells.js`
- `sw.js`
- `build_info.json`

Keep the existing repository copies of `depth_ai_worker.js`, the Depth Anything Q4 ONNX model and ONNX Runtime/WASM assets. Then hard-refresh/reopen the GitHub Pages application and confirm the badge reads **V14.1.0 · Room Cells AutoSurvey**.

## Important limits

- Do not introduce a second camera stream (`getUserMedia`, `ImageCapture`).
- Do not run Deep while WebXR is active.
- Do not reintroduce global TSDF, free wall rotations, global ICP, or continuous point-cloud wall fitting.
- Movement is encouraged only inside the same active XR session and is deliberately short during AutoSurvey.
- If WebXR tracking is lost, no synchronized capture is accepted until tracking is valid again.
