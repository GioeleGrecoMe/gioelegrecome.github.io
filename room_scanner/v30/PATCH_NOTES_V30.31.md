# V30.31 incremental patch notes

## What changed

The panorama is now photo-first. AlvaAR remains attached to every frame as a 6-DoF metric prior with covariance, but its epipolar prediction cannot reject a valid RGB overlap. Registration uses photo descriptors and photometric checks, robust homography RANSAC, a visual rotation graph and a lightweight spatially varying local warp for walking parallax.

Depth Anything is treated separately from geometry. Raw depth maps are aligned statistically through the verified RGB correspondences, robust pairwise affine fits and confidence-weighted graph propagation. Suspicious maps lose authority instead of being averaged blindly.

The measurement screen is camera-first: panorama, depth preview and coverage are consolidated into one adaptive collapsible diagnostics panel.

Session snapshots and `.r30` now keep the evidence required to question Alva later: original Alva pose/covariance, visual orientation, edge confidence/RANSAC residuals, 2D correspondences, raw Deep sequence and depth-consensus diagnostics.

## Intentionally unchanged

No 3D Gaussian, TSDF, plane/particle, factor-graph optimiser or mesh-reconstruction algorithm was redesigned in this patch. The existing metric Deep/Alva scale graph is retained for metric evidence; it no longer drives photographic placement.

## Deployment

Apply the archive over the existing project root while preserving relative paths. Do not remove or replace the deployed `models/` directory. The build identity is V30.31.0 so the service worker creates a fresh shell cache; use the in-app cache reset once after publishing if a browser still holds an older controller.

## Verification status

All new panorama/depth/GUI tests pass. Full Node suite on the uploaded source: 132/133 PASS; the sole failure is the expected file-presence check for `models/model_q4.onnx`, absent because the uploaded archive intentionally excluded `models/`. Public TUM validation and all independent layout/dependency/depth/mock/Alva checks pass.
