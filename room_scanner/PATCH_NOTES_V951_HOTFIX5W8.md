# Room Scanner v9.5.1 Hotfix5W8 — Flow state machine

Build: `v9.5.1-hotfix5w8-flow-state-machine`  
Deploy revision: `951h5w8`

## Problems fixed

### 1. Step 3 segmentation could look frozen or unusable

The previous path still had two interactive hazards:

- the first mask could synchronously scan a very large WebXR surfel map when the
  selected depth cells were sparse;
- Android/WebXR DOM overlay input depended primarily on `pointerdown` and could
  miss the user gesture on implementations that emit a click/touch fallback.

H5W8 treats the SAM result and metric support as two separate stages:

1. tap freezes a current RGB/pose snapshot;
2. the tap itself automatically starts MobileSAM when the warm model is ready;
3. the 2D mask is displayed immediately even when the selected frame has no
   direct XR-depth samples in the object;
4. surfel support is projected asynchronously with a bounded sample/yield budget;
5. metric confirmation becomes available when enough 3D support exists.

The full-map synchronous projected-surfel scan has been removed from the mask
constructor. The canvas accepts pointer, click and touchend paths with duplicate
suppression and no pointer capture.

### 2. Back and Skip were ignored during segmentation

Older code deliberately returned when `S.objectSeeding.busy` was true. A long
MobileSAM operation therefore made Step 3 a navigation trap.

H5W8 gives each segmentation an operation generation. Back/Skip invalidate that
generation immediately. A late model result is ignored and cannot re-open or
modify Step 3. Navigation is no longer conditioned on semantic busy state.

### 3. Measurement could remain stuck after Map -> Measurement resume

The old sweep loop could still have `autoSweepRunning=true` while its cancelled
generation was unwinding. The newly requested loop saw that flag and returned;
when the old loop finally stopped there was no caller left to restart it.

H5W8 serializes this transition:

- cancel/increment the old sweep generation;
- cooperatively wait for its `finally` to release `autoSweepRunning`;
- then resume the measurement state and launch exactly one new loop.

A `measurementTransitionPromise` also prevents double taps from opening the PCM
measurement path twice.

## Mobile UX

- Primary XR surfaces use opacity `0.016` so they remain useful without hiding
  the camera view.
- Tap = SAM prompt; the Segment button remains an explicit retry/accessibility
  control rather than a required second gesture.
- MobileSAM and periodic DepthAI remain mutually scheduled; WebXR acquisition
  remains the backbone.

## Internal tests

In addition to the historical suite, H5W8 includes:

- `test_v951_hotfix5w8_state_machine.py`
- `test_v951_hotfix5w8_stock_flow.py`
- `test_v951_hotfix5w8_synthetic_measurement.py`

The stock-flow test uses a CC0 Wikimedia Commons room photograph to generate 12
crop-shifted pseudo-video views. Synthetic XR depth/pose are injected to verify
RGB-first SAM behavior, delayed surfel anchoring, stale-result cancellation,
Back/Skip transitions and completion of the measurement state to the Twin.
