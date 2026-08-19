# Room Scanner V30.8.0 - internal verification

Tested from the standalone source tree after the user-selected multi-view WebXR
landmark calibration changes.

```text
== JavaScript syntax ==
PASS javascript_syntax
PASS static_contract_selected_multiview_xr_metric
PASS bootstrap_contract ids=67
PASS camera_portrait_fit
PASS wasm_frontend features=35 matches=8
PASS wasm_portrait 270x480 features=700
PASS math_triangulation_plane
PASS xr_selected_landmark_primitives
PASS metric_bridge_multiview score=1.000 kind=multiview
PASS mvs_camera_only points=217 triangles=12 z=1.822
PASS format_roundtrip
PASS http_smoke
PASS json_contracts
ALL TESTS PASSED
```

The automated suite cannot emulate Android ARCore Raw Camera Access or physical
WebXR hit-test behaviour. Those two hardware-dependent pieces must still be
validated on the target smartphone. The bridge matching, WASM PnP frontend,
geometry primitives, MVS and packaging contracts are covered by deterministic
local tests.
