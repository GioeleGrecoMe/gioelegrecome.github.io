# Room Scanner v9.5.1 - MobileSAM compact object twin

Primary changes:

- Progressive evidence-based surfel pruning during acquisition and chirp-packet safe windows.
- Independent-view capped geometry probability; repeated same-view samples cannot become high-confidence geometry.
- Uniform dark controls with white labels.
- MobileSAM split ONNX browser adapter; no PicoSAM/EfficientSAM runtime path.
- User-guided multi-view object capture with a green metric-readiness gate.
- Compact oriented object proxies replace dense object point rendering during acoustic measurement.
- Manual metric limits for truncated large surfaces; conservative continuous floor/ceiling plane support.
- Compact semantic/material/acoustic encodings for the simulator.
- Very low-confidence visual material prior with manual override; reliable measured RIR evidence dominates it.

## MobileSAM weights

The archive contains the integration, local-first paths, upload UI, cache policy, tests, and deployment helpers. It does not contain an unverified remote MobileSAM weight binary. Install the known quantized bundle with:

    python3 tools/fetch_mobilesam_models.py

or install an already downloaded ZIP with:

    python3 tools/install_mobilesam_zip.py /path/to/mobile_sam_bundle.zip

The application can also load an encoder+decoder ZIP directly in the browser.

## ONNX Runtime Web

For fully local semantic inference, vendor ONNX Runtime Web 1.14 with:

    python3 tools/fetch_onnxruntime_web.py

If the runtime or model preflight fails on the device, the optional object stage is skipped and metric/acoustic acquisition remains available.

## Important runtime note

WebXR camera/depth/plane/mesh support is browser/device dependent. Test the diagnostic ZIP on the target phone after meaningful changes.
