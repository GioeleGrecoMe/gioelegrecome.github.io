# Room Scanner V30.11.3

## Fix: metric lock -> scan constructor crash

The phone-reported error was:

`Must call super constructor in derived class before accessing 'this' or returning from derived constructor.`

Root cause: `SlamEngine` extends `EventTarget`, but its constructor assigned fields on `this` before calling `super()`.
The crash happened immediately after a valid metric lock when `startScan()` constructed `new SlamEngine(...)`.

V30.11.3 changes the constructor to call `super()` first.

Regression coverage now checks every runtime class derived from `EventTarget` and directly constructs a `SlamEngine` followed by `setMetricScale(1)`.

No calibration thresholds, anchor logic, metric matcher thresholds, or camera-stream handoff behavior were changed in this release.
