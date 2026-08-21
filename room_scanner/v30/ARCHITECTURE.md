# Room Scanner V30.35 architecture

## 1. RGB spherical panorama

The photographic graph remains independent of AlvaAR. Frozen exact-frame RGB+Depth nodes are matched with photo features, relative rotations are estimated from calibrated rays and globally rotation-averaged, and complete photos are inverse-warped to the panorama sphere. No homography, affine or local projective mesh is used for image placement.

### Exposure compensation

Every accepted RGB edge also estimates robust R/G/B gain ratios from unsaturated overlap correspondences. Gains are optimized over the connected graph and loop closures. They correct modest auto-exposure and white-balance drift without changing the geometry or blurring image detail.

## 2. Layer references from RGB overlap masks

For every accepted spherical RGB edge:

1. feature correspondences establish exact common pixels;
2. the spherical overlap is densely sampled;
3. RGB photometric disagreement, RGB gradients and raw-depth gradients reduce sample authority near unstable edges;
4. stable samples are grouped into broad ordinal depth layers;
5. a robust weighted-median `(D_i,D_j)` anchor is formed for each supported layer.

These anchors are reference observations, not hard segmentation labels. Neighbouring bands overlap slightly so the solution stays continuous.

## 3. Global nonlinear relative-depth synchronization

Each frame owns a monotone piecewise-linear transfer with 16 quantile knots. The complete overlap/loop graph is solved jointly with IRLS:

`T_i(D_i(p)) = T_j(D_j(q)) + residual`

Robust layer anchors accelerate and stabilize global scale propagation. The monotonic constraint prevents layer inversion, while slope regularization prevents oscillatory mappings. The root gauge fixes only the arbitrary relative-depth coordinate; it does not imply metric distance.

## 4. Uncertainty-aware depth fusion

At each atlas pixel, V30.35 maintains up to two Gaussian-like hypotheses. Observation uncertainty comes from transfer residuals, knot support, local depth gradients, Deep quality and RGB registration quality. Compatible samples increase precision. Incompatible samples create or support a second mode instead of being averaged.

The live renderer selects the posterior-dominant mode and lowers opacity in ambiguous regions.

## 5. Hann transitions on true RGB overlap

The spherical RGB footprints create the overlap support mask. Hann weights attenuate only source borders that are actually covered by another valid RGB+Depth frame. This yields smooth transitions after depth synchronization while preserving single-source borders and avoiding artificial holes.

## 6. Metric/3-D path

Alva pose/covariance and the existing optional metric Deep calibration are preserved as separate evidence. The 3-D solver, mesh and Gaussian/plane processing are unchanged by this patch.
