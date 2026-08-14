# ONNX Runtime Web - local optional vendor assets

EfficientSAM-Ti model weights are already bundled locally under `../models/`.
The uploaded EfficientSAM repository does **not** contain ONNX Runtime Web, which
is a separate Microsoft runtime required to execute ONNX in a browser.

The HTML prefers these local files:

- `ort.webgpu.bundle.min.mjs`
- `ort-wasm-simd-threaded.jsep.mjs`
- `ort-wasm-simd-threaded.jsep.wasm`

Version pinned by this build: **onnxruntime-web 1.27.0**.

To make semantic inference fully offline, run once from the project directory:

    python tools/fetch_onnxruntime_web.py

That script downloads the three runtime artifacts at deployment/build time, not
from the browser during a measurement. If these files are absent, the app keeps
an official jsDelivr runtime fallback and remains fail-open: geometry/acoustics
continue with the RGB-D semantic fallback if ONNX Runtime cannot load.

Do not pre-cache the ~41 MB EfficientSAM models during service-worker install.
They are cached lazily after the first semantic inference to avoid delaying app
startup and to reduce pressure on mobile storage.
