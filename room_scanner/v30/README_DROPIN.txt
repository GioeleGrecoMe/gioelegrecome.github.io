Room Scanner V30.18.0 — AlvaAR + local ONNX depth mapping

Deploy the complete v30 directory, including sw.js and models/. The service
worker build ID changes to V30.18.0, so old V30 shells are discarded on the next
open. Before scanning, use “Prova inferenza” to load the local
depth_anything_v2_small_q4f16.onnx model (or an uploaded compatible ONNX) and
confirm the actual WebGPU/WASM backend. During Scan, the camera runs at low
resolution/8 fps and Depth Anything is requested at most once per second in a
worker. Its heat map is overlaid live; only depth calibrated to Alva anchors and
confirmed by multi-view geometry is fused into surfels, mesh and Gaussian view.

MobileSAM files are segmentation components, not depth-model replacements.
