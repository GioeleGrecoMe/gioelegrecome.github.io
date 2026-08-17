# Audit — Room Scanner V13.0.0

## Why a clean rewrite

V12 accumulated several partially overlapping geometry authorities: ray/TSDF evidence, native surfels, snapped surfels, Deep surfels, semantic observations, detected planes/meshes, guided wall evidence and corner anchors. Even when individual subsystems were correct, more than one subsystem could cause a structural rebuild. The resulting model could visibly move or rotate while new observations arrived.

V13 removes that ambiguity. The only structural authority is the rigid room model: floor polygon + ceiling height. Walls are derived from adjacent corners.

## Removed from the main path

- `RayEvidenceVolume` and global signed-ray/TSDF reconstruction;
- Deep structural point-cloud fusion;
- autonomous `rebuildStructure()` during XR;
- free plane-normal optimization per wall;
- continuous object clustering during XR;
- live ONNX/Depth Anything while ARCore is running.

## Robustness invariants

1. A single XR/Deep observation cannot directly modify a wall.
2. Corner observations accumulate; they are never overwritten by the latest click.
3. BASE/CENTRO/TETTO all constrain one vertical corner line.
4. A wall direction is fixed by its authoritative line; XR refinement is parallel-only.
5. Strong adjacent corners reduce the maximum wall translation.
6. After a wall shift, old residuals are rebased; repeated recalculation cannot re-apply the same offset.
7. Tracking loss never creates a new metric observation.
8. One optional RoomAnchor transforms the entire model rigidly; there is never one independent anchor per wall.
9. Deep is batch-only and cannot expand the shell.
10. The shell mesh is generated analytically and must be closed.
11. Corner view IDs are based on camera position; repeated clicks from the same place do not count as multiple views.
12. The completed shell requires measured TOP anchors on multiple corners; the default ceiling height is never silently accepted as final.
13. A metric model never continues across a new XR session without relocalization.
14. Interior surfaces farther than the shell/object gap become object evidence before wall evidence.
15. Undoing a wall refinement restores both the previous shell and the previous residual coordinate system.

## Device-bound design

Live processing is bounded to sparse depth/mesh sampling and local image-edge guidance. Wall evidence uses fixed 2D grids. Structural points are voxelized. Foreground object evidence is capped. Deep maps are discarded after conversion to a compact semantic mask.

This deliberately prioritizes stable tracking and deterministic geometry over dense reconstruction.

## Automated checks

The package includes deterministic tests for:

- multi-view BASE/CENTRO/TETTO corner recovery;
- robust corner recovery with an outlier view;
- ceiling-height recovery;
- concave closed ROOM_SHELL;
- parallel-only wall refinement and exact normal preservation;
- robust relative-to-metric Deep affine fit;
- coverage union from multiple partial photos;
- persistent XR+Deep object population and voxel surface mesh;
- no legacy TSDF/ray-volume code;
- exactly one `navigator.xr.requestSession()` call;
- no `getUserMedia`, `ImageCapture` or `setInterval` path;
- no Deep inference from `onXRFrame()`;
- unique DOM IDs and function declarations;
- full application bootstrap under a mocked DOM;
- app-level object-vs-wall precedence for furniture close to a wall;
- spatial corner-view clustering;
- undo/rebase consistency after wall refinement;
- memory bounds, Deep-map disposal and metric-coverage warning hooks.

The physical ARCore/WebXR path remains device-only and cannot be certified by Node/headless tests.

## Final source audit

Final frozen build: 101,011 bytes HTML + 26,050 bytes pure geometry core; 149 named HTML functions and 59 named geometry functions, with no duplicate declarations. The DOM contains 78 unique IDs and 37 unique direct listeners. Static checks find one `navigator.xr.requestSession()`, zero `getUserMedia`, zero `ImageCapture` and zero `setInterval`.
