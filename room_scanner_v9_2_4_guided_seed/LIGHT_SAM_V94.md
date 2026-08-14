# Room Scanner v9.4 - lightweight semantic backend

## Decision

The semantic stage now prefers a single-network PicoSAM-style ROI model and
keeps EfficientSAM-Ti only as a compatibility fallback.

The default local path is:

    models/PicoSAM2_student_quantized.onnx

The app does **not** fetch this weight from the internet at runtime. If the file
is absent, the preflight proceeds to the already bundled EfficientSAM-Ti
encoder/decoder. A PicoSAM ONNX can also be loaded from the UI either directly
or inside a ZIP; the browser passes its bytes directly to ONNX Runtime.

## Why PicoSAM2 first

PicoSAM2/PicoSAM3 are designed around a very small 96x96 region-of-interest
segmentation network. The upstream project reports an approximately 1.2 MB
quantized model and centered/ROI interaction, which matches Room Scanner's
reticle workflow much better than repeatedly encoding a full frame with a ViT.

At the time this build was prepared, the upstream repository explicitly lists
`PicoSAM2_student_quantized.onnx` as a pretrained quantized export. PicoSAM3 is
newer, but the public pretrained checkpoint table lists `.pt` weights and an
ONNX conversion workflow rather than an equally direct pretrained ONNX file.
The upload parser therefore accepts either PicoSAM2 or PicoSAM3 ONNX, while the
server-side default remains PicoSAM2.

Upstream references:
- https://github.com/pbonazzi/picosam3
- https://zenodo.org/records/15728470

## Reticle readiness gate

SAM is not allowed to segment merely because RGB is available. The central
reticle is:

- **white**: local geometry is not yet sufficient;
- **green**: the local patch has enough metric evidence to estimate both
  position and a coarse 3-D orientation.

The gate is computed only from a small central depth ROI and voxel-local surfel
lookups. It checks:

1. current frame readability and age;
2. number of valid depth cells under the reticle;
3. number of nearby surfels;
4. verified / stable surfels;
5. support from independent views;
6. metric spatial span;
7. excessive depth spread;
8. number and coherence of local surface normals.

The `Segmenta al mirino` button is disabled until this gate is true. The exact
frame that turns the reticle green is frozen for the subsequent segmentation,
so RGB, depth, WebXR pose, and local orientation evidence stay synchronized.

## Runtime cost

The readiness check does not iterate over the complete surfel map. For each
sample in the central ROI it looks only in neighboring coarse/fine surfel voxels
and normal buckets. This keeps its cost bounded as the room map grows.

Pico inference remains user-driven. No PicoSAM/EfficientSAM inference is run in
the scientific measurement loop.

## Installing the optional PicoSAM2 model

If you have the official PicoSAM2 archive, run:

    python3 tools/install_picosam_from_zip.py /path/to/PicoSAM2.zip

or put the ONNX directly at:

    models/PicoSAM2_student_quantized.onnx

Alternatively use `Carica SAM ZIP / ONNX` in the app before entering AR. The
loader searches recursively for a `picosam2*.onnx` or `picosam3*.onnx` file.
