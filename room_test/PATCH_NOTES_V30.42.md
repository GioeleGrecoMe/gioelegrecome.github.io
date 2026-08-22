# Room Scanner V30.42 - Final-pose dense consensus

Build: `v30.42.0-20260822-final-pose-dense-consensus`

This is an incremental patch to be overlaid on the same complete V30 base used by V30.41. It intentionally contains only files changed by V30.42 and no models.

## Why V30.42 exists

The V30.41 real-device diagnostic showed that the final mesh was not the first point at which geometry became wrong. The committed splats themselves could already be nonsensical. The same run ended with 24 RGB photo edges but `0 active / 4 weak / 20 rejected` while all 30 Alva priors remained active at about 0.995. The final global reconcile improved RGB to `0 active / 16 weak / 8 rejected`, but still had no truly active whole-photo RGB edge. At the same time, V30.41 called 866 dense splats confirmed and the multi-layer mesher used only 22 of them.

V30.42 therefore moves the trust boundary upstream: **no dense point becomes authoritative merely because it existed in an earlier local reconstruction**.

## 1. Stored MVS depth is now a proposal, not a metric fact

V30.41 persisted MVS `(u,v,depth)` estimated under the acquisition poses and later unprojected the old depth using optimized poses. That is not invariant to pose correction.

V30.42 adds `js/probabilistic/final_mvs_revalidation.js`:

- at committed rebuild time, each stored MVS depth is rescored in a compact depth neighbourhood;
- scoring uses the downsampled RGB photographs and the **current optimized poses**;
- source views outside the commit set cannot confirm the point;
- the winning depth is accepted only with final-pose photometric support;
- an MVS point is committed only with at least two independent validating source views, or one independent view plus a compatible sparse RGB anchor;
- rejected/stale MVS points remain candidate diagnostics and never become committed surface geometry;
- diagnostics report input/committed/rejected counts, commit fraction, mean depth correction, photometric cost and relative-pose drift.

## 2. Dense worker output is candidate-only

Raw/live dense worker splats and mesh are no longer written into the authoritative 3D state.

- `state.gaussians`, `state.mesh` and `window.__ROOMSCAN_METRIC_MESH` are populated only by validated final reconstruction;
- worker splats/mesh are stored separately as `denseCandidateGaussians` / `denseCandidateMesh`;
- optimized preview splats replace the previous validated preview instead of being accumulated across changing pose states;
- this removes stale “ghost splats” left in world space after the optimizer changes camera poses.

Old V30.41 saved/R30 geometry with a reloadable factor graph is also withheld as legacy candidate geometry and must pass V30.42 final-pose revalidation before becoming authoritative.

## 3. RGB validation is independent from the RGB switches it judges

V30.41's robust reprojection statistic was weighted by the same switch/posterior of the photo edge. An edge could therefore switch itself off and simultaneously stop contributing to the metric used to validate the solution.

V30.42 separates:

- `reprojectionOptimizationRobustRmse`: switch-weighted objective used internally;
- `reprojectionRobustRmse` / `reprojectionIndependentRobustRmse`: robust but switch-independent validation statistic.

The switch update itself was also changed: missing/finite support is no longer treated as negative evidence. Visual prior + independent geometric agreement update bounded log-odds; shared-landmark reprojection becomes more authoritative as the number of shared landmarks grows.

A previously collapsed edge can recover during final RGB reconciliation if geometry actually agrees; a geometrically bad edge still loses authority even if its rotation is perfect.

## 4. Committed geometry requires real RGB consensus

`rgb_consensus_policy.js` classifies the whole-photo RGB state. During final commit:

- severe RGB collapse is a hard stop;
- a merely non-collapsed but still weak graph is also insufficient to authorize dense geometry;
- the optimized pose snapshot is retained for diagnostics, but `rebuildAccepted()` returns `withheldReason` and no authoritative surface.

This is intentional. In V30.42, **no mesh/splats is a valid safe outcome when evidence is insufficient; nonsensical committed geometry is not**.

The factor graph now also persists `photoEdgeAudit` (`inputEdges`, `importedEdges`, `unresolvedEdges`, `importFraction`) so the 13-photo/41-edge versus 24-imported-edge failure seen in the real log cannot disappear silently.

## 5. RGB submap edges no longer fabricate metric translation

The old `SubmapPoseGraph` created the translation part of a photo-edge measurement from the current submap prior itself, creating an auto-confirming constraint.

V30.42 treats a whole-photo RGB edge as what it actually observes here:

- rotation: observed;
- metric translation: **not observed**.

Adjacent globally optimized submap anchors provide only weak metric regularization. RGB photo edges cannot move translation by pretending the prior was a new measurement.

## 6. “Confirmed” dense evidence now requires independent final support

Dense fusion no longer converts source-ID count into geometric confirmation. Surface evidence carries explicit:

- `independentSupport`;
- `anchorSupport`;
- `finalPoseValidated`.

Historical source IDs by themselves cannot manufacture confirmation. Deep samples are likewise committed only when trusted and independently supported (or one independent support plus a compatible sparse RGB anchor); the rest remain candidates.

## 7. Multi-layer TSDF uses conflicts, not connected components

V30.41 equated a spatial connected component with a surface layer and then dropped small layers. In the real run this reduced 866 confirmed input splats to 22 meshed surfels.

V30.42 uses a local conflict graph with global colouring:

- spatially disconnected compatible pieces may share one layer;
- only nearby incompatible hypotheses are forced into different layers;
- no layer is discarded merely because it contains fewer than four surfels;
- the mesh reports `inputSurfels`, `sourceSurfels`, `droppedSurfels` and `meshedSurfelFraction`;
- the mesh audit marks severe evidence loss as fragmented even if the component count happens to be below the old numeric threshold.

## 8. Diagnostics added/strengthened

Important V30.42 fields/events include:

- independent vs optimization robust reprojection;
- `rgbConsensusCollapsed`, `rgbConsensusCommitReady`;
- `rgbEdgeInput`, `rgbEdgeUnresolved`, `rgbEdgeImportFraction`;
- `mvsValidation.input/committed/rejected/commitFraction`;
- `mvsValidation.meanDepthCorrectionRel`;
- `mvsValidation.meanPhotometricCost`;
- `mvsValidation.maxRelativePoseDriftTranslation/RotationRad`;
- `finalPoseMvsRevalidation: true`;
- `submapPoseGraph.photoTranslationFabricated: false`;
- mesh `meshedSurfelFraction` and `evidenceStarved` classification;
- `single-opt-commit-withheld` when a pose solution is not allowed to create authoritative dense geometry.

