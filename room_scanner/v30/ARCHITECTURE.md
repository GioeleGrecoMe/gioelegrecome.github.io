# V30.7 Architecture

## Coordinate contract

V30 mapping code uses +X right, +Y up, +Z forward. WebXR local-floor uses the WebXR viewer -Z-forward convention; the calibration boundary converts position with z reflection and orientation with `S R S`, `S=diag(1,1,-1)`.

## Metric bootstrap

WebXR is not the long-term tracker. It is a short calibration oracle:

- `local-floor`: metric floor-relative frame;
- `hit-test`: stable metric 3D reference points;
- `camera-access`: raw-camera patches attached to those 3D points.

The app requests a grid of hit-test rays. A point is retained only after repeated stable results. Low-texture raw-camera patches are rejected. Calibration requires both overall spatial span and vertical span.

## Visual hand-off

After XR ends, normal camera frames locate the stored templates. Their known metric 3D coordinates and current 2D locations form a 3D-to-2D PnP problem solved in WASM. The scan is blocked until this metric hand-off passes an inlier/RMSE gate.

## Camera-only SLAM

The frontend performs FAST/BRIEF and descriptor matching in WASM. Once metric landmarks exist, all pose updates come from 3D-to-2D PnP. Unmapped persistent tracks are triangulated across metric camera baselines.

## Camera-only dense geometry

The MVS worker selects pairs with sufficient baseline and limited view-angle change. It evaluates inverse-depth hypotheses with zero-mean patch correlation, rejects weak/ambiguous matches, outputs RGB metric points, and triangulates only locally consistent neighboring samples.

## Gaussian map

The Gaussian worker fuses WebXR seed anchors, sparse triangulated landmarks and MVS points into fine metric voxels. Each cell stores running mean/covariance, RGB, normal, view count and confidence. The Gaussian map is primary; local mesh is derived.

## No AI depth / no IMU

V30.7 contains no Depth Anything/DeepAI worker or ONNX runtime. It also contains no IMU runtime module. This makes scale provenance explicit: WebXR seeds metric scale once; camera geometry maintains it afterwards.
