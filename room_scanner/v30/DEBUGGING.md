# V30.8 debugging

The diagnostics drawer is always available and can export the full log.

Calibration events of interest:

- `xr-candidates-updated`
- `xr-user-target-pinned`
- `xr-target-point-acquired`
- `xr-target-metric-ready`
- `xr-target-view-added`
- `xr-calibration-common-view-captured`
- `xr-calibration-saved`

Bridge events of interest:

- `metric-bridge-progress`
- `metric-bridge-success`
- `metric-bridge-attempt-failed`

For a good calibration, each selected target should reach at least 3 views and
~0.14 m maximum pose baseline. Before pressing the final calibration button,
`vista comune` must be `SI` and at least 10 metric micro-points should be visible.

If the bridge fails, export diagnostics before clearing site data. The important
numbers are recognised template count, PnP inliers, RMSE and whether calibration
was `ROOMSCAN-V30-XR-CALIBRATION-2`.
