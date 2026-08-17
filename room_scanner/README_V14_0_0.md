# Room Scanner V14.0.0 — Room Cells

V14 is a deliberate simplification of the V12/V13 reconstruction pipeline. It does **not** attempt to continuously solve one global room from depth, planes, meshes and monocular depth at the same time.

The authoritative model is a graph of small local room cells:

`CaptureStation -> RoomCell -> Portal -> next CaptureStation`

Each cell is a rigid vertical prism defined by the floor polygon selected by the user. WebXR provides metric floor points and camera poses. RGB photographs and Depth Anything enrich the already-known cell with height, textures and foreground objects. Cells are aligned rigidly only when a declared opening connects them.

## Acquisition workflow

### 1. Capture station

The user stands at a useful viewpoint, normally near the center of a simple room. In a complex floor plan several stations are created.

The station stores the WebXR camera position and yaw. All floor points of that cell are stored in the station-local XZ frame.

### 2. Local footprint

The user marks the visible floor perimeter of the current volume with the metric WebXR pointer. Corridors or rooms beyond an opening are intentionally ignored at this stage.

The footprint is authoritative **inside that cell**. V14 has no autonomous wall-rotation optimizer.

### 3. Multi-photo panorama

A panorama is represented by normal overlapping WebXR photographs, not by a stitched 360-degree image. Every photograph preserves:

- raw RGB;
- WebXR projection/intrinsics;
- WebXR camera pose;
- optional synchronized CPU depth grid;
- quality score;
- camera yaw;
- per-wall visibility.

A 24-sector coverage ring is shown live:

- red — direction not sufficiently photographed;
- yellow — weak/single coverage;
- green — useful coverage.

This allows a narrow corridor or a long wall to be photographed in several partial views.

### 4. Height

The floor is defined by `local-floor`. The cell height is estimated from RGB geometry against a **known wall plane**.

For candidate heights V14 projects the wall/ceiling junction into the raw camera image and scores local RGB discontinuity. The inferred line is shown directly in the AR overlay.

If automatic evidence is weak, the user taps the real wall/ceiling junction in the image. That pixel gives a WebXR ray; intersecting the ray with the already-known vertical wall gives metric height without requiring a valid depth sample at the ceiling.

Several height samples are robustly aggregated. Height photographs are retained and reused by the Deep/texture batch.

The first V14 release assumes one planar ceiling per cell.

### 5. Portal

To continue through a door/corridor/opening, the user marks the two floor-side borders of the opening. The portal stores an interval along the source wall.

After crossing the opening, the user creates a second capture station and traces the next local footprint.

When the new footprint closes, V14 automatically searches its walls for the surface corresponding to the previous opening using:

- parallelism to the source wall;
- distance to the camera crossing path;
- portal width compatibility;
- which side of the source wall the new station occupies;
- the WebXR pose as a soft prior.

Only a rigid 2D transform `(x, z, yaw)` of the **entire new cell** is solved. No wall inside either cell changes shape.

If only part of a target wall overlaps the source wall, only that shared interval is suppressed as duplicate geometry. The remainder of the target wall is preserved.

### 6. Batch Depth Anything

Depth Anything never runs in the XR frame loop.

For every panorama/height photograph, relative depth is calibrated with:

1. same-frame WebXR CPU depth where available;
2. the known analytic cell shell as a weaker prior.

Direct-relative and inverse-relative affine fits are tested robustly.

For each sampled pixel:

- compatible with the shell -> structural evidence;
- significantly in front -> candidate object geometry;
- significantly behind -> optical/opening evidence; it never expands a wall.

The full Deep map is immediately discarded after classification. Only the small semantic mask and fit statistics remain.

## Objects

Objects are persistent voxelized RGB populations, not empty boxes. XR and Deep foreground evidence is merged in the common scene frame.

A final object component requires either multiple frames or mixed XR+Deep support. V14 stores:

- RGB point population;
- voxel surface mesh;
- oriented bounding box for UI selection and metric dimensions;
- confidence;
- remove/hide state.

The OBB is a UI proxy. The point/voxel population is the primary object geometry.

## Textures

Every wall is a simple parametric surface with its own metric `(u,v)` coordinates. Panorama and height photos are reprojected into an RGB atlas.

Foreground samples identified by WebXR or Deep are excluded, preventing furniture from being baked into the wall texture where sufficient evidence exists.

A linked shared wall may retain texture evidence from both cells in RAW data even when one geometric copy is suppressed.

## Portal height

The user initially marks only the floor interval. During the Deep batch, behind-shell evidence inside that interval is accumulated. When enough samples exist, V14 estimates the upper edge of the opening. Therefore a normal door can keep its lintel while a full-height passage remains open to the ceiling.

## Final representation

The scene is a **cell complex**, not a dense global cloud:

```text
Scene
  Cell C1
    station
    footprint
    height
    walls + textures
    portals
    photos
  Cell C2
    ...
  Portal P1: C1 -> C2
  Objects
```

For rendering/export, source walls are cut by portal rectangles and duplicate shared wall intervals on the linked cell are suppressed. This is intentionally lighter than running a general 3D boolean/TSDF union on the phone.

## Compute policy

Live XR performs only bounded work:

- WebXR pose;
- floor ray intersection;
- raw-camera preview/photographs;
- small CPU depth grids;
- local RGB edge search for height;
- bounded foreground voxel accumulation.

No live Deep, TSDF, Gaussian splatting, global plane solver, ICP or bundle adjustment is present.

Deep, object clustering and texture-atlas generation occur only after XR is stopped.

## Files to deploy

Replace/add:

- `room_scanner_v12.html`
- `v14_cells.js`
- `sw.js`
- `build_info.json`

Keep the existing dependencies unchanged:

- `depth_ai_worker.js`
- `models/depth_anything_v2_small_q4.onnx`
- ONNX Runtime WASM files already referenced by the worker.

The HTML deployment filename intentionally stays `room_scanner_v12.html` so existing GitHub Pages links do not change.

## Verification

Run:

```sh
node --check v14_cells.js
node tests/test_v14_geometry.js
node tests/test_v14_static.js
node tests/test_v14_bootstrap.js
node tests/test_v14_integration.js
node tests/test_v14_audit.js
node tests/test_v14_package.js
```

Physical WebXR/ARCore raw-camera, CPU depth and tracking remain device-only tests.

## Known boundaries

- V14 assumes a planar floor from `local-floor` and one planar ceiling per cell.
- Portal detection on the **new** cell is automatic, but the source opening is deliberately declared by the user to avoid fragile semantic doorway detection.
- The exported geometry is a registered cell complex with duplicate shared intervals removed. It is not a general-purpose exact polygon/solid boolean engine for arbitrary overlapping free-form cells.
- Mirrors/windows/transparent regions are protected from changing the shell by behind-shell classification; V14 does not attempt a heavy semantic material classifier.
