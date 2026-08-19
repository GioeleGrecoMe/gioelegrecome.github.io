# V30.1 debugging

## If controls do not react

Open `Diagnostica / debug`. Even if the main ES module failed, the pre-bootstrap
code keeps the camera-height slider alive and the diagnostics download button
can export `roomscan-v30-preboot-diagnostics.json`.

Check `homeStatus` for an explicit missing-asset path. V30 performs a startup
fetch check for the app module, SLAM math module, WASM core and both workers.

## Useful diagnostics events

- `bootstrap-start`, `bootstrap-complete`
- `preflight-assets-missing`
- `scan-start-failed`
- `camera-started`
- `analysis-frame-failed`
- `keyframe-captured`, `keyframe-persist-failed`
- `depth-inference-failed`, `depth-integrated`
- `gaussian-worker-error`
- `markpoint-created`, `markpoint-rejected`
- `finish-requested`, `finish-failed`
- `window-error`, `unhandled-rejection`, `pagehide`

## Files to attach to a bug report

Prefer all three when available:

1. diagnostics JSON;
2. raw `.r30`;
3. RGB Gaussian `.ply` if the issue is visual/reconstruction-related.
