# V30.8 architecture

## Stage A - WebXR metric landmark calibration

Raw Camera Access is sampled only through small patches. A lightweight texture
score proposes stable-looking visual regions. The user selects which physical
details are trustworthy.

Each user target owns a cluster of nearby WebXR hit-test points. After the metric
positions become stable, the hit-test sources are cancelled. The fixed points are
reprojected into subsequent WebXR views and collect multiple image templates from
poses separated by translation and/or rotation.

A target is ready only after enough multi-view observations and metric baseline.
The entire calibration is ready only when all chosen targets are visible together
in a final common view with sufficient spatial spread.

## Stage B - metric bridge

WebXR is closed. `getUserMedia()` starts. Each metric point is searched around its
final common-view image coordinate. The bridge tries the common-view template
first and then a few strong historical templates. Unique 3D-to-2D correspondences
feed the WASM PnP solver. Accepted matches are bound to unique SLAM tracks.

## Stage C - camera-only mapping

After the bridge succeeds, WebXR is no longer required. Camera-only WASM SLAM,
triangulation and MVS add sparse and semi-dense metric points to the same RGB
Gaussian map. Local mesh chunks remain derived geometry; Gaussian evidence and
raw session data remain primary.
