# H5W7 verification report

Build: `v9.5.1-hotfix5w7-stable-object-picking`  
Deploy revision: `951h5w7`

## Verified invariants

- MobileSAM model contracts from H5W6 unchanged and passing.
- Depth Anything model/runtime tests unchanged and passing.
- Step 3 object prompt is RGB-first, not depth-gated.
- Current camera RGB is paired with its own pose/projection.
- Nearby XR depth is optional and accepted only within a 260 ms synchronization window.
- Existing WebXR surfels can metrically support a SAM mask when frozen-frame depth is sparse.
- A 2D-only SAM mask is displayed safely; metric confirmation remains disabled until enough 3D support exists.
- Object tap uses pointerdown + propagation/default suppression + `beforexrselect` prevention.
- Gaussian/splat and primary surfaces stay visible in Step 3.
- Primary plane opacity is 0.045.
- Stage 5 fullscreen viewer, audio, calibration, cooperative DepthAI, Gaussian fallback and model verification regressions remain passing.

## Suite result

`tests/run_current_suite.sh`: PASS

Latest deep audit:

- DOM IDs: 283
- simple DOM refs: 257
- UI handler targets: 101
- named functions: 664
- duplicate named functions: 0
