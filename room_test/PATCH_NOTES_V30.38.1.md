# V30.38.1 hotfix - atomic SLAM module closure

This hotfix fixes the runtime error `Failed to fetch dynamically imported module .../js/slam/slam_engine.js?v=30.38.0`.

Root causes addressed:
- `slam_engine.js` was a lazy dependency but was not present in the V30.38 incremental archive because it had not changed from V30.37;
- its static dependency closure was not build-tagged, allowing a mixed old/new ESM graph after a GitHub Pages/service-worker update;
- the HTML shell still exposed V30.37 asset/build tags in the V30.38 working tree;
- dynamic import failures had no HTTP/MIME/service-worker diagnostic probe.

Changes:
- build bumped to 30.38.1;
- `slam_engine.js`, `math.js`, `alva_metric_bootstrap.js`, and `pose_uncertainty.js` are explicitly shipped;
- SLAM static imports carry the 30.38.1 build tag;
- lazy imports retry once using a no-store diagnostic probe and log status, MIME type, online state and service-worker state;
- HTML shell, service worker, boot loader and UI build identities are coherent;
- live optimizer HUD and in-scan Log control are present in both entry HTML files;
- added an ESM closure regression test that imports SlamEngine through its complete static dependency chain.
