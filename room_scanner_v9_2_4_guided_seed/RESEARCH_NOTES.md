# Research notes behind v9 architecture

Research checked August 2026. These references motivated design choices; they are **not** copied implementations.

## 2D Gaussian / surfel geometry

- **2D Gaussian Splatting for Geometrically Accurate Radiance Fields** — https://arxiv.org/abs/2403.17888
  - Motivation used in v9: represent surface geometry with oriented thin Gaussian disks instead of unconstrained volumetric 3D blobs; preserve view-consistent surface structure.
- **RTG-SLAM: Real-time 3D Reconstruction at Scale using Gaussian Splatting** — https://arxiv.org/abs/2404.19706
  - Motivation used in v9: stable/unstable Gaussian state, efficient online update, compact local surface elements, adaptive creation instead of blind point accumulation.

v9 is not a differentiable 2DGS optimizer. It implements a lightweight browser-compatible analogue based on RGB-D/XR evidence, probabilistic reprojection and local surfel fusion.

## Mobile / lightweight Segment Anything family

- **MobileSAM2: Lightweight Segment Anything for Spatial Intelligence** (submitted July 2026) — https://arxiv.org/abs/2607.12297
  - Reports lightweight SAM2-family image encoders including approximately 5.84M / 10.37M / 23.74M parameter variants and retains video/memory segmentation concepts.
- **EdgeTAM: On-Device Track Anything Model** — https://github.com/facebookresearch/EdgeTAM
  - Official project reports on-device video segmentation and CoreML export; useful future candidate for temporal semantic masks.
- **EfficientTAM** — https://github.com/yformer/EfficientTAM
  - Lightweight video track-anything family and another future temporal backend candidate.
- **EfficientSAM** — https://github.com/yformer/EfficientSAM
  - Chosen for the concrete v9 browser adapter because the official project includes ONNX encoder/decoder examples with a simple promptable interface.
- **MobileSAM** — https://github.com/ChaoningZhang/MobileSAM
  - Useful reference for tiny image encoders and ONNX export.

### v9 integration decision

The newest temporal SAM-family models are promising, but a recent paper or native/CoreML checkpoint is not the same as a stable browser/WebGPU deployment contract. Therefore v9 separates the semantic backend from the metric mapper:

- built-in RGB+depth boundary prior is always available;
- EfficientSAM-Ti split ONNX is the concrete optional browser backend;
- the interface is replaceable when a tested MobileSAM2/EdgeTAM/EfficientTAM ONNX/WebGPU export is available.

Semantic masks are never allowed to create metric depth or overwrite XR geometry.

## Browser inference

- **ONNX Runtime Web — WebGPU Execution Provider** — https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
  - Motivates lazy WebGPU inference outside the XR callback, with WASM fallback where possible.

## XR / AR metric state

- **ARCore fundamental concepts** — https://developers.google.com/ar/develop/fundamentals
  - ARCore combines visual feature tracking with inertial measurements to estimate camera pose and detects geometric planes/depth. v9 therefore consumes WebXR/AR runtime pose instead of trying to recreate VIO from raw browser IMU data.
- **WebXR Plane Detection Module** — https://immersive-web.github.io/plane-detection/
- **WebXR Mesh Detection Module** — https://immersive-web.github.io/real-world-meshing/
- **WebXR Depth Sensing Module** — https://immersive-web.github.io/depth-sensing/

v9 retains native detected planes/meshes as a persistent **structural graph**, parallel to the Gaussian surface map. Runtime availability remains device/browser-dependent.

## v9.1 sparse semantic-object integration

The v9.1 implementation uses EfficientSAM-Ti as the default optional browser model because the official project exposes separate ONNX encoder and decoder graphs. This lets one image embedding be reused for several prompts on the same selected keyframe instead of rerunning the image encoder.

The browser adapter prefers ONNX Runtime WebGPU and uses a compatible encoder+decoder pair. If WebGPU session creation fails, both sessions are recreated on WASM. The neural path is deliberately sparse and asynchronous: it is scheduled only for readable RGB-D keyframes and, during acoustic measurement, only in explicit inter-packet safe windows.

EdgeSAM/EdgeTAM/MobileSAM2 remain candidate future backends behind the same adapter. The mapping/object state does not depend on a particular SAM implementation.
