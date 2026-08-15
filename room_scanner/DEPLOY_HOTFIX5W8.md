# Deploy Hotfix5W8

H5W8 intentionally does not change the verified H5W6 MobileSAM/Depth Anything
model contracts. If the deployed `models/` and `vendor/` directories already
pass `Precarica AI`, keep those binaries and overlay this release over the site.

The browser badge must read:

`v9.5.1-hotfix5w8-flow-state-machine`

The service-worker revision must be:

`951h5w8`

Before publishing:

```bash
python3 tools/check_deploy_bundle.py
```

For a fully local deployment the checker should report `FULL_LOCAL_READY=yes`.
After publishing, load once with a hard refresh; navigation and model assets are
network-first/no-store before falling back to the versioned offline cache.
