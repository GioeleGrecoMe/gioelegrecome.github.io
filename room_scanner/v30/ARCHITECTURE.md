# Room Scanner V30.29 architecture

## 1. Problem statement

For keyframe `i` we have:

- RGB image `I_i`;
- Alva pose prior `T_i` and pose covariance;
- camera intrinsics `K_i`;
- raw relative Depth Anything field `D_i(u,v)`;
- sparse feature observations / landmarks;
- optional independent MVS likelihood samples.

The desired scene is not defined as a cloud that must be accepted once. It is the smallest set of surfaces/particles that explains the observations from all connected views.

## 2. Photo puzzle

The first stage builds a graph `G=(V,E)` where nodes are photographs and edges are visually verified overlap. Candidate Alva points are matched with BRIEF-like appearance, local ZNCC, mutual uniqueness and Alva-pose epipolar compatibility.

A global panorama homography is intentionally not used: camera translation creates real parallax. The spherical/equirectangular atlas is a diagnostic coverage projection only. Geometry continues to use the original calibrated rays and poses.

Disconnected or weak frames are retained with low confidence. They can become connected later through loop closure or a revisit.

## 3. Pose-aware Deep scale graph

For a verified photo match `(u_i,u_j)`, the known poses define two calibrated rays. Their closest-point triangulation yields world point `X` with geometric quality from angle and ray gap. The corresponding metric/Alva optical depths are

`z_i = project(T_i,K_i,X).z`

`z_j = project(T_j,K_j,X).z`.

Raw Deep values are sampled at the same pixels. Thus the graph stores calibration evidence `(D_i(u_i), z_i)` and `(D_j(u_j), z_j)` rather than incorrectly enforcing `D_i ≈ D_j` or `z_i ≈ z_j`.

Across the sequence, three monotonic model families are compared:

- `z = a D + b`
- `z = a / D + b`
- `1/z = a D + b`.

The model family is selected globally, while each well-supported frame gets its own robust affine parameters. Weak frames borrow a low-confidence prior from connected neighbours. Good per-frame fits are not averaged away.

## 4. Depth convention

`projectPoint` and MVS depth use camera optical `Z`. A normalised camera ray has third component `d_z`, therefore the corresponding Euclidean range is

`r = Z / d_z`.

All hybrid-solver rays use `r`; all photogrammetric projection/calibration continues to use optical `Z`. Keeping this convention explicit prevents systematic radial curvature.

## 5. Probabilistic observations

Every scene observation is represented by:

- camera origin `o`;
- unit ray `d`;
- range mean `r`;
- axial standard deviation `sigma_r`;
- lateral standard deviation `sigma_t`;
- source/provenance and frame ID;
- confidence weight and RGB colour.

The covariance is anisotropic: uncertainty is much larger along a monocular ray than across it. Track/MVS observations receive more authority than dense Deep completion.

## 6. Plane-first room model

The solver first searches for large multi-view planar explanations. A candidate plane residual uses uncertainty projected onto the plane normal:

`var(n) = sigma_t^2 + (sigma_r^2 - sigma_t^2) (n·d)^2`.

This means a grazing ray cannot use its large axial uncertainty to excuse a large wall-normal error.

Accepted planes are refined by weighted PCA, bounded by robust 2D quantiles, and optionally snapped to a soft Manhattan frame. Snapping is only applied when a plane is already close to a dominant axis.

If three orthogonal axis groups each contain two strong opposite boundaries, the renderer emits a direct shoebox mesh. Otherwise each verified plane remains an independent surface patch.

## 7. Residual particle model

Only observations not sufficiently explained by planes enter the particle solver. The user selects the maximum particle count (1,000–10,000).

Initial particles are compact weighted clusters of residual observations. Deterministic annealing/EM then alternates:

1. soft probabilistic observation-to-particle association;
2. information-form update using anisotropic ray covariance;
3. confidence/support update;
4. optional rebirth of unsupported particles into unexplained high-likelihood regions.

Temperature decreases with iteration count. The validation loss is evaluated at a fixed definition independent of temperature. A candidate update is accepted only if validation does not increase; otherwise damping is reduced, then the step is rejected if necessary.

This is the diffusion-model intuition implemented as an optimisation process, not as another large neural network.

## 8. Live scan closure

The online `ViewSphereCoverage` stores directional coverage, connection quality and loop closures. `readyToClose` requires substantial seen/strong coverage, connected views and at least one photographic loop closure. A weak current view produces a revisit instruction rather than disappearing from the dataset.

## 9. Representation hierarchy

The intended authority order is:

`photo connectivity -> pose-aware triangulation -> sequence Deep calibration -> planes -> residual particles -> derived mesh`.

Legacy Gaussian/TSDF results remain available as BASE diagnostics, but they are no longer the primary V30.29 post-processing path.
