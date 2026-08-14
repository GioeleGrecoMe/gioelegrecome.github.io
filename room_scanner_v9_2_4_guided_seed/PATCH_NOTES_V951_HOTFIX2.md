# Room Scanner v9.5.1 Hotfix2

## Fixed

- Preserves the Hotfix1 `pumpSemanticQueue` declaration fix.
- Step 3 no longer jumps directly to measurement when MobileSAM preflight fails. The object stage stays visible with the precise error, retry, upload, and explicit skip paths.
- Replaces the stale/fragile MobileSAM remote pair with the matching split encoder + quantized decoder URLs from `PulpCut/mobilesam-onnx`. Local `models/` files remain preferred.
- Stage 5 no longer creates a second `THREE.WebGLRenderer`. The final digital-twin viewer reuses the primary renderer after the XR session, reducing GPU memory and avoiding mobile WebGL-context allocation failures.
- Viewer construction is transactional: if scene creation fails, the app removes the final overlay, restores the main renderer/canvas, returns to the landing UI, and displays the error instead of leaving a black screen.
- Service-worker and cache namespaces are bumped to `v951h2` to prevent mixed old/new assets after GitHub Pages updates.

## Deployment

For a self-contained GitHub Pages deployment, run:

```bash
python3 tools/fetch_mobilesam_models.py
python3 tools/fetch_onnxruntime_web.py
python3 tools/check_deploy_bundle.py
```

Then publish the whole directory, including `models/`, `vendor/`, `room_scanner_v9.html`, and `sw.js`.
