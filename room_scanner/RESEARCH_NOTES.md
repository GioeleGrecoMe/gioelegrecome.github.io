# Research notes used for V30

- AlvaAR demonstrates real-time visual SLAM as WebAssembly in a browser, but its published
  roadmap still lists IMU fusion as future work and it is GPLv3.
- ORB-SLAM3 is GPLv3 and its upstream build targets are native rather than a maintained web
  package.
- stella_vslam is BSD-2-Clause and actively maintained, but the official documentation
  describes native builds / socket web viewers rather than an official in-browser WASM
  target.
- OpenCV's official JavaScript build system produces WebAssembly by default and documents
  separate WASM files for production builds.
- gsplat.js demonstrates practical in-browser Gaussian Splat rendering and is MIT licensed;
  V30 uses its own smaller renderer to keep the core dependency-free.
- ONNX Runtime Web provides a WebGPU execution provider.
- Depth Anything V2 Small is the lightweight member whose upstream repository states an
  Apache-2.0 license.

V30 therefore keeps SLAM and rendering behind internal interfaces so a stronger external
backend can be introduced without changing the session format.
