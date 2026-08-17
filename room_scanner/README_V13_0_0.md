# Room Scanner V13.0.0 — Rigid Room Model

V13 is a clean architectural rewrite of the V12 guided scanner. The central rule is:

> The room is a rigid low-dimensional model. WebXR, RGB, mesh/depth and Depth Anything are observations with confidence; no single observation owns or freely rotates a wall.

The deployment filename remains `room_scanner_v12.html` so existing GitHub Pages links do not need to change. V13 adds the pure helper file `v13_geometry.js`.

## Authoritative geometry

The room shell is represented by:

- one 2D polygon of floor corners `P_i = (x_i, z_i)`;
- one floor elevation (`local-floor`, normally y = 0);
- one robust ceiling height;
- walls derived *only* from adjacent corner lines.

A wall has no independent free rotation parameter. Floor, ceiling and walls are generated analytically, so the ROOM_SHELL is closed by construction.

## Corner anchoring

Each corner is a vertical line. The user can add observations from multiple camera positions at three levels:

- BASE — constrains the corner and intersects the ray with the floor plane;
- CENTRO — constrains the XZ vertical line without assuming a height;
- TETTO — constrains the same XZ line and contributes to ceiling height.

Observations are accumulated, never overwritten. View identity is spatial: repeated taps from essentially the same camera position share one view ID and cannot satisfy the multi-view gate. A corner requires physical camera displacement and angular baseline in addition to low residual. The robust solver alternates corner-line estimation and ceiling-height estimation, rejects inconsistent rays and reports view count, baseline and residual.

The first V13 release assumes one planar ceiling. Metric acquisition cannot advance until TOP anchors have been collected on at least two distinct corners with a consistent ceiling-height estimate; a silent 2.7 m default is not accepted as a completed room volume.

When tracking is lost while looking at a low-feature ceiling, the last valid raw-camera frame remains a visual guide. No metric observation is accepted until WebXR tracking returns.

## Optional single RoomAnchor

If the runtime exposes WebXR Anchors, V13 creates one room-level anchor near the first corner. It is used only as a rigid transform for the whole room. When ARCore updates its map, the entire model may move rigidly in the XR reference frame; individual walls do not deform.

If anchors are unavailable, V13 falls back to `local-floor`.

A metric scan is deliberately single-session. Once the XR session containing a non-empty room model is ended, V13 does not open a second session and pretend that its new reference space is the old one. The existing model can still be processed, reviewed and exported; additional metric acquisition requires a new scan/reload.

## Phase 3: WebXR evidence, not geometry rebuilding

During the XR refinement pass the shell remains frozen. V13 samples a small CPU depth grid and opportunistically samples XR mesh vertices. It accumulates:

- per-wall signed residuals;
- per-wall persistent RGB evidence;
- XR coverage;
- structural points snapped onto the authoritative surfaces;
- foreground voxels inside the room for future objects.

There is no live TSDF, no ray-carving volume, no automatic plane reconstruction and no live Deep inference.

`Ricalcola geometria` may move each wall only in parallel to itself. The allowed shift is smaller when its two adjacent corners are strong. After applying a shift, existing residuals are rebased so the same evidence cannot be applied twice.

## Photos and Deep coverage

Each wall owns a metric `(u,v)` coverage grid. Several partial photographs from different positions can cover one wall; a corridor therefore does not require a single complete image.

- red: insufficient coverage;
- yellow: partial/weak coverage;
- green: sufficiently observed.

The screen tint also evaluates current view angle, distance and wall visibility.

Depth Anything runs only after WebXR is stopped. For every wall photo, relative depth is metrically calibrated with:

1. synchronized XR depth from that frame;
2. persistent XR wall anchors;
3. a weak rigid-shell prior.

Both direct-relative and inverse-relative affine mappings are tested robustly. Foreground samples become candidate objects; samples consistent with the shell are snapped to the shell; samples behind the shell are treated as optical/opening evidence and cannot expand the room.

The full Deep map is discarded after classification. Only a small semantic mask, fit parameters and statistics are retained to reduce RAM.

## Objects

Objects are not represented by empty boxes. The primary geometry is a persistent voxelized RGB point population combining XR and Deep observations. A cell must be supported from at least two distinct frames/views before it can form a final object component.

For every object V13 computes:

- RGB point cloud;
- voxel surface mesh for OBJ export;
- oriented bounding box (OBB) for UI selection and metric dimensions;
- XR/Deep evidence counts and confidence.

`Stanza nuda` hides objects without modifying the model. `Rimuovi` excludes an object from active exports.

## Textures

Each wall remains a simple planar surface. Its appearance is stored in a per-wall RGB atlas. Candidate wall photos are projected into wall coordinates. Foreground pixels are masked using synchronized XR depth and the Deep semantic mask. Persistent XR RGB wall cells provide fallback color and weak photometric regularization. Optical/window/mirror-like regions may contribute RGB but do not alter wall geometry.

## Mobile-compute policy

Live WebXR performs only bounded operations:

- pose / optional RoomAnchor update;
- small 24 x 14 depth sampling every ~430 ms;
- sparse mesh sampling;
- local edge guidance around selected corners;
- bounded wall evidence and object voxels.

Object clustering, voxel meshing and all Depth Anything inference are deferred until requested or until the batch stage. Object evidence is capped at 42,000 voxels. Interior XR surfaces separated from the shell are classified as object evidence before the wider wall-refinement gate, so furniture close to a wall is not silently swallowed into wall statistics. Photo count is capped at 80 frames; diagnostic corner photos are pruned before wall photos.

Texture generation is also profile-bounded. Rapida/Bilanciata/Alta use progressively larger atlases and the atlas loop yields periodically to the browser event loop so a weak device is not blocked by one long wall-texture pass.

## Viewer and exports

The scene viewer is orthographic/isometric. It displays the analytic closed shell, per-wall textures, optional snapped XR evidence, actual object point populations and optional OBB proxies.

Exports:

- RAW JSON — V13 geometry, photos, compact Deep masks, wall textures and object geometry;
- PLY — snapped structural XR points plus active object RGB points;
- OBJ — closed analytic shell plus voxel-surface meshes of active objects.

Imported RAW files are review/export artifacts. V13 intentionally does not resume metric XR acquisition from an imported RAW because a browser session cannot restore the previous physical RoomAnchor localization reliably.

## Deployment

Upload/replace:

- `room_scanner_v12.html`
- `v13_geometry.js`
- `sw.js`
- `build_info.json`

Keep the existing dependencies unchanged:

- `depth_ai_worker.js`
- `models/depth_anything_v2_small_q4.onnx`
- the existing ONNX Runtime WASM files referenced by the worker.

## Verification

Run from this folder:

```sh
node --check v13_geometry.js
node tests/test_v13_geometry.js
node tests/test_v13_static.js
node tests/test_v13_bootstrap.js
node tests/test_v13_package.js
node tests/test_v13_audit.js
```

Physical WebXR/ARCore tracking, camera permission, CPU depth, XR mesh and optional anchors must still be validated on the target Android device.
