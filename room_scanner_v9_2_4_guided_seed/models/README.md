# Semantic models

## Preferred lightweight backend (optional)

Room Scanner v9.4 first looks for:

- `PicoSAM2_student_quantized.onnx`

This file is **not bundled in this package**, because the official binary could
not be fetched into the build environment. The app never silently downloads the
weight at runtime. Obtain the official pretrained archive from the PicoSAM
project/Zenodo and either:

- place the ONNX here with the filename above;
- run `../tools/install_picosam_from_zip.py <archive.zip>`; or
- use `Carica SAM ZIP / ONNX` in the browser.

The browser ZIP loader also recognizes an exported PicoSAM3 ONNX.

Upstream:
- https://github.com/pbonazzi/picosam3
- https://zenodo.org/records/15728470

## Bundled compatibility backend: EfficientSAM-Ti

These files were copied directly from the user-provided upstream
`yformer/EfficientSAM` archive:

- `efficient_sam_vitt_encoder.onnx`
- `efficient_sam_vitt_decoder.onnx`

Expected SHA-256:

- encoder: `84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951`
- decoder: `a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11`

EfficientSAM remains the fallback if PicoSAM is absent or fails its actual
ONNX Runtime smoke inference. Its upstream license/export references are kept
under `../third_party/EfficientSAM/`.
