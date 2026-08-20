# V30.27 EXP-2 verification report

Final verification command:

```bash
npm run verify
```

Result: **PASS**.

- Node tests: **101/101 passed**, 0 failed.
- Exact-frame Deep/Alva synchronization regressions: PASS.
- Depth Anything tensor/stripe/coherence diagnostics: PASS.
- Published layout/version contract: PASS.
- Local dependency closure: PASS (29 references resolved).
- EventTarget constructor safety: PASS (5/5 derived classes).
- Mock UI boot and failed-WebXR recovery: PASS.
- AlvaAR runtime contract: PASS.

EXP-2 adds a hard source-frame contract from camera capture to Gaussian fusion:

1. `CameraController.capture()` allocates an immutable `frameId` before any
   consumer processes the raster.
2. `SlamEngine` propagates that exact `frameId` to observations and keyframes.
3. Dense keyframe creation rejects a keyframe/raster identity or timestamp
   mismatch before downsampling.
4. Every Deep request stores a binding containing `jobId`, `frameId`, `frameAt`,
   source raster dimensions and an FNV-style sampled RGB fingerprint.
5. The Deep worker independently recomputes the fingerprint from the transferred
   RGBA buffer and echoes all correlation metadata with the result.
6. `app.js` validates all fields before calibration or fusion. A late/out-of-order
   result cannot use the current Alva pose/features and falls back to MVS-only.
7. Sparse track evidence and Gaussian support use source camera `frameId`s rather
   than asynchronous completion time or only the derived keyframe ID.

The Surface Mesh Lab remains isolated/reversible exactly as in EXP-1.
