# Room Scanner v9.5.1 hotfix1 - bootstrap regression

## Fixed

The v9.5.1 guided-only semantic policy replaced the historical semantic queue with a no-op using an undeclared assignment:

`pumpSemanticQueue = async function(){...}`

Because the application script is an ES module, that assignment throws `ReferenceError: pumpSemanticQueue is not defined` during module evaluation. The failure occurs before the microphone and speaker button handlers are registered, making the calibration UI appear unresponsive.

The hook is now an explicitly declared async function. Its behavior remains a no-op, so MobileSAM still runs only during guided object capture and never in the realtime acoustic measurement loop.

## Regression coverage

`tests/test_v951_bootstrap_regression.py` now asserts that:

- `pumpSemanticQueue` is a declared function;
- the unsafe naked assignment is absent;
- microphone and speaker bindings are still present and occur after safe module evaluation;
- the underlying `prepareAudio` and `chooseAudioOutput` functions remain intact.

No DSP, WebXR, geometry, MobileSAM inference, measurement scheduling, or export logic was changed.
