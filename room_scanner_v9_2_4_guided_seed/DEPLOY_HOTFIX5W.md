# Deploy Hotfix5W over the existing GitHub Pages folder

The archive is intentionally safe to extract **over** an existing deployment.
The sandbox build does not contain the large ONNX/WASM binaries, so do not delete
your existing `models/` or `vendor/` folders before extracting it.

## Recommended deployment

1. Extract this archive over `room_scanner_v9_2_4_guided_seed/`.
2. Refresh the coherent MobileSAM bundle (recommended even if older ONNX files
   already exist):

       python3 tools/fetch_mobilesam_models.py

3. If needed, fill the runtime/depth assets:

       python3 tools/fetch_onnxruntime_web.py
       python3 tools/fetch_depth_anything.py
       python3 tools/fetch_depthai_runtime.py

4. Verify:

       python3 tools/check_deploy_bundle.py
       sh tests/run_current_suite.sh

5. Publish the **entire** folder, especially these three files from the same build:

       room_scanner_v9.html
       sw.js
       build_info.json

6. On the phone the badge must read:

       v9.5.1-hotfix5-mobile-ai-warm

## Expected MobileSAM behavior

- Press `Precarica AI` once. The button remains `AI pronta ✓` after a successful
  smoke inference.
- Continue to Map and then Objects. It should enter Step 3 without another model
  load; diagnostics increment `warmReuseCount`.
- Only `Riprova MobileSAM` forces a cold session reset.
- Cold initialization, if needed, uses a slim top progress bar and leaves the
  camera visible.
- Starting scientific measurement releases MobileSAM sessions to reclaim RAM.
- With MobileSAM and DepthAI disabled, Stage 5 still has the measured WebXR
  Gaussian visual fallback from Hotfix4.
