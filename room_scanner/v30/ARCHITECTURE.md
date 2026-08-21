# Room Scanner V30.40 architecture

## 1. Authority hierarchy

`multi-view RGB geometry > multi-view-consistent calibrated Depth > single-view Depth`

AlvaAR is a switchable temporal/relative prior, not geometric truth. Camera intrinsics are session parameters, not free variables used to absorb scene errors.

## 2. Exact-frame RGB + Depth acquisition

Only frozen RGB frames associated with their exact same-frame Deep result enter the user-visible spherical photo/depth stream. RGB panorama placement is photo-only. Alva pose may be stored as metric evidence but cannot place a photograph in the panorama.

## 3. Sparse scaffold

Sparse RGB tracks and triangulated landmarks form the primary geometric scaffold. Individual measurements use continuous robust weighting. Whole-photo overlap edges have a separate switch `s_ij` for rejecting a bad image pair.

The two robust mechanisms deliberately have different roles: a few wrong correspondences must not destroy a good image pair, and one wrong image pair must not dominate the graph.

## 4. V30.40 bootstrap ordering

A new/unaccepted graph is not allowed to start with Depth calibration.

The first passes are:

`landmark refinement -> pose refinement -> annealed RGB-edge posterior -> pose refinement`

Only after the RGB scaffold has an accepted state, or has completed its RGB warm-up under the runtime gate, can the slow Depth feedback loop participate.

This ordering avoids the previous circular failure:

`bad initial pose -> RGB edge appears inconsistent -> edge switches off -> pose loses RGB evidence -> same bad pose remains`.

During bootstrap, whole-edge switches move slowly toward their posterior and have a prior-dependent floor. Sparse RGB track evidence also retains a small floor, so the graph can recover before deciding that an entire photographic edge is bad.

## 5. Accepted vs working state

The runtime maintains two distinct states:

- **accepted**: may update the visible preview and may be persisted as optimized geometry;
- **working**: internal recovery state, never shown as truth.

A rejected bootstrap candidate is allowed to become the next working seed only if it makes measurable safe progress in robust reprojection, robust energy or median reprojection without a catastrophic pose/edge change.

If four consecutive attempts produce no accepted state and no useful working progress, the runtime emits `single-opt-stalled` and stops. A new graph/evidence signature clears that stall automatically during live acquisition.

## 6. Robust reprojection gate

The optimizer records five complementary statistics:

- raw reprojection RMSE;
- robust weighted reprojection RMSE;
- median reprojection error;
- P90 reprojection error;
- fraction of observations below 4 px.

The acceptance gate uses the robust metric for absolute/regression decisions. Raw RMSE is diagnostic only and can legitimately remain high when a minority of observations are extreme outliers.

A sudden collapse of all strongly-supported RGB whole-photo edges remains a hard warning/gate unless there is very strong independent reprojection improvement. Weak whole-photo edges may all be rejected if the sparse RGB scaffold independently supports the geometry.

## 7. Alva prior

Relative Alva increments retain independent translation/rotation switches. Absolute Alva pose is only a weak gauge regularizer. During RGB bootstrap, Alva provides continuity while RGB is allowed to correct it; it cannot override a coherent multi-view scaffold.

## 8. Observable Deep calibration

Once RGB geometry is sufficiently stable, Deep is calibrated in inverse-depth coordinates:

`rho_i(u) = a_i * F_gamma(d_i(u)) + b_i`.

`F_gamma` is global, monotone and low-DOF. Per-frame calibration is selected by observability as `full`, `shift-only` or `inherit`; nearly planar views cannot invent both scale and shift.

## 9. Slow causal feedback

The slow loop performs Depth calibration, leave-one-view-out consistency, residual-cause classification, confidence update and limited pose feedback. Confidence from the previous slow loop reweights the next one, preventing a suspicious pose from being explained away by changing Deep calibration.

## 10. Candidate and confirmed dense geometry

A new Deep sample cannot confirm itself. It must receive independent multi-view support with useful baseline, or independent support plus a local sparse RGB anchor. Conflicts/occlusions stay separate rather than being averaged into a false intermediate surface.

Only confirmed evidence reaches committed submaps/TSDF. Candidate evidence remains available for diagnosis/preview.

## 11. Submaps

Dense samples are committed once to a primary local submap. Loop closure moves submaps rigidly through a submap pose graph, avoiding destructive reintegration of a monolithic global volume during every correction.

## 12. Diagnostic contract

Every optimizer cycle reports baseline, candidate, robust/raw reprojection statistics, edge switches, pose delta, phase, gate reasons, whether a working-only state was retained, stall count and graph summary. This is part of the estimator contract, not optional debug decoration.
