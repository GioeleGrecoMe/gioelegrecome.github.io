# Room Scanner V30.7.0

Standalone GitHub Pages room scanner. This directory has no runtime dependency on V20.

## Pipeline

1. **Guided WebXR metric bootstrap** (`local-floor` + hit-test + raw camera access).
2. Stable metric hit-test anchors are paired with small raw-camera grayscale templates.
3. WebXR is ended.
4. `getUserMedia()` starts normal camera capture.
5. Stored templates are reacquired and the WASM PnP solver transfers the WebXR metric frame to camera-only SLAM.
6. FAST/BRIEF matching + PnP maintain 6-DoF from camera data only.
7. Persistent tracks are triangulated into metric sparse landmarks.
8. A camera-only MVS worker plane-sweeps valid keyframe pairs to generate semi-dense RGB points and local mesh triangles.
9. The RGB points are fused into the persistent 3D Gaussian map.

There is **no DeepAI / Depth Anything runtime path** in V30.7 and no IMU is required.

## Update/cache policy

V30.7 fixes stale GitHub Pages/PWA updates:

- service-worker registration uses `updateViaCache: 'none'`;
- HTML/JS/CSS/JSON/WASM are network-first with request `cache: 'no-store'`;
- caches are versioned (`room-scanner-v30.7.0-shell`);
- old V30 caches are deleted during activation;
- `skipWaiting()` and `clients.claim()` are enabled;
- diagnostics contains **Forza aggiornamento**, which unregisters V30 service workers, deletes only V30 caches, and reloads with a cache-busting query.

After this build is installed, a normal refresh should request current code while online. Cache is only an offline fallback.

## Deploy

Copy **the contents of this directory** directly into the GitHub Pages `/room_scanner/v30/` directory. Do not mix it with V20 files.

Entry points:

- `index.html`
- `room_scanner_v30.html`

## First use

1. Open diagnostics and run the self-test.
2. Press **Calibra con WebXR**.
3. Point at a textured floor/wall corner and slowly vary pose until anchors, horizontal span and vertical span are sufficient.
4. Confirm calibration. The XR session ends.
5. Press **Avvia scansione**.
6. Repoint the same calibration area for a few seconds. The visual bridge must reach enough PnP inliers before scanning starts.
7. Scan normally. From this point onward the reconstruction is camera-only.

## Debug

The diagnostics drawer is always available and records bootstrap, service-worker state, WebXR calibration anchors, visual bridge matches/inliers/RMSE, SLAM tracking, keyframes, MVS pair statistics, Gaussian counts, IndexedDB and errors.

Use **Scarica log** whenever a phone behaves differently from the tests.
