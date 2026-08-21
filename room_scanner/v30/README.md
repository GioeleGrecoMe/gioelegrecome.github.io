# Room Scanner V30.37 · causal probabilistic feedback

V30.37 keeps the V30.34/35 spherical RGB+Depth acquisition path and the V30.36 observability hierarchy, but changes the estimator from a one-way pipeline into a causal feedback system.

The authority order is deliberately asymmetric:

`multi-view RGB geometry > multi-view-consistent calibrated Depth > single-view Depth`

AlvaAR is a dynamic prior, not a source of truth. Its relative frame-to-frame increments are retained with independent translation/rotation switches; its absolute pose is only a weak gauge regularizer.

The post-scan estimator now runs three nested levels:

1. **Fast frame loop** — robust RGB landmark/pose refinement + switchable RGB edges + switchable relative Alva increments.
2. **Slow Depth loop** — observability-gated inverse-depth calibration, leave-one-view-out consistency, frame/region/pixel reliability and causal residual diagnosis. The E-step confidence from one cycle reweights the next calibration cycle.
3. **Global submap loop** — confirmed evidence is fused locally, while loop closures move whole submaps rigidly through a submap pose graph.

Deep uses

`rho_i(u) = a_i * F_gamma(d_i(u)) + b_i`

where `F_gamma` is a single low-DOF monotone function shared by the entire scan. Per-frame calibration can be `full`, `shift-only`, or `inherit` depending on geometric observability. There is no free nonlinear function per photograph.

Dense Deep samples are split into **candidate** and **committed** geometry. A sample cannot validate itself: it must receive independent leave-one-view-out support with meaningful camera baseline, or independent support plus a local sparse RGB anchor. Conflicts and occlusions are not averaged into a false surface. Dynamic/suspect frames are heavily downweighted or kept candidate.

The final Gaussian/surface representation exposes evidence classes (`strong`, `confirmed`, `weak`); candidate Deep evidence is kept separate and never enters the committed TSDF/mesh.

The live RGB panorama remains pure-photo spherical registration. Only frozen RGB frames carrying their exact same-frame Depth evidence (or explicitly scheduled to obtain it) enter that photo/depth stream.
