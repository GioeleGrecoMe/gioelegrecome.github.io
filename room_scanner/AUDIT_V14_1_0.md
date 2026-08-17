# Audit V14.1.0

## Why this revision exists

V14.0.1 fixed raw-camera lifetime, but the application still ended the metric WebXR session after one room and expected manual panorama photography. This contradicted the Room Cells goal: multiple cells should be acquired within the same spatial reference while the user walks through declared portals.

## Architectural corrections

### One WebXR session for the whole scan

`newStationFromPortal()` no longer ends the XR session. The normal lifecycle is one `immersive-ar` session from the first capture station through all subsequent cells. Only `Termina intera scansione` finalizes the session. `Interrompi XR` is deliberately treated as an emergency action.

### Automatic guided panorama

The manual 360-photo interpretation has been replaced by AutoSurvey. A 24-bin angular coverage map chooses the weakest direction. Device translation/rotation rates are estimated from consecutive valid camera poses. The overlay tells the user to rotate, raise/lower, slow down or hold. A frame is queued automatically only after the requested direction is reached and motion is stable.

### Short parallax pass

After sufficient rotational coverage, the code generates up to three local targets approximately 0.38 m from the station, constrained to remain inside the footprint and away from walls. These translations create real spatial baselines for XR depth and foreground evidence. The user is guided to a target, then to the currently weakest wall, and an automatic frame is captured when stable.

### Raw-camera lifetime preserved

AutoSurvey never reads camera pixels directly. It uses the same queued-capture mechanism introduced in V14.0.1. `readCameraRGBA()` and `sampleDepthGrid()` are executed only inside the active XR animation callback. JPEG encoding remains outside the callback.

### Object persistence fixed

Older live evidence could appear persistent because observation IDs included time. V14.1 clusters observations by quantized camera position (`spatialViewId`). Repeated frames from essentially the same position therefore do not satisfy multi-view persistence. XR+Deep agreement is still allowed to validate a voxel.

### Processing budget

Automatic capture intentionally creates more useful images, so Deep batch selection is capped per cell and prioritizes height + parallax + diverse rotation images. Full Deep maps are released after classification.

## Explicitly not reintroduced

- no global TSDF;
- no Gaussian-splat optimizer;
- no mesh-detection dependency;
- no global wall/plane optimizer;
- no independent wall rotations;
- no Deep inference in live XR;
- no second camera stream.

## Verification scope

Automated tests cover syntax, Room Cells geometry, XR raw-camera lifetime, static architecture invariants, app bootstrap, AutoSurvey target generation/frame selection, unique function/DOM/listener audit and package metadata. A local Chromium smoke test can validate bootstrap/network behavior, but physical ARCore tracking/raw-camera/depth still require a compatible Android device.
