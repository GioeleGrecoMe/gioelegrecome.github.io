# V30.39.0 test report

## Diagnostic regression target

Input diagnostic: `roomscan-diagnostics-1787329833298.json` from V30.38.1.

Observed failure pattern:

- live optimizer worker repeatedly created and failed;
- no candidate ever reached the acceptance/rejection gate;
- final optimizer state remained not ready;
- factor graph contained far fewer whole-photo RGB edges than the independently reconstructed panorama.

V30.39 removes the failed optimizer worker path instead of adding another fallback.

## Automated suite

`npm test`: 170 / 171 PASS.

The only failing test is the expected local-model filesystem check for `models/model_q4.onnx`, because the supplied project intentionally excludes `models/`.

A new execution test instantiates `SingleOptimizerRuntime` on a synthetic multiview RGB scaffold and verifies that a complete cycle reaches:

- cycle-start;
- optimizer step;
- acceptance gate;
- accepted or rejected decision;

without any Worker.

## Additional checks

- layout: PASS
- dependency closure: PASS (50 local references)
- EventTarget constructors: PASS (5/5)
- mock UI boot: PASS
- Alva runtime contract: PASS
- Depth diagnostics: PASS

## Operational uniqueness checks

Tests explicitly verify that the application does not reference or instantiate the legacy optimizer workers and that REVIEW does not expose Puzzle/Surface Mesh Lab optimizer controls.

`ProbabilisticJointOptimizer` via `SingleOptimizerRuntime` is the only operational optimizer in both acquisition and REVIEW.
