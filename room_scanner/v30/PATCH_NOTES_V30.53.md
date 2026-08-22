# Room Scanner V30.53.0

## Global MVS scale and surface-authority fix

V30.53 fixes the post-scan failure observed in V30.52 where independently re-triangulated MVS views could acquire radically different near/far depth intervals in the same Alva world frame. Weak-baseline views could therefore collapse onto a private near/far boundary and feed mutually incompatible surface patches to global fusion.

Changes:

- one shared post-scan MVS depth envelope is built for the whole scan;
- optimized RGB landmarks are the preferred global depth-scale authority;
- per-view sparse triangulation is retained only as a local pixel prior and can no longer rescale a view;
- unsupported plane-sweep minima at the global near/far boundaries are rejected;
- the minimum triangulation angle is enforced rather than accidentally capped;
- MVS surface radius survives factor-graph packing and final rebuild;
- verified MVS confidence is no longer implicitly reused as a second probability in fusion;
- plane-sweep confidence and final-pose revalidation confidence are combined without multiplying two confidence scores as if they were independent Bernoulli probabilities;
- authoritative global splats and TSDF mesh topology now have separate commit gates: a validated splat map can remain visible/exportable while a fragmented mesh is still withheld;
- all runtime/cache identities are bumped to 30.53.0, including the previously stale PWA manifest.

Depth Anything inference/model code is unchanged.
