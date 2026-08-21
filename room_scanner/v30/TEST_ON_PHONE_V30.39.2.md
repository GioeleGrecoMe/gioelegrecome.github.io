# V30.39.2 phone check

1. Deploy the patch over V30.39.1.
2. Reload until the badge says V30.39.2.
3. Open an existing scan in REVIEW.
4. Press **Continua OPT UNICO** once.
5. Expected log: `single-opt-runtime-ready`, then `single-opt-cycle-dispatch`, `single-opt-cycle-start`, `single-opt-step`, `single-opt-gate` and accepted/rejected.
6. There must be no `dynamic-module-import-failed` for `single_optimizer_runtime.js`.
7. If a module load still fails, export diagnostics: V30.39.2 records a `critical-module-closure-probe` entry containing the exact asset(s) that are unavailable.
