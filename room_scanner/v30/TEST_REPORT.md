# V30.1.0 test report

Build: `v30.1.0-20260819-standalone-debug-bootstrap`

The following suite was run from the final project directory:

```
./tests/run_tests.sh
```

Result:

```
PASS javascript_syntax
PASS static_contract
PASS bootstrap_contract ids=41
PASS wasm_frontend features=35 matches=8
PASS math_depth_calibration
PASS format_roundtrip
PASS http_smoke
PASS json_contracts
ALL TESTS PASSED
```

Verified contracts:

- every JS/Worker file parses with Node;
- all runtime files referenced by V30 exist;
- HTML contains every DOM element referenced by the main controller;
- slider, Start, diagnostics-download and self-test bootstrap bindings exist;
- no HTML/JS/CSS runtime reference uses a V20 filename/path;
- the real `slam_core.wasm` instantiates and returns features + frame matches;
- depth affine calibration and plane math pass synthetic tests;
- binary Gaussian PLY export/import round-trips;
- `.r30` binary Gaussian + JPEG container round-trips;
- static HTTP serving returns the entry page, JS, workers and WASM;
- WASM is served with `application/wasm`;
- manifest and build-info JSON parse.

A Chromium headless visual bootstrap was attempted in the container but the
installed Chromium cannot initialize EGL/ANGLE in this environment and exits its
GPU process before producing DOM output. This is an environment limitation, not
counted as a pass. The in-app self-test is therefore included specifically to
exercise bootstrap/WASM/worker/IndexedDB contracts on the real phone.
