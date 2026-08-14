# Test report — v9.5.1 Hotfix5W4

Build: `v9.5.1-hotfix5w4-object-ui-fullscreen-viewer`  
Deploy revision: `951h5w4`

## Result

`PASS` — complete current regression suite.

Key checks:

- JavaScript module syntax: PASS
- DOM/handler deep audit: PASS
- DOM IDs: 283
- DOM references: 256
- handler targets: 101
- named functions: 641
- duplicate named functions: 0
- MobileSAM encoder metadata contract: PASS
- MobileSAM decoder feed contract: PASS
- warm AI preload reuse: PASS
- tap-driven object prompt: PASS
- first-mask readiness separated from strict multi-view metric readiness: PASS
- selected prompt drives SAM, local depth and 3D boundary point: PASS
- compact multi-view object proxy path: PASS
- MobileSAM release before measurement: PASS
- WebXR-only Stage-5 fallback: PASS
- raw measured surfel viewer fallback isolated from scientific solver: PASS
- exclusive full-screen Stage 5: PASS
- automatic raw Gaussian preview after XR end: PASS
- one WebGL renderer / context: PASS
- viewer failure rollback: PASS
- Depth Anything metric-alignment tests: PASS
- DepthAI dynamic/static input-shape tests: PASS
- service-worker/network-first deploy integrity: PASS

## Environment limitation

A headless desktop Chromium instance cannot reproduce an immersive mobile WebXR
session or phone camera/depth permissions. Runtime WebXR behavior therefore still
requires the target phone test. The static/integration regression suite verifies
all executable application paths that do not require physical XR hardware.
