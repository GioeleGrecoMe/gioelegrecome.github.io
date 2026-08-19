# V30 phone test protocol

Use a new private/incognito session for the first deployment test to avoid older service
workers.

## A. Startup

- Verify camera permission.
- On iOS, accept motion permission when prompted.
- Confirm feature and match counters become non-zero on a textured scene.
- Confirm the page remains usable if Depth Anything cannot download.

## B. Metric bootstrap

- Enter a realistic camera height.
- Point the phone at the floor from ~0.8–1.8 m.
- Wait for a Deep keyframe.
- Check that the scale label gains a confidence value.
- Walk ~2 m and verify the reconstructed path/model extent is plausible.

## C. SLAM

- Walk a loop and return to the start.
- Observe feature/match/landmark/inlier counters.
- Test blank walls, fast motion and temporary occlusion.
- Pin a persistent high-contrast object.

## D. Dense Gaussian map

- Scan floor, all wall heights, ceiling and furniture.
- Confirm Gaussian count grows while frame rate remains usable.
- Confirm repeated views make the cloud denser rather than producing copies at unrelated
  scales.

## E. Recovery/export

- Stop scanning.
- Orbit, pan and zoom the 3D map.
- Export PLY and reload it.
- Export `.r30` and diagnostics JSON.
- Reload the site and confirm the previous session is still listed in IndexedDB metadata.

## F. Thermal/memory soak

Run a 5–10 minute scan. Record:

- device model/browser;
- Deep provider (WebGPU or WASM);
- keyframe count;
- Gaussian count;
- any tab reload/kill;
- diagnostics JSON.
