# Room Scanner V30.8.0

Standalone GitHub Pages room scanner using:

- WebXR only for an initial metric bootstrap;
- user-selected multi-view visual landmarks for the WebXR -> normal-camera hand-off;
- camera-only WASM feature tracking / metric PnP afterwards;
- geometric triangulation and MVS without DeepAI;
- incremental RGB 3D Gaussian map and local mesh chunks;
- persistent diagnostics, self-test, PLY/R30 export and aggressive anti-stale service-worker policy.

## Why V30.8

V30.7 automatically stored small templates from generic hit-test rays. They were
metric, but often not visually distinctive enough to survive the transition from
WebXR Raw Camera Access to a new `getUserMedia()` stream.

V30.8 makes calibration intentional:

1. WebXR continuously scores small camera regions and highlights visually rich
   candidates.
2. The user taps 3-5 fixed, recognisable details.
3. Each selected detail creates a small cluster of WebXR metric points.
4. The same cluster is observed from several camera poses and stores multiple
   appearance templates.
5. Calibration finishes only when all selected details are mature and visible
   simultaneously in one final common view.
6. After WebXR ends, the normal camera is asked to reproduce that common view;
   multi-template matching and WASM PnP transfer metric scale/pose to camera-only
   SLAM.

No IMU or monocular AI depth is required by this path.
