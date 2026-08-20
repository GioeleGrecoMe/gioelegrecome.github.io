# V30.25.0 verification report

Final verification command:

```bash
npm run verify
```

Result: **PASS**.

- Node tests: **91/91 passed**, 0 failed.
- Depth Anything tensor/stripe/coherence diagnostics: PASS.
- Published layout/version contract: PASS.
- Local dependency closure: PASS.
- EventTarget constructor safety: PASS (5/5 derived classes).
- Mock UI boot and failed-WebXR recovery: PASS.
- AlvaAR runtime contract: PASS.

V30.25-specific regressions cover:

- noisy multi-view feature tracks refined by joint reprojection optimisation;
- full 3x3 feature-landmark covariance;
- proxy-depth de-duplication between track, MVS and Deep evidence;
- two incompatible continuous Gaussian hypotheses inside one spatial-hash cell;
- information-form fusion and covariance reduction only for new camera evidence;
- replay/out-of-order evidence protection;
- anisotropic covariance preservation through PLY export/import;
- full covariance projection in live AR and review splat renderers;
- unknown TSDF space and voxel-centre mesh regressions.

The container has no usable phone-class WebGPU/display context, so visual quality
and actual scan convergence must still be evaluated on the target smartphone.
