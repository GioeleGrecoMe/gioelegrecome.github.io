# V30.26.0 verification report

Final verification command:

```bash
npm run verify
```

Result: **PASS**.

- Node tests: **94/94 passed**, 0 failed.
- Depth Anything tensor/stripe/coherence diagnostics: PASS.
- Published layout/version contract: PASS.
- Local dependency closure: PASS (28 references resolved).
- EventTarget constructor safety: PASS (5/5 derived classes).
- Mock UI boot and failed-WebXR recovery: PASS.
- AlvaAR runtime contract: PASS.

V30.26 adds persistent post-scan Gaussian state and an interruptible batch
optimiser. New regression coverage includes:

- bounded, view-diverse observation reservoirs exported by online Gaussian fusion;
- full covariance-weighted multi-view refinement;
- tangent-preserving local point-to-plane regularisation on planar surfaces;
- user-selected cumulative iteration targets and adaptive preview cadence;
- worker yielding and stop handling;
- review controls and local-session reload wiring;
- persistence before leaving review so the latest visible optimised state is not
  silently discarded;
- service-worker/dependency closure for the new optimiser module and worker.

The pre-optimisation TSDF mesh is intentionally marked stale once Gaussian
centres move. Exporting that stale mesh is refused rather than returning geometry
that no longer agrees with the refined Gaussian map.
