# V30.40 phone validation

The purpose of this build is first to verify that the single optimizer can bootstrap and make explainable progress on a real scan.

1. Run a normal scan with textured overlap and some lateral motion.
2. Finish the scan and open REVIEW.
3. Press **Continua OPT UNICO**.
4. Open Debug only after a few cycles or export the diagnostic JSON.

Expected on a difficult unoptimized session:

- first cycles contain `single-opt-cycle-start` with `bootstrap:true`;
- `single-opt-step.phase` is initially `rgb-bootstrap`, not `depth-feedback`;
- logs report `reprojectionRobustRmse`, raw `reprojectionRmse`, median and P90;
- an internally improving but not yet accepted candidate may log `single-opt-bootstrap-progress`; the visible preview must not move;
- once a candidate passes the gate, `single-opt-candidate-accepted` appears and later cycles may enter `depth-feedback`;
- the solver must never repeat the exact same rejected state hundreds of times. After four no-progress cycles it reports `single-opt-stalled` and stops.

If `single-opt-stalled` occurs, export the diagnostic log. The most useful fields are robust/raw/median/P90 reprojection, RGB edge mean/active/weak/rejected counts, Alva switches, pose delta and `progress`.
