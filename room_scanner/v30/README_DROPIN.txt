Room Scanner V30.18.9 — AlvaAR + local ONNX depth mapping

Deploy the complete v30 directory, including sw.js and models/. The service
worker is network-first for current assets, so a refresh cannot combine an old
app module with a new configuration. Before scanning, use “Prova inferenza” to
load the local models/model_q4.onnx model (or an uploaded compatible ONNX) and
confirm the actual WebGPU/WASM backend. During Scan, the camera runs at low
resolution/8 fps and Depth Anything is requested at most once per second in a
worker. Its heat map is overlaid live; only depth calibrated to Alva anchors and
confirmed by multi-view geometry is fused into surfels, mesh and Gaussian view.

MobileSAM files are segmentation components, not depth-model replacements.
