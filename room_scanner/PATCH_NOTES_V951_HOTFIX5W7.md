# Room Scanner v9.5.1 Hotfix5W7

Build: `v9.5.1-hotfix5w7-stable-object-picking`  
Deploy revision: `951h5w7`

## Root causes fixed

1. Step 3 still gated MobileSAM on local XR depth even though SAM only needs an RGB prompt.
2. The first object tap could combine an old map/depth frame with the current camera bitmap, making RGB/pose/depth inconsistent.
3. A frozen snapshot could age out while the user was working, returning the reticle to a non-ready state.
4. The MobileSAM mask path rejected masks before display when the single frozen frame had too few depth cells.
5. Touch events were not isolated strongly enough from WebXR `beforexrselect` / delayed browser click behavior.
6. Primary live surfaces at 17% alpha obscured the camera when many planes overlapped.

## H5W7 behavior

- SAM readiness is RGB-first. Depth is not a prerequisite for moving the reticle or running MobileSAM.
- Every tap creates a fresh object snapshot from `latestCameraView`: RGB, world-to-view transform, projection and camera pose belong to the same instant.
- A depth grid is copied only when a map frame is within 260 ms of that RGB timestamp.
- If frozen-frame depth is sparse, the completed SAM mask is projected into the existing WebXR surfel field; the front-most surfel per mask cell supplies 3D support.
- 2D masks are always allowed to display. `Save this view` remains disabled until the mask has sufficient metric support, so no null bounds can crash the object flow.
- Step 3 preserves Gaussian/splat and primary-plane visibility.
- Object selection uses `pointerdown`, prevents propagation/default browser behavior, and blocks `beforexrselect` on the object overlay.
- Primary structural surfaces are now rendered with opacity `0.045`.

The MobileSAM / Depth Anything model contracts from H5W6 are unchanged.
