# Room Scanner V30.28 · Probabilistic factor-graph reconstruction

V30.28 changes the reconstruction architecture rather than adding another hard acceptance gate. The online path remains AlvaAR + Depth Anything + MVS + Gaussian fusion, but every important observation is now also stored as probabilistic evidence that can be revisited after the scan.

## Main change

The application persists a compact factor graph containing:

- AlvaAR pose priors with 6-DoF covariance rather than exact poses;
- frame identity, intrinsics, a compact grayscale thumbnail and bounded 2D features;
- probabilistic cross-frame feature associations and multi-view landmark measurements;
- landmark 3D mean/covariance and provenance;
- raw relative Depth Anything samples on a compact grid, with quality metadata;
- independent photometric MVS likelihood samples and source-frame provenance.

No observation is promoted to permanent truth merely because it passed a threshold once. Low-confidence evidence remains low weight and may later be contradicted by more views.

## Online chain

1. AlvaAR remains the real-time camera-motion authority.
2. A conservative pose covariance is estimated from tracking state / tracked points.
3. Alva candidate points are associated between frames using BRIEF-like binary patches, epipolar geometry, local ZNCC, mutual uniqueness and feature quality. The result is a probability, not a boolean identity.
4. Multi-view triangulation propagates pose uncertainty into landmark covariance. Poorly conditioned geometry therefore stays uncertain instead of becoming an overconfident metric anchor.
5. Depth Anything is stored in raw relative form in the graph. A sequence-level robust model estimates the transform to metric depth from the whole growing set of trustworthy anchors.
6. Plane sweep remains independent from the Deep prior: Deep narrows the proposal range but does not lower the photometric acceptance standard. Coarse global probes can escape an incorrect monocular prior.
7. The live Gaussian map still provides immediate feedback, but the post-scan solution is allowed to rebuild it from refined evidence.

## Post-scan optimisation

The review optimiser jointly refines:

- 3D landmark positions;
- small SE(3) corrections to Alva poses, constrained by their pose priors;
- the sequence-level Deep calibration;
- posterior probabilities / robust weights from reprojection and depth residuals.

After optimisation the Gaussian/mesh representation is rebuilt from corrected poses and evidence. Pose covariance is propagated into each 3D observation before information-form fusion, so repeated observations cannot become infinitely certain around a biased camera trajectory.

## Persistence

New sessions use `ROOMSCAN-PROB-SESSION-3`. The `.r30` codec supports typed probabilistic graph buffers (`ROOMSCAN-R30-JSON-2`), including compact Float32 Deep grids, so the evidence can be exported and reprocessed without the original video.

## Public-data validation

The test suite includes a reproducible validation based on the public TUM RGB-D `freiburg1_xyz` benchmark. It uses the official RGB preview for real-texture feature association and the official 3,000-sample ground-truth trajectory for non-trivial camera-motion optimisation. The current test obtains ~0.988 match precision, 1.0 recall, and reduces the deliberately perturbed factor-graph reprojection RMSE from ~2.29 px to ~0.037 px while keeping the mean pose correction ~8.4 mm.

This is intentionally not claimed to be a full TUM end-to-end reconstruction benchmark: the compact fixture validates association and joint optimisation against public real data without shipping the full ~0.47 GB sequence.

## Verification

```bash
npm run verify
```

V30.28 currently passes 113/113 Node regression tests plus public-data validation, Depth Anything diagnostics, dependency closure, layout checks, EventTarget-constructor checks, mock UI boot and the Alva runtime contract.

The V30.27 Surface Mesh Lab remains available and isolated. It can still be used for BASE/EXP comparisons, but V30.28 treats meshing as a derived stage after probabilistic refinement rather than as the authority that fixes upstream geometry.
