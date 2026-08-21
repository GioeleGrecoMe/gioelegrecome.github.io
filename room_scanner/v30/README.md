# Room Scanner V30.27 EXP-3

## Surface Mesh Lab deploy repair + robust surface field

The diagnostic from EXP-2 exposed a deployment-specific failure: the main app
was present, but `js/experimental/surface_mesh_lab.js` had never reached the
GitHub Pages tree. Because the lab is lazy, the rest of the application can boot
and reload saved Gaussian sessions even when that optional asset is missing.

EXP-3 therefore ships the experimental module and worker again and probes both
assets before allocating the private Gaussian copy. Missing assets now produce a
specific `surface-lab-asset-missing` diagnostic rather than an opaque dynamic
import error. The production BASE remains untouched.

Geometry is also changed, not merely redeployed. Surface normals are locally
re-estimated by robust weighted PCA over spatially close, normal-compatible
Gaussian neighbours. Centre refinement is normal-only, so wall/floor patches
become thinner without tangentially shrinking edges. Mesh extraction evaluates
an anisotropic signed surface field at exact voxel centres; saved camera origins
provide a weaker free-space/sign vote. Tiny islands are filtered by physical
area rather than by keeping an arbitrary number of components.

EXP-2 exact-frame synchronization is retained unchanged.

---



Room Scanner combines **AlvaAR metric camera motion**, **Depth Anything V2
relative depth** and **multi-view feature geometry** into a compact online 3D
Gaussian map intended for mobile browsers.

## What changed in V30.26

The persistent map is no longer one surfel per voxel.  V30.26 uses continuous
anisotropic 3D Gaussians and keeps the grid only as a spatial lookup structure.
Several surface hypotheses can therefore coexist in the same small volume.

Persistent feature tracks are now first-class geometry.  A feature observed in
several Alva keyframes is triangulated from each useful baseline, robustly fused,
and becomes a metric Gaussian landmark with a full 3x3 centre covariance and a
compact appearance descriptor.  These landmarks calibrate the local Depth
Anything proxy and dominate it wherever metric multi-view evidence exists.

Deep, MVS and track estimates originating from the same photographs are collapsed
into one proxy observation before map integration; they cannot pretend to be
independent sensors.  Replayed keyframes likewise cannot shrink uncertainty or
increase support.

## Reconstruction pipeline

```text
Alva poses + image features -> multi-view metric feature tracks
                                      |
Depth Anything -> scale/local calibration -> proxy depth
                                      |
plane sweep / multi-view verification-+
                                      v
                  continuous information-form 3D Gaussians
                                      |
                         live anisotropic splats
                                      |
                         derived/rebuildable TSDF mesh
```

Each Gaussian stores a continuous centre, full position covariance, separate
surface covariance, normal, colour, confidence and compact camera-evidence mask.
Centre fusion is Bayesian/information-form with a Mahalanobis association gate.
The surface covariance remains a physical footprint rather than collapsing as
more measurements arrive.

This is deliberately a **geometry-first online Gaussian splatting map**, not a
heavy offline photorealistic 3DGS optimiser: the phone does not run thousands of
gradient-descent rendering iterations.  The useful 3DGS properties for room
mapping—continuous centres, anisotropic covariance, splat rendering, adaptive
expansion/pruning and statistical multi-view refinement—are retained within the
mobile budget.

## Scan behaviour

- AlvaAR remains the only camera-trajectory source.
- Deep runs during scan and remains visible diagnostically.
- Accepted dense keyframes run Deep even when they are close in time, while the
  keyframe manager still rejects geometrically redundant video frames.
- Track/MVS evidence is preferred over monocular proxy depth.
- New Gaussians are provisional until independent views confirm them.
- Revisiting a surface should reduce centre uncertainty and stabilise the cloud
  rather than permanently baking the first depth estimate into a mesh.

## Mobile memory model

The map stores sufficient statistics per Gaussian rather than complete frame
histories.  The keyframe graph remains bounded, descriptors are compact, and
camera evidence is represented by a small hashed bit mask.  The TSDF is rebuilt
only from confirmed Gaussians and is not the authoritative scene state.

## Verification

```bash
npm run verify
```

The automated suite includes multi-view feature triangulation, proxy-depth
de-duplication, multiple continuous hypotheses inside one hash cell, information
fusion/replay protection, full-covariance PLY persistence, anisotropic rendering,
TSDF unknown-space/voxel-centre regressions, Depth Anything diagnostics and the
AlvaAR runtime contract.

## V30.26 saved sessions and iterative review

A finished scan is now automatically saved locally with its Gaussian map and a
small multi-view optimisation reservoir. From **Sessioni locali** on the main
screen, `Apri 3D` reloads a compatible scan without repeating capture.

In 3D review, choose a total iteration target (default 30, maximum 300) and press
`Ottimizza`. Optimisation runs in a worker and can be stopped. The preview is
updated every iteration for short runs and at an adaptive cadence for long runs
(about 16 visual updates maximum), so rendering/structured-clone overhead does
not dominate the geometry update. Completed or stopped states are persisted and
can be reopened and continued later.

Saved local V30.26 sessions retain the compact multi-view constraints required by
the geometric optimiser. Generic PLY/R30 imports can still be viewed and mildly
regularised, but they do not contain that private IndexedDB observation reservoir.
If optimisation moves the Gaussian map, the old TSDF mesh is intentionally
marked stale until a future surface-meshing pass regenerates it.
