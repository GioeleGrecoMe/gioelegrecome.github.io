# EfficientSAM upstream provenance

Source repository: `https://github.com/yformer/EfficientSAM/tree/main`

Room Scanner uses only the EfficientSAM-Ti split ONNX encoder/decoder at runtime.
The original Python ONNX example/export wrapper and Apache-2.0 LICENSE are kept
here for provenance and reproducibility. PyTorch checkpoints and the monolithic
ONNX file are intentionally not duplicated into the final web package because
they are not needed by the browser and would add tens of megabytes.
