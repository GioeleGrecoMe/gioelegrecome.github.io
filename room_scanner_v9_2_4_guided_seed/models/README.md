# Bundled EfficientSAM-Ti ONNX models

These files were copied **directly** from the user-provided archive of the
upstream repository `yformer/EfficientSAM`:

- `efficient_sam_vitt_encoder.onnx`
- `efficient_sam_vitt_decoder.onnx`

They are the split ONNX encoder/decoder used by the upstream
`EfficientSAM_onnx_example.py`. Runtime downloads of model weights are disabled
in Room Scanner v9.2.4.

Expected SHA-256:

- encoder: `84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951`
- decoder: `a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11`

EfficientSAM is licensed under Apache-2.0; a copy of the upstream license and
ONNX export/reference scripts is retained under `../third_party/EfficientSAM/`.
