# V30.32 incremental patch notes

## Core correction

The live photographic map is now **strictly photo-only**. AlvaAR has no authority over whether a photograph is captured, connected, rejected, positioned, rotated or locally warped.

Each survey photograph independently stores its own compact RGB/gray image and detects photo features directly on that frozen image. Pairwise overlap is established by BRIEF/ZNCC/mutual matching and robust homography RANSAC. The pairwise transformations are assembled into an arbitrary 2-D mosaic coordinate system; loop correspondences refine the frame transforms globally, and a spatially varying local image warp absorbs residual parallax.

A photograph with no Alva pose is still a complete node in this mosaic. If Alva is available at capture time, its pose/covariance is retained only as optional metadata for the existing metric/3-D path. The photo solver never reads it.

Depth Anything remains a second layer. Raw relative maps are associated with the exact photographic frame and aligned statistically across the same verified RGB overlaps. The PHOTO and DEPTH views therefore share the same photo-derived warp.

## UI

The measurement diagnostics now state explicitly that the mosaic is `SOLO RGB`. The map closure warning is based first on photographic graph connectivity and photographic loop closures; Alva coverage is only secondary geometric guidance.

## Scope

The later 3-D reconstruction, TSDF, Gaussian and plane/particle solvers are intentionally unchanged in V30.32.

## Deployment

Apply this archive over the project root and keep the existing `models/` directory. The build identity is V30.32.0, creating a new service-worker shell cache.
