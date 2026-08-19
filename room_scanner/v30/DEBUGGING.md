# V30.7 Debugging

The diagnostics drawer must remain usable even when scanning fails.

Important event groups:

- `bootstrap-*`: asset/bootstrap failures.
- `service-worker-*`, `build-mismatch`, `force-update-*`: stale-code/update problems.
- `xr-calibration-*`, `xr-anchor-accepted`: WebXR metric bootstrap.
- `metric-bridge-*`: Raw-Camera-template to getUserMedia hand-off.
- `analysis-frame-*`: WASM tracking failures/recovery.
- `keyframe-*`: persistent image capture.
- `mvs-*`: camera-only semi-dense reconstruction.
- `gaussian-*`: map worker state/errors.
- `markpoint-*`: metric repere state.

## Stale page recovery

Use **Forza aggiornamento** in diagnostics. It only removes registrations/caches whose scope/name belongs to `/v30/`; it does not touch V20 or unrelated sites.

## Calibration diagnostic thresholds

A calibration is accepted only with at least 10 stable anchors, sufficient XZ span, and sufficient vertical span. The visual bridge requires at least 8 located templates, robust PnP, and at least 6 bindings to current visual tracks.
