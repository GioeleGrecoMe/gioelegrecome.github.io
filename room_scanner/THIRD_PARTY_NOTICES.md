# Third-party notes

No third-party SLAM or Gaussian renderer source/binary is bundled in V30.0.0.

Optional runtime downloads used by the Deep worker:

- ONNX Runtime Web — see Microsoft ONNX Runtime project license.
- Depth Anything V2 Small — upstream project states the Small model is Apache-2.0.

The application does **not** bundle AlvaAR or ORB-SLAM3. Both are GPLv3 projects; V30 uses
its own small WASM front-end so downstream licensing remains a deliberate choice.

stella_vslam is a possible future adapter and is distributed under the 2-clause BSD
license, but V30.0.0 does not bundle or claim to contain stella_vslam.
