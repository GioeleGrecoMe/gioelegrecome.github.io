# Room Scanner V30.30 · Exact Live Photo Puzzle + Global Depth Atlas

V30.30 deliberately stops before trusting later 3D meshing: during acquisition the user can now inspect the two data products that must be coherent first.

- **PHOTO PUZZLE**: the RGB photographs actually sent to Depth Anything, connected online by visual overlap and placed through the exact Alva pose of the same camera frame.
- **GLOBAL DEPTH**: the same photographs after their relative Deep maps have acquired a common scale from RGB correspondences + Alva triangulation, rendered as global radial depth from one fixed atlas origin.

The V30.29 post-scan `Photo Puzzle -> planes + particles` solver remains available and now receives this denser exact-frame survey evidence through the persistent probabilistic factor graph.

## Exact survey clock

The live map is driven by the Deep survey clock (normally about 1 Hz), not only by the sparser dense-keyframe clock. Before a Deep inference starts, V30.30 freezes one immutable packet containing:

`frameId + capture timestamp + RGB/gray + K + Alva pose/covariance + 2-D Alva/MVS feature observations`.

That exact packet is inserted into the factor graph and the live photo graph. The worker result is accepted only for the same `frameId`/raster binding, so inference latency cannot attach a depth field to a later Alva pose.

If Alva has no valid pose, Deep may still be shown in the local diagnostic preview, but that photograph is not promoted into global geometry.

## Live photo graph

A walking scan is not forced through one homography. Translation produces real parallax. Each new survey photo is matched only to a small temporal neighbourhood plus plausible loop candidates. A graph edge therefore means verified RGB overlap; a weak photo stays visible as disconnected evidence and can be repaired by revisiting that direction.

The spherical canvas is a virtual view of the reconstructed world around a **fixed origin locked by the first posed survey photo**. The origin never follows the mean camera position, because doing so would make already pasted content slide whenever a new frame arrives.

## Why the PHOTO atlas should be sharper

Once metric/aligned depth exists, each source pixel is back-projected through its own camera pose into 3-D and reprojected into the fixed atlas. Overlapping images are not averaged indiscriminately. V30.30 uses:

1. metric depth / depth-graph confidence;
2. a radial z-buffer;
3. a best-view score favouring central, well-conditioned source pixels;
4. only a tiny colour-consistent seam blend when two samples represent the same surface.

A provisional fronto-parallel shell is allowed only as a faint visual placeholder while scale is still unknown. It cannot replace metric pixels and never enters GLOBAL DEPTH or 3D reconstruction evidence.

## Online Deep scale graph

For a verified RGB correspondence `(u_i,u_j)`, Alva poses and intrinsics triangulate a world point `X`. The two camera optical depths are then measured separately:

`z_i = project(T_i,K_i,X).z`

`z_j = project(T_j,K_j,X).z`.

Raw Deep values at the same pixels become calibration pairs `(D_i,z_i)` and `(D_j,z_j)`. This explicitly avoids the incorrect assumption that the same world point must have the same camera depth after translation.

The sequence compares the same three monotonic families used by the post-scan pipeline:

- `z = a D + b`
- `z = a / D + b`
- `1/z = a D + b`.

A useful live detail is that a photograph with Deep can be calibrated from an RGB-connected neighbour even if that neighbour's Deep inference failed. Geometry comes from RGB + poses; Deep is sampled only on the side where it exists.

## GLOBAL DEPTH convention

Deep/MVS values are camera optical `Z`. Back-projection converts them to Euclidean ray range with

`range = Z / ray_camera.z`.

The resulting 3-D point is transformed by the exact Alva pose. GLOBAL DEPTH then displays radial distance from the fixed atlas origin. Thus the colour of a pixel has one common geometric meaning across the entire pseudopanorama instead of representing unrelated per-camera relative depth values.

Only metrically/alva-scale aligned maps and verified world samples are rendered in this mode. Unknown regions remain empty.

## Memory / low-budget behaviour

Survey RGB is compacted to at most 256 px on the long side and relative depth to at most 168 px. The live atlas is 640x320 internally but uses a global sample budget, so retaining more photographs does not imply rasterising every source pixel on every refresh. Up to 90 recent survey photographs are kept in the live viewer; the persistent factor graph can keep a longer session history independently.

## Verification

Run:

```bash
npm run verify
```

The current automated suite passes **126/126** Node tests. V30.30 adds live-atlas regressions for exact Deep-frame capture, one-sided depth-scale alignment, fixed atlas origin, no-blur best-view compositing and coverage-clock de-duplication. The public-data validator also exercises the live atlas on the freely available TUM RGB-D `freiburg1_xyz` texture with a controlled translation and known 2 m surface.

This validation is intentionally separated from a claim of full end-to-end TUM room reconstruction: the public image content is real, while the controlled warp/depth gives an exact expected registration answer.
