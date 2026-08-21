# V30.40 focused check

After deployment verify the build badge is V30.40.0. Load or create a session, press **Continua OPT UNICO**, then inspect/export Debug.

Success criteria: `rgb-bootstrap` appears before `depth-feedback`; robust/raw/median/P90 reprojection are present; at least one candidate is accepted or the solver terminates with an explicit bounded `single-opt-stalled`; identical rejected cycles must not continue indefinitely.
