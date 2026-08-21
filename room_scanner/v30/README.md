# Room Scanner V30.29 · Spherical Photo Puzzle + Hybrid Room Reconstruction

V30.29 introduces a new post-scan reconstruction path designed around the information that is actually available in the app: overlapping RGB views, Alva camera poses, raw relative Depth Anything maps, sparse multi-view landmarks and independent MVS evidence.

The legacy Gaussian batch optimiser and Surface Mesh Lab are still present for A/B comparison. They are not overwritten by the new solver.

## Core model

The new path deliberately separates three problems that were previously entangled:

1. **Photo puzzle / view graph** – connect only photographs that have verified visual overlap. A walking scan is not forced into one global homography; translated cameras create parallax, so the equirectangular collage is diagnostic only.
2. **Sequence Deep alignment** – a matched RGB point is triangulated using the corresponding Alva poses. The resulting optical-Z values become probabilistic anchors for the raw Deep map in each view. Same-world-point does *not* mean same camera depth.
3. **Geometry explanation** – large planar structures are extracted first and represented directly as planes. Only observations not already explained by planes are assigned to a user-bounded set of 1k–10k particles.

## Diffusion-like particle fitting without another neural model

The particle stage uses deterministic annealing / EM rather than an additional generative network. At high temperature, observations can support a broad neighbourhood of particles; the temperature is gradually reduced and the posterior becomes more selective. Each candidate update is checked against a fixed validation objective with backtracking, so an uphill update is rejected instead of being displayed as progress.

The user chooses the particle budget and the cumulative number of iterations in the 3D review.

## Planes first

For room-scale scenes, walls, floor, ceiling, tabletops and other large planar regions should not consume thousands of splats. V30.29 uses uncertainty-aware RANSAC/PCA, then a soft Manhattan-world regularisation. A plane is accepted only when it is supported by multiple frames and sufficient physical area. If opposite planes are available on three approximately orthogonal axes, the preview can form an explicit shoebox envelope.

Plane residuals use the projected anisotropic ray uncertainty, not a single scalar depth tolerance.

## Exact depth convention

Depth Anything and the plane-sweep MVS path use camera optical-axis depth `Z`. The particle solver uses distance along a normalised 3D ray. V30.29 explicitly converts

`range = Z / ray_camera.z`

before constructing a 3D observation. This prevents off-axis pixels from bending a fronto-parallel wall into a curved surface.

## Online spherical coverage

During scanning, accepted views paint an equirectangular direction sphere. Weak/disconnected sectors remain visible rather than being silently discarded. The guide tracks:

- strong and seen angular coverage;
- fraction of visually/geometrically connected views;
- visual loop closures;
- a closure confidence and the least-observed direction.

If the current view is weak, the user is explicitly asked to revisit it. If the scan is terminated before a visual closure is established, the app warns the user but still allows an intentional early finish.

## Persistence

The V30.28 probabilistic factor graph is retained and extended with a compact RGB photo packet per keyframe. New sessions persist the Photo Puzzle reconstruction separately from the legacy Gaussian state, so BASE/PUZZLE comparison remains reversible.

## Verification

Run:

```bash
npm run verify
```

The current build passes 119/119 Node regression tests plus the public-data validator, Depth Anything diagnostics, layout/dependency checks, EventTarget constructor checks, mock UI boot and the Alva runtime contract.

The public validator uses the freely available TUM RGB-D `freiburg1_xyz` material already stored under `test/online-data/`: real TUM texture is used for the photo matcher/puzzle and the official ground-truth trajectory is used to exercise pose/factor optimisation. Controlled warps and synthetic geometry are explicitly used where an exact expected solution is needed; this is not presented as a full end-to-end TUM reconstruction benchmark.
