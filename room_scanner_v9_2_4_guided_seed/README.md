# Room Scanner v9.5.1 - MobileSAM compact object twin

> Hotfix2 keeps the Hotfix1 bootstrap fix and also fixes two mobile regressions: Step 3 no longer disappears when MobileSAM preflight fails, and Stage 5 reuses the primary WebGL renderer instead of allocating a second context. See `PATCH_NOTES_V951_HOTFIX2.md`.

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

If the runtime or model preflight fails on the device, Step 3 now stays visible with the exact error and offers retry, local model upload, or an explicit skip. It never silently jumps to measurement.

## Important runtime note

WebXR camera/depth/plane/mesh support is browser/device dependent. Test the diagnostic ZIP on the target phone after meaningful changes.

## GitHub Pages deployment check

For deterministic MobileSAM behavior on the public site, run these **before committing/publishing** the Pages folder:

    python3 tools/fetch_mobilesam_models.py
    python3 tools/fetch_onnxruntime_web.py
    python3 tools/check_deploy_bundle.py

The two ONNX files are small enough for normal repository deployment but are intentionally not embedded in this generated archive. The browser retains a remote fallback, but same-origin files are preferred for reliability and offline use. Hotfix2 also bumps the service-worker/cache namespace to `v951h2`; after deployment, reload once so the new worker activates.
