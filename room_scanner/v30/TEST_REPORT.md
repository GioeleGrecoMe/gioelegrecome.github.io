# V30.4.0 test report

Build: `v30.4.0-20260819-relative-L-map`

The following suite was run from the final project directory:

```
./tests/run_tests.sh
```

Result:

```
PASS javascript_syntax
PASS static_contract
PASS bootstrap_contract ids=41
PASS wasm_frontend features=96 matches=24 portrait=500
PASS camera_analysis_fit
PASS math_depth_calibration
PASS slam_markpoints_and_relative_map
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
- WASM exports its dimensional limits and accepts the portrait analysis frame;
- portrait and landscape camera analysis dimensions remain inside WASM limits;
- depth affine calibration and plane math pass synthetic tests;
- visual markpoints are accepted before depth is available and are promoted
  when their track gains a relative-L depth landmark;
- low-confidence monocular depth is normalized to relative unit L and fused,
  instead of blocking the Gaussian map;
- binary/CRLF ASCII Gaussian PLY import/export round-trips;
- `.r30` binary Gaussian, JPEG, descriptors, keyframe index and extra entries round-trip;
- static HTTP serving returns the entry page, JS, workers and WASM;
- WASM is served with `application/wasm`;
- manifest and build-info JSON parse.

A Chromium headless visual bootstrap was attempted in the container but the
installed Chromium cannot initialize EGL/ANGLE in this environment and exits its
GPU process before producing DOM output. This is an environment limitation, not
counted as a pass. The in-app self-test is therefore included specifically to
exercise bootstrap/WASM/worker/IndexedDB contracts on the real phone.
