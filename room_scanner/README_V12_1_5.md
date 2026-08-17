# Room Scanner V12.1.5 — Persistent Structural Semantics

V12.1.5 changes the role of Depth Anything in the reconstruction pipeline. WebXR remains the metric authority and the acquisition path stays compatible with the stable V12.0.2 flow. Deep no longer contributes independent global wall sheets. Instead it is treated as per-view evidence that must attach to persistent global structural primitives or remain in a separate non-structural residual.

## Core invariant

A Deep sample can end in only one of these states:

1. **Structural evidence** — it is assigned by the camera ray to one global wall/floor/ceiling surface and is projected onto the refined shared primitive.
2. **Residual evidence** — it is geometrically coherent inside the room but does not belong to the structural shell; it may later populate an internal object.
3. **Candidate/rejected** — insufficiently supported or contradicted by XR/free-space evidence.

A single Deep image cannot create an authoritative wall. A new Deep-only wall candidate requires persistent support from at least three views and remains non-authoritative for admitting further Deep points.

## Processing order

The explicit **Processa modello** batch now runs top-down:

```text
XR evidence
  -> initial XR-only structural surfaces
  -> initial room shell
  -> per-photo Depth Anything inference / metric optimization
  -> semantic ray assignment: structure vs residual
  -> shared structural refinement (normal locked)
  -> projection of structural Deep evidence onto global primitives
  -> promotion of persistently confirmed missing shell faces
  -> residual voxel population / persistent object components
  -> final closed ROOM_SHELL + internal objects
  -> atomic model commit
```

The final viewer is still shown only after the complete batch commits.

## Why this fixes duplicated / rotated Deep walls

If three photos see the same wall, their monocular depth maps may imply three slightly different slopes. V12.1.4 could still preserve too much of these local sheets. V12.1.5 instead associates all compatible samples with the same global `Surface` object.

For a structural surface, the normal is locked to the global XR/structural estimate. Deep may only provide a robust bounded correction of plane offset and finite support/extent. After refinement, structural Deep points are reprojected exactly onto that shared surface. Therefore three views do not create three nearly coincident walls.

## Structural semantics without another neural network

The structural/non-structural split is geometric and persistent rather than object-classification based.

A wall/floor/ceiling candidate is scored using:

- XR provenance and confidence;
- finite planar support;
- persistence across keyframes;
- vertical/horizontal orientation relative to the XR floor frame;
- height/area compatibility;
- participation in the room boundary;
- camera/free-space consistency;
- multi-view Deep support where XR is incomplete.

Interior horizontal surfaces are not promoted to floor/ceiling merely because they are horizontal. Large tables/shelves therefore remain residual unless they coincide with the known room floor/ceiling levels. A geometric ceiling without a semantic label must also be above the camera-height envelope and have meaningful finite area; the old fixed 1.45 m threshold is not used.

Vertical XR planes are also not automatically treated as outer room walls. In the top-down XZ model, approximately parallel planes on the same side of the camera trajectory compete for the room boundary; the farther persistent plane is preferred and interior vertical planes are marked `interior-vertical`. Their metric points remain available to populate objects instead of distorting the room footprint. A new Deep-only wall is additionally required to lie near an already inferred/observed room boundary, so a persistent tall cabinet in the middle of the room is not promoted merely because it is vertical and seen three times.

## Persistent objects

After structural evidence is removed, residual XR + Deep evidence is voxelised at a coarse semantic scale and grouped with 26-neighbour connected components.

A Deep-only residual component needs at least two views to become an object. XR-supported components can survive with fewer RGB confirmations because their geometry is already metric.

Each internal object stores:

- stable-ish spatial signature;
- persistent frame IDs;
- XR/Deep cell counts;
- point samples and RGB;
- bounding volume / coarse closed mesh;
- confidence and persistence score;
- `candidate`, `hidden` or `removed` state.

Objects can be hidden in the viewer or removed/restored from the active model. Removed object cells are excluded from the active PLY and their mesh is excluded from OBJ. Hidden objects remain data and are only hidden from the viewer.

## Deep optimization

The existing V12.1.4 metric processing remains, but gets an additional structural term.

For each keyframe:

- robust global relative-to-metric fit;
- local correction grid;
- synchronized XR depth constraint;
- XR raycast / signed evidence constraint;
- TSDF refinement;
- **shared structural surface target** when the ray intersects a persistent surface;
- smoothness regularization.

The camera pose remains the WebXR pose. Deep does not receive a free rigid transform that could rotate one photo independently from another.

## Memory and performance

All V12.1.4 safeguards remain:

- explicit TSDF/surfel budgets and pruning;
- automatic lower budgets on low-memory devices;
- JPEG compaction of cold RGB keyframes;
- uint16 packing of processed Deep maps;
- one ONNX worker/session at a time;
- worker released during WebXR and after batch processing;
- transactional processing and selectable quality;
- bounded imported PLY/OBJ models;
- stale XR planes/meshes removed from the active primitive maps.

V12.1.5 additionally separates structural and residual Deep maps so only the evidence required for the final semantic model is kept active.

## Viewer layers

The V12.1.5 scene separates:

- closed room mesh;
- XR RGB point evidence;
- Deep structural evidence;
- persistent internal objects;
- diagnostic per-frame Deep mesh;
- structural planes;
- candidates/imported models.

The diagnostic Deep mesh is not the final structural geometry and is disabled by default.

## Export / import

### RAW

Schema: `room-scanner-v12.1.5-raw`.

It preserves the evidence needed for reprocessing, including structural/residual Deep state, surface refinement metadata, object metadata and user overrides.

### PLY

Exports compact fused RGB points with:

- confidence;
- source (`XR`, structural Deep, residual Deep);
- `object_id`.

Removed object cells are excluded from the active export.

### OBJ

Exports:

- `ROOM_SHELL` as the structural closed mesh;
- active internal object meshes as separate OBJ objects.

Hidden objects are a viewer preference and remain exportable; removed objects are excluded.

PLY/OBJ can still be imported and inspected in the scene viewer.

## Automated tests

Run from this package:

```bash
node tests/test_v12_1_5_static.js
node tests/test_v12_1_5_runtime.js
node tests/test_v12_1_5_package.js
```

The runtime suite explicitly covers the regression that motivated V12.1.5: three slightly rotated Deep observations of the same wall refine one normal-locked wall rather than becoming multiple global sheets.

## Device acceptance test

Recommended sequence:

1. Scan one corner from at least three lateral viewpoints.
2. Include floor and, if possible, ceiling in two or more frames.
3. Finish XR acquisition.
4. Run **Processa modello** in Bilanciata quality.
5. In Review verify that the same wall accumulates multiple persistence views and a bounded `Deep refine` offset.
6. In Scene enable/disable the diagnostic Deep mesh: the diagnostic local sheets may differ, but **Deep strutturale** and `ROOM_SHELL` should lie on one shared wall.
7. Scan a table/cabinet in front of the wall. It should appear in `Oggetti persistenti`, not modify the wall normal.
8. Export PLY/OBJ, reload them and inspect the separation.

## Intentional limits

- Object labels are geometric heuristics, not semantic neural labels. The current objective is structure-vs-residual separation, not furniture recognition.
- A missing wall can be proposed from Deep only after multi-view persistence; it remains marked as inferred/non-authoritative until stronger evidence exists.
- The final object mesh is intentionally coarse. Fine object reconstruction/material characterization belongs after the room shell is stable.
- Physical WebXR camera/depth/plane/mesh behavior still requires Android/ARCore device testing.
