# V30.1 standalone architecture

## Boot layer

The HTML contains a tiny pre-bootstrap diagnostic guard with no module imports.
It wires the camera-height range control, captures early JS errors, provides a
fallback diagnostics download and reports if the main module does not announce
readiness within five seconds.

`js/app.js` then owns the complete application state machine. Missing Deep or a
viewer GPU issue must never disable the home controls.

## Capture and SLAM

`js/camera.js` provides a low-resolution grayscale analysis stream plus separate
JPEG keyframes. `wasm/slam_core.wasm` handles the performance-critical visual
front-end. `js/slam/slam_engine.js` owns track IDs, keyframes, landmarks, PnP,
metric bootstrap, loop-closure candidates and markpoints.

## Depth and metric scale

Depth Anything is optional and isolated in `workers/depth_worker.js`. Existing
metric landmarks are the preferred depth calibration anchors; floor height is a
bootstrap fallback. A neural failure cannot stop capture.

## Gaussian map

`workers/gaussian_worker.js` fuses metric RGB-depth observations into a voxel
hash of point Gaussians. Each Gaussian stores sufficient statistics for mean,
covariance proxy, RGB, normal, observation count, independent-view count and
age. The map is the primary dense evidence; structural surfaces can be derived
later.

## Storage

`js/storage/db.js` creates a V30-only IndexedDB database named
`room-scanner-v30`, with session, keyframe, IMU, event and Gaussian snapshot
stores. There is no shared V20 database or service worker cache.

## Diagnostics

`js/logger.js` records structured events and globally captures JavaScript
errors, unhandled promise rejections, visibility transitions and pagehide.
Events are mirrored into IndexedDB while a session exists. The UI can export a
single diagnostics JSON at any time.

## Review/export

The Gaussian viewer is instantiated lazily in review mode so a WebGL driver
problem cannot break application bootstrap. `js/formats.js` handles binary PLY
and a compact `.r30` container. Gaussian floats are stored as binary payloads,
not expanded JSON arrays.
