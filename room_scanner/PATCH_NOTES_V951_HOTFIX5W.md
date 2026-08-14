# Room Scanner v9.5.1 Hotfix5W — Mobile AI warm sessions

## Bugs fixed

1. **Preload was discarded.** The Step-3 preflight always called
   `ensureMobileSamSemantic(true)`, releasing the sessions loaded by `Precarica
   AI`. Normal flow now reuses a previously smoke-tested encoder+decoder session.
2. **Mixed MobileSAM export assumptions.** Previous local fetches could install a
   PulpCut encoder while the browser code used the HWC/raw255 contract of
   MobileSAM-in-the-Browser. The loader now detects HWC/NHWC/NCHW plus raw255 vs
   ImageNet preprocessing from ONNX input metadata and smoke-tests complete
   encoder/decoder pairs.
3. **Camera-obscuring AI startup.** MobileSAM cold start uses a small fixed
   pointer-transparent progress strip. No full-screen processing overlay is used.
4. **Mixed GitHub Pages builds.** Revision `951h5w2` keeps documents and neural
   assets network-first/no-store, with versioned cache only as offline fallback.
5. **WebXR-only Stage 5 preserved.** The Hotfix4 pre-final WebXR Gaussian snapshot
   remains the visual fallback when strict pruning leaves too little display
   geometry. It is never promoted to trusted acoustic solver geometry.

## Preferred MobileSAM local bundle

`tools/fetch_mobilesam_models.py` now installs the coherent
MobileSAM-in-the-Browser split:

- `models/mobilesam.encoder.onnx` — Akbartus browser encoder
- `models/mobilesam.decoder.onnx` — matching FP32 decoder
- `models/mobilesam.decoder.quant.onnx` — matching quantized decoder

PulpCut URLs remain runtime compatibility candidates for deployments that still
contain that export family.

## Runtime lifecycle

- Landing: optional user-triggered preload.
- Map -> Objects: warm sessions are reused instantly when valid.
- Explicit Retry: only path that forces a semantic session reset.
- Scientific measurement: MobileSAM sessions are released before camera/audio
  measurement continues.
- Stage 5: Depth Anything remains worker-isolated and keyframe-only.
