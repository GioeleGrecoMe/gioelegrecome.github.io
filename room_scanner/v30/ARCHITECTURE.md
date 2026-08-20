# Room Scanner V30.26.0 architecture

## Design goal

V30.26 treats the persistent 3D scene as a **continuous anisotropic Gaussian
map**, not as a voxel cloud and not as a stack of monocular depth meshes.  The
spatial hash exists only to find nearby hypotheses cheaply; it does not quantise
the Gaussian centres and it may contain several incompatible surfaces in one
cell.

The hierarchy of geometric authority is:

1. AlvaAR camera pose and persistent feature tracks.
2. Multi-view triangulation / plane-sweep geometry.
3. Calibrated Depth Anything proxy depth used to fill missing surface support.

Depth Anything is therefore a dense prior, not an independent metric sensor.
Evidence computed from the same photographs is collapsed before map fusion so a
single keyframe cannot falsely count as several independent measurements.

## Online pipeline

```text
camera RGB
   |
   +--> AlvaAR pose + tracked features -----------------------------+
   |                                                               |
   |    match same reference feature in nearby keyframes            |
   |                     |                                         |
   |                     v                                         |
   |       multi-view triangulated metric tracks                    |
   |       mean 3D + full centre covariance + descriptor            |
   |                     |                                         |
   +--> Depth Anything relative depth                              |
   |                     |                                         |
   |       robust global scale/shift + low-frequency local          |
   |       correction from metric feature tracks                    |
   |                     |                                         |
   +--> plane sweep / multi-view verification                       |
                         |                                         |
                         v                                         |
                one proxy-depth observation set <------------------+
                         |
                         v
       continuous information-form 3D Gaussian map
       centre mean + centre covariance + surface covariance
       normal + colour + descriptor + compact view evidence
                         |
                 +-------+-------+
                 |               |
                 v               v
          live/review splats   derived TSDF mesh
```

## Feature-track Gaussian landmarks

A reference feature matched into several Alva keyframes is triangulated against
all useful source poses. Pairwise triangulations are robustly filtered and used only as an initializer. The final landmark is refined by a small joint Gauss-Newton reprojection solve over every useful Alva view, and the inverse normal matrix supplies the observation covariance. The stored sufficient statistics are the
continuous 3D mean, packed symmetric 3x3 covariance, depth uncertainty,
reprojection quality, compact descriptor and the set of contributing frame IDs.
The raw image history is not needed by the map.

The covariance has a ray-aligned image-geometry floor and empirical scatter from
independent triangulations. This prevents nearly parallel views from claiming
unrealistically high depth precision.

## Proxy depth

The dense observation builder gives precedence to feature-track and verified MVS
geometry. A calibrated Deep pixel is emitted only where those stronger sources
do not already explain the same image region. When track and MVS evidence meet,
they become one `proxy-track-mvs` observation rather than two votes.

Deep calibration consists of a robust direct/inverse global affine model plus a
small regularised spatial log-scale field driven by metric tracks. It also emits
a per-pixel relative uncertainty map. The uncertainty is converted to a full 3D
ray covariance before fusion.

## Gaussian state and statistical fusion

Each persistent Gaussian keeps two different covariances:

- **position covariance**: uncertainty of the estimated 3D centre; this is fused
  in information form and shrinks only when genuinely new camera evidence
  arrives;
- **surface covariance**: physical anisotropic splat footprint; this is averaged,
  not multiplied, so a well-observed wall does not collapse into point-sized
  splats.

Association uses a covariance-aware Mahalanobis gate, optional normal agreement,
appearance/descriptor consistency and a continuous spatial neighbourhood. New
incompatible observations create a second Gaussian even inside the same hash
cell, which is essential at edges, thin structures and occlusions.

A compact 64-bit Bloom-style view mask prevents replayed/out-of-order jobs from
manufacturing support. Small baseline/view-angle changes receive diminishing
information weight because adjacent monocular frames are correlated.

## Expansion, confirmation and pruning

Unexplained observations expand the map. A provisional Gaussian remains hidden
until supported by independent geometry/camera viewpoints. Stale unconfirmed
hypotheses are pruned. This keeps the map size bounded without storing every
photo or every historical sample.

## Rendering and mesh

Live AR and the review renderer project the full 3D covariance through the camera
Jacobian and draw rotated anisotropic ellipses. PLY export preserves the packed
3D covariance and per-axis scale.

The TSDF is secondary derived geometry. It is rebuilt from the current confirmed
Gaussian map, so corrected centres can replace earlier estimates. Unknown TSDF
voxels never act as free space and voxel values are interpreted at voxel centres.

## V30.26 post-scan optimisation and persistence

The online mapper still prioritises capture latency. At scan completion the fusion
worker exports a compact persistent state rather than raw video: confirmed
Gaussians plus a bounded, view-diverse reservoir of multi-view observations per
Gaussian. Each observation stores camera origin, measured 3D point, its full
position covariance and confidence. The reservoir is intentionally capped so
storage grows with the surface map rather than with recording duration.

The saved state is written to IndexedDB (`snapshots`, with the current derived
mesh in `meshes`) and can be reopened from the main screen. Post-scan refinement
runs in a dedicated module worker. The user chooses a **total iteration target**;
the worker yields between iterations and sends at most roughly 16 full preview
snapshots for a long run. Small runs therefore update every iteration while long
runs avoid spending most of their time serialising and repainting the cloud.

Each optimisation iteration combines covariance-weighted multi-view observation
constraints, a weak prior to the online estimate and robust local point-to-plane
regularisation. The latter acts along compatible surface normals only, so it does
not deliberately shrink tangential spacing across a wall or pull different sides
of a corner into one sheet. Centre covariance is updated from the local
information matrix and the physical surface covariance is sharpened only along
the estimated normal.

The TSDF mesh is a derived product. Once Gaussian centres change after post-scan
optimisation, the pre-optimisation mesh is marked stale and hidden instead of
pretending that it still represents the refined map. Whole-room surface meshing
from the optimised Gaussian field remains a separate reconstruction stage.
