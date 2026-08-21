# Room Scanner V30.34 architecture

## 1. Atomic RGB + Depth frame

The live photo graph accepts only an exact frozen survey RGB frame with a valid Depth Anything raster bound to that same capture. Failed inference, synchronization mismatch or invalid depth produces no panorama node. This keeps RGB and raw depth one-to-one for every photograph that can later contribute to the map.

## 2. Spherical photographic registration

AlvaAR is not an input to the 2-D photo solver. Frozen RGB frames generate their own multi-scale corner pyramid. Oriented BRIEF descriptors, mutual uniqueness and local ZNCC provide candidate correspondences.

Each match is converted from pixel coordinates to a calibrated unit camera ray through the frame intrinsics. Pairwise geometry is restricted to a rigid rotation `R_b_to_a`; a robust angular consensus rejects outliers and Wahba/IRLS refines the rotation. No planar homography, affine warp or local projective mesh is used as panorama geometry.

Accepted pairwise rotations form a graph. The first accepted RGB+Depth frame fixes the arbitrary spherical gauge. Neighboring and loop edges are rotation-averaged globally, so a loop can correct accumulated orientation error without changing the shape of an individual photo.

## 3. Robust relocalisation

For every new depth-valid photograph the live mapper tests:

- several temporal neighbours;
- recent photographs already in the visible root component;
- visually similar non-temporal photographs;
- on failure only, a bounded wider relocalisation against the existing connected map.

Once a new frame connects, recent disconnected depth-valid photographs are retried against it. An unverified frame is never placed from a tracker guess.

The post-scan graph performs an additional component-bridging search because it can spend more CPU than the live path.

## 4. Dense spherical RGB rendering

The common atlas is an equirectangular window on the solved sphere. Every destination pixel is converted to a panorama ray, rotated back into each source camera and bilinearly sampled from the original compact RGB photo. Source-centre weighting and global exposure-gain compensation choose/blend overlapping observations while avoiding point splats and projective stretching.

Feature points, graph edges and Alva markers are diagnostic data and are not drawn over the RGB preview.

## 5. Global raw-Depth consensus

Depth is not aligned frame-by-frame along a propagation tree. Every verified RGB overlap contributes constraints

`a_i D_i(p) + b_i ~= a_j D_j(q) + b_j`.

Samples include both verified feature correspondences and a dense grid projected through the same spherical relative rotation. All `(a_i,b_i)` values in the connected component are solved jointly with robust IRLS while the panorama root fixes the scale/offset gauge.

After global alignment, one robust global percentile range is computed from all aligned depth maps and used to colour the complete depth atlas. A new loop therefore improves one shared latent scale rather than creating a new per-photo palette.

## 6. Alva / metric / 3-D separation

An accepted RGB+Depth frame may carry an Alva pose and covariance as optional evidence for the existing metric/3-D pipeline. Missing or incorrect Alva tracking does not change photographic matches, spherical rotations or RGB placement. The 3-D reconstruction implementation is intentionally unchanged in V30.34.
