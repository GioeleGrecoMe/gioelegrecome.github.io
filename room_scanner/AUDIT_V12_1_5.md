# V12.1.5 implementation audit

## Goal

Prevent monocular Depth Anything observations from creating duplicated/slanted structural sheets while keeping their useful multi-view evidence for completing the room and populating internal objects.

## Structural invariants checked

- WebXR remains the only direct metric pose authority.
- A single Deep frame cannot create an authoritative wall.
- Structural Deep evidence is associated by camera ray to a global surface.
- Structural surface normals are locked during Deep refinement.
- Deep plane offset correction is bounded.
- Structural Deep points are projected to the final shared surface before entering the structural cloud.
- Deep-only wall creation requires >=3 persistent views.
- Deep-created planes use `admissionSupport:false` and cannot recursively authorize more Deep.
- Interior residuals are kept separately from room structure.
- Object population requires persistence unless backed by XR metric evidence.
- Room shell construction remains upstream of object reconstruction.
- Parallel vertical XR planes are filtered top-down so an interior cabinet/partition face cannot replace the farther outer room boundary merely because it is planar and metric.
- Interior vertical planes are excluded from structural-clearance subtraction so their native XR points can populate object residuals.

## Regression covered: multiple rotated sheets

Synthetic test creates three Deep observations of one XR wall with frame-dependent slope errors. The refined output is asserted to:

- keep exactly the global wall normal;
- apply only bounded plane-offset correction;
- combine evidence from the three frame IDs;
- produce one persistent structural primitive.

## Structure / object separation covered

Synthetic tests verify:

- a Deep point close to a global wall becomes structural;
- a coherent point in front of the wall remains residual rather than being projected to the wall;
- multi-view residual volume becomes an internal object;
- residual samples within structural clearance of the wall are excluded from object population;
- object coarse mesh is closed/manifold.

## Memory/lifecycle retained from V12.1.4

- explicit sparse TSDF/surfel budgets;
- pruning under pressure;
- cold frame JPEG compaction;
- processed Deep uint16 packing;
- batch-only ONNX worker lifecycle;
- imported-model budgets;
- transactional final-model commit.

## UI / export retained

- process progress and quality selector;
- Review close/recalculate controls at bottom;
- PLY and OBJ import/viewer;
- object hide/remove/restore;
- PLY `object_id`;
- closed room plus separate objects in OBJ.

## Known limitations

- Geometry tests run in Node and cannot emulate vendor WebXR behavior.
- Fine object meshes are deferred intentionally.
- The semantic layer is geometric persistence rather than learned object classification.
