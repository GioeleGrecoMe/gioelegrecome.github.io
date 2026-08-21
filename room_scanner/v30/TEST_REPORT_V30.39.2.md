# V30.39.2 test report

## Regression reproduced from phone diagnostics
The phone served `js/probabilistic/single_optimizer_runtime.js` with HTTP 200 and JavaScript MIME, while browser dynamic import failed. This is consistent with a broken/stale transitive ESM dependency rather than a missing root module. V30.39 shipped the new root runtime without atomically republishing its complete dependency closure.

## Changes under test
- complete single-optimizer ESM closure is republished;
- every static import in that closure is tagged `?v=30.39.2`;
- rejected lazy imports are evicted from the module promise cache;
- closure-level diagnostics are emitted on import failure;
- optimizer mathematics/gates are unchanged.

## Results
- targeted ESM closure tests: 3/3 PASS;
- full Node suite: 175 total, 174 PASS, 1 expected filesystem failure (`models/model_q4.onnx` absent from the supplied project);
- layout: PASS (238 files in full validation tree);
- local dependency closure: PASS (50/50 references);
- mock UI boot/start path: PASS;
- Depth diagnostic worker: PASS;
- EventTarget constructors: 5/5 PASS;
- AlvaAR runtime contract: PASS;
- public TUM validation: PASS (85/86 correct matches, precision 98.84%, recall 100%, 6/6 photo frames connected, 15 edges, 6 loops, reprojection 2.2912 px -> 0.03318 px).

## Important limitation
The container Chromium executable did not terminate reliably in headless `--dump-dom` mode in this environment, so browser execution is covered by the existing mock/runtime tests plus a real Node ESM import of the complete graph. The deployed phone log remains the final browser validation.
