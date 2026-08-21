# Room Scanner V30.31 architecture

## 1. Exact photo node

At each Deep survey tick the app freezes the camera image before transferring data to the inference worker. The same node carries frame identity, intrinsics, 2D features, AlvaAR 6-DoF pose and pose covariance. Raw Deep can return only to that exact node.

## 2. Photo-first registration graph

`LivePhotoPuzzleMap` and post-scan `ViewPuzzleGraph` no longer call the Alva-epipolar probabilistic matcher for panorama registration. A candidate edge is built from image evidence only:

`BRIEF -> ZNCC -> mutual uniqueness -> homography RANSAC -> calibrated-ray relative rotation`.

The RANSAC homography is an overlap validator, not a claim that the complete room is planar. The accepted visual rotations are solved globally on a robust rotation graph. Alva orientation is used only as a zero-confidence display fallback for a disconnected photo and remains saved as an independent prior.

## 3. Lightweight local parallax warp

A walking scan violates the single-centre panorama assumption. After the stable spherical base orientation is solved, each accepted RGB match measures the residual displacement between its two atlas projections. Those residuals populate a low-resolution smooth displacement field per photo. The graph root stays fixed; less-certain frames absorb more correction.

The warp is conservative, locally supported and capped. Large residuals are treated as likely dynamic/wrong correspondences rather than allowed to fold the panorama. This gives the diagnostic mosaic local freedom without using Alva translation to force image placement.

## 4. Sharp composition

Each atlas sample has a source score based on graph connectivity, registration confidence and distance from the source image centre. The best source wins. A tiny blend is permitted only for close-scoring colour-consistent samples. This avoids the characteristic blur of averaging slightly misregistered photographs.

## 5. Deep overlap consensus

Deep is solved as a separate layer. On each verified RGB edge, raw monocular values are sampled at the same matched image coordinates. A robust affine mapping is fitted between the two raw fields, weighted by visual-edge confidence and Depth diagnostics. A strongest-path graph propagates the transforms into one latent depth coordinate.

Weak pair fits, negative scales, poor spread/correlation and suspicious Depth quality receive little or no authority. In overlapping atlas pixels, confidence chooses the source; only consistent values blend.

The existing metric `DepthScaleGraph` is retained unchanged for metric calibration. The live renderer uses one mode at a time: metric if sufficiently supported, otherwise relative overlap-consensus.

## 6. Alva is a prior, not a photographic authority

For each frame the system keeps `pose`, `poseCov`, intrinsics and timestamp. Diagnostics report the angular disagreement between the visual solution and Alva. No Alva pose check is allowed to reject an otherwise valid panorama edge.

The existing factor graph and 3D reconstruction code remain intact. V30.31 only improves the observations and persistence that will feed a future pose-correction step.

## 7. Persistence

Local session format is `ROOMSCAN-PUZZLE-SESSION-5`. `.r30` now includes an `evidence` block with `factorGraph`, `deepSequence` and `photoPanorama`. Panorama evidence includes visual edge rotations, confidence, RANSAC residuals, 2D match coordinates, visual orientations and compact local-warp/depth-consensus diagnostics.
