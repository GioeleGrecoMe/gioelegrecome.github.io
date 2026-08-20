# V30.15.0 — AlvaAR dense room mapping

## Architectural change

V30.15 removes sparse-feature triangulation as the primary geometry source.
AlvaAR remains the only camera/world tracker. Dense reconstruction is now a
separate low-frequency pipeline:

1. AlvaAR tracks the camera and emits persistent poses/keyframes.
2. `DenseKeyframeManager` keeps at most 8 downsampled local keyframes and
   selects 2–4 geometrically useful neighbours for a reference view.
3. `dense_depth_worker.js` estimates a dense depth map with a pose-guided
   multi-view plane sweep. Low-texture pixels, ambiguous depth minima and
   locally inconsistent depth are rejected rather than filled.
4. `dense_fusion_worker.js` merges depth samples into multi-view surfels and a
   sparse TSDF. One-view floaters are not displayed as surface splats.
5. Live splats are generated only from confirmed surfels. They are a rendering
   of the reconstructed surface, not the reconstruction authority.
6. The live/review mesh is extracted from the sparse TSDF with marching
   tetrahedra and is registered to the same Alva pose used by tracking.

## Mobile budget

- Alva tracking remains on the normal analysis loop.
- Dense keyframes: 160×240, maximum 8 resident images.
- Dense jobs: one worker job at a time.
- Source views: normally 3, reduced to 2 on slower devices.
- Pixel step: starts at 3 and automatically increases up to 5 if a dense job
  exceeds the runtime budget.
- TSDF and surfel maps are sparse and capped explicitly.

## Depth Anything fallback (not enabled)

Depth Anything is deliberately not part of the V30.15 runtime path. If pure
multi-view stereo is insufficient on textureless walls, the intended fallback
is to run the already available lightweight model on only a small number of
selected keyframes, use its relative depth solely to narrow/seed the plane-sweep
search interval, and keep Alva poses + multi-view consistency as the geometry
authority. It must never run on every camera frame or replace Alva tracking.
