# V30.16.0 — Alva geometry-anchored dense mapping

## Root cause fixed

V30.15 transformed Alva camera translation as `[x,-y,-z]` but transformed the quaternion with a different, reflection-like sign pattern. Translation and orientation therefore did not describe the same camera basis. Dense multi-view geometry could still return photometric minima, but those minima formed a floating sheet/cloud in front of the camera rather than surfaces attached to the room.

V30.16 uses one proper right-handed CV basis everywhere in reconstruction: **+X right, +Y down, +Z forward**. This is a 180-degree rotation around X from the native Three/WebGL/WebXR camera convention, not a reflection.

## Geometry gate before dense depth

The dense mapper no longer invents an initial depth range from baseline alone. Each dense job now first matches the descriptors extracted preferentially at Alva tracked points. Matches must pass:

- mutual descriptor matching / ratio test;
- positive-depth triangulation;
- minimum parallax;
- ray-gap relative to camera baseline;
- reprojection in both keyframes.

At least five verified sparse depth anchors are required. Their robust depth quantiles define the plane-sweep near/far interval, and nearby anchors constrain the accepted dense depth. If geometry is not strong enough, V30.16 waits instead of producing a fake surface.

## Visual diagnostic

Green points remain the current 2D Alva tracking points. Cyan points are new: they are **3D reprojection-verified geometry anchors** projected from the persistent Alva world into the current camera. Cyan points should remain attached to edges while the camera moves. This cleanly separates pose/intrinsics problems from later TSDF/fusion problems.

## Compatibility

Existing profiles saved with the legacy `+X right +Y up +Z forward` convention are migrated in memory to the new RH/CV convention; a recalibration is not required solely because of this coordinate fix. New WebXR calibrations are saved directly in the new convention.
