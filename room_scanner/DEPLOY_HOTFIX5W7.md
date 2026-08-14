# Deploy H5W7

Deploy revision: `951h5w7`.

This source package intentionally does not duplicate the large `.onnx` / `.wasm` binaries. Deploy it over the existing site directory that already contains the working `models/` and `vendor/` assets from H5W6.

After copying the files, verify:

```bash
python3 tools/check_deploy_bundle.py
```

For a fully self-contained deployment the checker must print:

```text
FULL_LOCAL_READY=yes
```

On the phone, confirm the badge is:

```text
v9.5.1-hotfix5w7-stable-object-picking
```

Because the service-worker revision changed to `951h5w7`, navigation and cached neural assets are isolated from H5W6.
