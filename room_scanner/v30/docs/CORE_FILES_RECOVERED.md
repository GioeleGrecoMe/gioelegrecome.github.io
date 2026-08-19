# V30.10.1 core runtime completeness

This package contains every runtime path required by `js/boot_preflight.js` and by the atomic service-worker shell, including the 15 paths that were missing from the previous archive.

Important provenance note: the execution environment used to build this recovery package could not fetch the author's GitHub repository or GitHub Pages origin at build time. The WebXR/ROI/metric files are the previously tested V30.10.1 files. The missing core modules in this recovery package are offline-compatible implementations reconstructed to satisfy the V30.10.1 runtime contracts; they are not represented as byte-for-byte copies of an unreachable upstream revision.

Verification performed before packaging:

- every required core file exists and is non-empty;
- all JavaScript files pass `node --check`;
- `slam_core.wasm` has WebAssembly magic bytes and instantiates successfully;
- the vision fallback passes the synthetic feature/matching regression;
- every relative import and every service-worker shell path resolves;
- the full V30 test suite passes.
