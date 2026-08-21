# Room Scanner V30.37 architecture

## 1. Epistemic hierarchy

The estimator is not symmetric:

`multi-view RGB geometry > multi-view-consistent calibrated Depth > single-view Depth`

AlvaAR supplies initialization and temporal continuity. It can be contradicted by the scene.

The global state is solved hierarchically rather than by freeing pose, intrinsics, depth and surface simultaneously from the first frame.

## 2. Exact-frame RGB + Depth acquisition

The user-visible spherical panorama still admits only frozen RGB frames whose same immutable frame has a valid Deep result. RGB registration never reads Alva pose. Alva pose, if available, is stored as optional metric evidence.

Every frozen RGB frame also receives cheap image-only quality diagnostics (blur/texture/exposure/clipping). These diagnostics only modulate later authority; they never place a photograph.

## 3. Sparse RGB scaffold

Robust RGB feature tracks and triangulation create sparse 3-D landmarks with covariance. Individual feature residuals use a continuous robust loss. Whole RGB photo edges have a switch `s_ij`, so a bad pair can collapse without deleting all measurements in a good pair.

The factor graph persists exact `frameId` references; panorama array indices are converted to persistent frame IDs before storage.

## 4. Alva as switchable relative prior

For consecutive posed frames the graph stores relative Alva increments. Translation and rotation have distinct switches because one may be reliable when the other is not.

The absolute Alva pose has only a small gauge weight. Relative increments are the main tracker prior. Tracking loss/relocalization lowers prior confidence instead of forcing the scene to follow the tracker.

Switch posterior state is persisted in optimizer snapshots and survives session reload.

## 5. Observable Depth calibration

The Deep output is interpreted as relative inverse-depth coordinate:

`rho_i(u) = a_i * F_gamma(d_i(u)) + b_i`.

`F_gamma` is one monotone, low-order response for the whole scan. Per-frame `(a_i,b_i)` freedom is selected by observability:

- `full`: scale + shift observable;
- `shift-only`: scale inherited, shift may update;
- `inherit`: both inherited/predicted.

The test uses depth span, geometric span, image coverage and conditioning. Nearly planar views cannot invent two independent calibration parameters.

## 6. Two-rate causal feedback

### Fast loop

Every optimizer iteration:

`RGB switches -> landmarks -> pose -> RGB switches -> relative Alva switches`.

### Slow loop

Every N iterations (default 2):

`Depth calibration -> leave-one-view-out consistency -> reliability E-step -> Alva/pose feedback`.

The reliability produced by the previous slow loop reweights geometric anchors in the next Depth calibration. This prevents a pose-suspect frame from making Depth absorb the pose error.

## 7. Residual cause model

The spatial residual field is summarized as a low-dimensional global component plus local deviations. The estimator scores six explanations:

- pose error;
- global Depth calibration error;
- local Depth failure;
- wrong RGB edge/matches;
- occlusion;
- dynamic content.

A coherent image-wide/gradient field increases pose suspicion; a localized patch increases local-Depth suspicion. RGB reprojection improvement is part of this diagnosis.

## 8. Hierarchical confidence

No per-pixel optimization variable is introduced. Confidence is compact:

- frame confidence;
- RGB/Alva edge switches;
- region confidence (8x8 by default);
- derived pixel confidence from frame + region + residual + structural edge + visibility.

This keeps the feedback feasible on a phone while retaining spatial selectivity.

## 9. Visibility and leave-one-view-out Depth consistency

A Deep sample is reprojected only into other views. Visibility/z ordering distinguishes same-surface support, occlusion and true conflict. The evaluator records supporting frame IDs and triangulation angles, so repeated nearly identical views do not masquerade as independent evidence.

## 10. Candidate vs confirmed geometry

A new Depth sample does not enter committed geometry merely because it exists.

It becomes committed only if:

- it is cross-view `trusted`; and
- it has at least two independent supporting views with useful baseline, **or** one independent supporting view plus a local sparse RGB anchor.

Otherwise it remains `candidate`. Candidate samples are available for diagnostics/preview but never enter the committed TSDF/mesh.

Sparse RGB-supported surface evidence is labelled `strong`; verified multiview evidence is `confirmed`; lower-authority but still accepted evidence remains `weak`.

## 11. Correlated uncertainty and evidence budget

Point covariance contains Depth uncertainty and pose uncertainty. A whole photograph therefore carries correlated pose error; thousands of pixels do not create infinite information. Each Deep frame has a maximum dense information budget before submap fusion.

## 12. Local submaps and global feedback

Dense evidence is fused once into one primary local submap. Overlap between submaps exists for graph connectivity, not duplicate evidence counting.

Late RGB loop closures build a separate submap pose graph. Global correction changes only each submap rigid anchor transform; already fused dense samples do not need destructive global TSDF de-integration/re-integration.

## 13. Camera and structural priors

Session intrinsics are locked (scaled only with raster size); focal length is not a free escape variable for bad Depth/pose.

Planes and Manhattan priors remain late, soft structural constraints. They do not manufacture early geometry.

## 14. Final committed product

The final mesh is generated only from committed submap evidence. Candidate, conflicting, occluded and dynamic/suspect Deep observations cannot directly create triangles.
