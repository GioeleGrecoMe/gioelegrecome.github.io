# Deploy Hotfix5W6

1. Extract/copy H5W6 over the existing GitHub Pages directory.
2. Do **not** delete working `models/` or `vendor/` binaries.
3. If needed, refresh local assets with:

```bash
python3 tools/fetch_mobilesam_models.py
python3 tools/fetch_onnxruntime_web.py
python3 tools/fetch_depth_anything.py
python3 tools/fetch_depthai_runtime.py
```

4. Verify before commit/publish:

```bash
python3 tools/check_deploy_bundle.py
```

5. Publish the whole directory, including `sw.js`, `depth_ai_worker.js`, `models/` and `vendor/`.
6. The page badge must report:

```text
v9.5.1-hotfix5w6-verified-model-contracts
```

7. Run `Precarica AI` before opening acquisition. A successful preload means the app has completed real MobileSAM encoder->decoder and Depth Anything smoke inference, not merely downloaded the files.

H5W6 uses build revision `951h5w6`; the service worker removes prior `room-acoustic-*` revisions and navigation remains network-first.
