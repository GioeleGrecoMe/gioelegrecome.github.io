# Room Scanner V30.12.0 — non-blocking metric lock

## Phone regression fixed
V30.11.1 could freeze at **AGGANCIO METRICO** with a black camera view and dead buttons.
The main cause was a self-triggering `MutationObserver` in `js/xr/measurement_guidance.js`: the observer watched the whole bridge subtree and its callback changed `bridgePinInstructions.textContent`, generating another mutation and an endless microtask feedback loop. This could starve video painting and pointer/touch handling.

## Changes
- Removed `MutationObserver` from metric guidance completely.
- Guidance is now driven only by `roomscan:metric-bridge-update` events emitted by the metric matcher.
- DOM guidance writes are idempotent (`lastInstruction`) and cannot trigger the matcher.
- The bridge camera starts before the optional guidance module is loaded.
- The bridge matcher is bounded to a small set of representative templates and a maximum comparison budget per pin.
- Bridge analysis resolution is reduced for relocalisation; the full ROI atlas remains stored for later reconstruction.
- Metric matching runs at ~4 Hz instead of competing continuously with camera compositing/UI.
- `bridgeMap` and guidance canvas explicitly use `pointer-events:none`; bridge buttons stay above all camera layers.
- When metric lock succeeds, the existing camera stream is handed directly to the scan camera instead of stopping/reopening `getUserMedia()`.
- While SLAM/WASM/workers initialise, the live bridge preview remains visible.
- If scan video setup fails after metric lock, the same stream is restored to the bridge and matching can resume.
- Bridge requests are epoch-guarded so Retry/Exit invalidate stale asynchronous work.

## Expected behaviour
1. Open **Avvia misura**.
2. Camera preview must appear before ROI guidance.
3. `Riprova` and `Esci` remain clickable while matching.
4. After >=3 stable inliers, the card shows that scan preparation is in progress while the camera image remains visible.
5. The same camera stream moves into Scan; there should be no camera close/reopen black gap.
