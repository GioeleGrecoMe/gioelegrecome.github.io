# Room Scanner V30.28 probabilistic architecture

## Principle

The scene is an inference problem, not a chain of irreversible accept/reject decisions. Every measurement carries uncertainty and provenance. The online mapper provides a responsive estimate; the post-scan factor graph retains enough evidence to revise that estimate.

```text
RGB frame F_i
  |-- Alva pose prior T_i, Sigma_Ti
  |-- 2D features + compact appearance evidence
  |-- raw Deep relative grid D_i + quality
  `-- independent MVS likelihoods
             |
             v
  probabilistic cross-frame associations
             |
             v
  multi-view landmark factors X_j, Sigma_Xj
             |
             +----> sequence Deep calibration theta_D
             |
             v
  joint robust refinement
  {delta T_i, X_j, theta_D, factor probabilities}
             |
             v
  uncertainty-aware Gaussian rebuild
             |
             v
  derived surface field / TSDF / mesh
```

## Frame and pose factors

AlvaAR remains the online pose source. V30.28 attaches a conservative 6-vector covariance `[tx,ty,tz,rx,ry,rz]` to each pose. The post-scan state is `T_i = T_i^Alva exp(delta xi_i)`; the Alva prior strongly regularises `delta xi_i` but no longer makes the pose mathematically immutable.

## Feature association

Alva points are candidate locations, not assumed persistent landmark IDs. The dense mapper computes a deterministic 128-bit local binary patch descriptor and combines Hamming distance, Alva-pose epipolar distance, local ZNCC, mutual uniqueness and feature quality. These cues are combined probabilistically so one strong cue cannot hide a catastrophic cue.

## Sparse geometry

Each surviving multi-view track is triangulated/refined across its supporting poses. The inverse reprojection Hessian gives a full 3x3 covariance, then pose uncertainty and empirical multi-view scatter are added. Nearly parallel rays therefore produce high longitudinal uncertainty instead of a false precise depth.

## Sequence-level Deep model

Raw Depth Anything values are stored before metric calibration. Robust calibration tests direct, inverse-raw and inverse-depth projective families across frames. The model keeps a sequence posterior and explicit uncertainty; a bad individual frame cannot silently redefine the scale of the whole scene.

## Independent MVS

Depth Anything is a proposal distribution only. The plane sweep always retains coarse hypotheses outside the Deep window and its photometric likelihood is not relaxed because Deep suggested that range. `priorEscapeRatio` is diagnostic evidence that the verifier can escape a wrong monocular prior.

## Joint optimiser

The post-scan worker alternates robust landmark and pose updates, recomputes measurement probabilities from reprojection residuals and refits the sequence Deep model. Pose updates are small and regularised by the Alva covariance. The first/strongest frame acts as the gauge anchor.

## Rebuild

The refined graph is converted back into three evidence classes:

1. multi-view landmarks: highest geometric authority;
2. independent MVS samples reprojected from corrected poses;
3. Deep completion with deliberately broad ray uncertainty.

Camera-pose covariance is propagated into point covariance before Gaussian information fusion. Correlated evidence from one frame cannot manufacture independent support.

## Storage budget

The graph is bounded: maximum frame count, maximum features per frame, compact grayscale thumbnails, compact Deep grids and bounded MVS samples. It preserves the variables needed for later optimisation without storing the full video stream.
