# Room Scanner V30.30 architecture

## 0. Principle: make the acquisition observable before meshing

V30.30 treats the live photo/depth atlas as a prerequisite diagnostic layer. If RGB views cannot form a continuous graph or their relative Deep fields cannot acquire a coherent common scale, no later Gaussian/particle/mesh optimiser can recover trustworthy room geometry.

The live layer therefore exposes exactly the evidence later used by the persistent probabilistic graph.

## 1. Exact Deep-survey frame packet

At the ~1 Hz Deep survey tick, after Alva has processed the current camera raster, the app freezes

`F_i = {frameId, t_i, I_i, K_i, T_i^Alva, Sigma_Ti, features_i}`.

This happens before the RGBA buffer is transferred to the Deep worker. The packet is inserted into:

- the persistent probabilistic factor graph;
- the incremental live photo puzzle;
- the spherical coverage monitor.

Deep completion time is not used as a geometric timestamp. The returned raw depth can update only the node carrying the same exact frame binding/signature.

## 2. Incremental photo puzzle

The live graph is `G=(V,E)` with one node per posed Deep-survey photograph. Candidate edges are restricted to a temporal window and a few orientation-compatible loop candidates. An edge is retained only when probabilistic feature matching supports real image overlap using appearance, ZNCC, mutual uniqueness and Alva-pose epipolar consistency.

No global homography is assumed. Parallax is preserved and later explained by the 3-D pose/depth warp.

Disconnected photos remain visible instead of being silently discarded. They are scan-quality evidence and can trigger a revisit.

## 3. Online pose-aware Deep scale graph

A matched RGB pair does not constrain raw Deep values to equality. The calibrated rays are triangulated with the two Alva poses, producing world point `X`. Each camera then sees its own optical depth:

`z_i = pi_z(T_i^-1 X)`.

Raw Deep samples at the matched pixels provide independent `(D_i,z_i)` anchors. The online graph robustly compares

- `z = aD+b`
- `z = a/D+b`
- `1/z = aD+b`.

The model family is sequence-level; well-supported frames receive local parameters while weak frames borrow a low-confidence graph prior. An RGB edge can calibrate one Deep side even when the other side has no valid Deep map.

## 4. Fixed-origin pose-aware pseudopanorama

The atlas origin is locked to the first valid posed survey camera and never changes during the scan. Every metric/aligned pixel is converted from camera optical depth to range

`r = Z / d_z`

and then to world point

`X_w = C_i + R_i d r`.

The world point is finally mapped to equirectangular coordinates around the fixed atlas origin. Therefore camera translation is handled by geometry rather than hidden inside a moving panorama reference.

### PHOTO compositing

Each atlas pixel retains the sharpest geometrically plausible source sample:

- z-buffer for conflicting surfaces;
- metric/depth confidence;
- source-view centrality;
- graph connectivity.

Overlaps are not simple weighted averages. Tiny seam blending is allowed only for colour-consistent samples already classified as the same surface. Before metric depth is observable, a low-alpha fallback shell may show approximate photo continuity, but it has no authority in GLOBAL DEPTH or reconstruction.

### GLOBAL DEPTH

The depth atlas uses only aligned Deep maps, strong online calibrations, MVS/sparse world samples and the same fixed origin. Its value is global radial distance, so the colour scale is common to all photographs. Unknown/unaligned pixels stay transparent.

## 5. Coverage and revisit

The same physical frame may appear on both the Deep survey clock and dense-keyframe clock. `ViewSphereCoverage` de-duplicates by `frameId`, preventing one image from voting twice. Photo-graph discontinuity and angular coverage remain separate signals: a direction may be seen but poorly connected, in which case the user should revisit it.

## 6. Persistent post-scan evidence

Every posed survey photo is also inserted into `ProbabilisticFactorGraph`, and raw Deep is attached when its exact result returns. The post-scan V30.29/V30.28 solvers therefore receive more temporally regular evidence than before rather than a separate display-only collage.

The authority hierarchy remains:

`exact frame identity -> photo connectivity -> pose-aware triangulation -> Deep scale -> independent MVS -> planes / residual particles -> derived 3D`.

## 7. Why this precedes further mesh work

A sharp connected PHOTO atlas is a direct test of RGB/pose consistency. A coherent GLOBAL DEPTH atlas is a direct test of Deep scale + pose geometry. If either is wrong, a later surface optimiser would only hide the acquisition error. V30.30 therefore makes these products inspectable live before treating their measurements as a room surface.
