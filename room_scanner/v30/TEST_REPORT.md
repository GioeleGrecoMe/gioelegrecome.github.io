# V30.27 EXP-3 verification report

Final verification command:

```bash
npm run verify
```

Result: **PASS**.

- Node tests: **105/105 passed**, 0 failed.
- Exact-frame Deep/Alva synchronization regressions: PASS.
- Surface Mesh Lab isolation / rollback regressions: PASS.
- Noisy-plane local PCA improvement regression: PASS.
- 90-degree corner preservation regression: PASS.
- Off-grid metric plane / exact voxel-centre regression: PASS.
- EXP lazy module + worker publication contract: PASS.
- Depth Anything tensor/stripe/coherence diagnostics: PASS.
- Published layout/version contract: PASS.
- Local dependency closure: PASS (29 references resolved).
- EventTarget constructor safety: PASS (5/5 derived classes).
- Mock UI boot and failed-WebXR recovery: PASS.
- AlvaAR runtime contract: PASS.

Synthetic geometry checks:
- a noisy planar patch reduces both position and normal error under local PCA;
- perpendicular sheets remain separated by the normal gate;
- a plane at z=2.017 m reconstructed on a 3 cm voxel grid has mean mesh depth
  within 0.3 cm (observed test error is far smaller) because field values are
  evaluated at voxel centres rather than arbitrary splat samples.

A 16.9k-Gaussian synthetic plane benchmark on the verification CPU completed
local surface refinement in about 1 s and final mesh construction in about 2 s.
Phone time is device-dependent; preview budgets are deliberately lower.

The EXP map remains a private copy. BASE Gaussian data and BASE mesh state are
never overwritten by Surface Mesh Lab.
