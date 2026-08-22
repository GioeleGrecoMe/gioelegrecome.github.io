# V30.40 · robust RGB bootstrap optimizer

This patch addresses the real V30.39.2 REVIEW log in which a 44-frame graph started at raw reprojection RMSE ~19.65 px, entered Depth feedback immediately, rejected all 9 RGB photo edges, failed the absolute reprojection gate, and then repeated the same candidate hundreds of times.

Changes:

- RGB-only bootstrap before Deep feedback;
- pose/landmark refinement occurs before RGB whole-edge posterior update;
- annealed whole-photo switches during bootstrap;
- sparse RGB measurement support cannot be annihilated by a weak whole-photo edge;
- robust weighted reprojection is the gate metric; raw RMSE is diagnostic;
- median, P90 and <4 px inlier fraction are logged;
- safe rejected progress may be retained internally without changing preview;
- four no-progress cycles cause a bounded `single-opt-stalled` stop;
- REVIEW shows candidate/bootstrap metrics when no state has yet been accepted;
- saved sessions restore the last accepted live optimizer state;
- the complete OPT UNICO ESM closure is republished with build tag 30.40.0.

No alternative optimizer or legacy fallback has been reintroduced.
