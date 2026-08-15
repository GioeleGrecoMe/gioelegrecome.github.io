# H5W8 internal verification report

Build: `v9.5.1-hotfix5w8-flow-state-machine`

## Regression coverage

- JavaScript module syntax: PASS
- Historical Room Scanner test suite: PASS
- DOM/handler deep audit: PASS
- MobileSAM encoder/decoder tensor contracts: PASS
- Depth Anything worker/metric alignment: PASS
- WebXR cooperative architecture checks: PASS
- Fullscreen Twin / Gaussian fallback checks: PASS

## H5W8 state transitions

- Object tap accepted from RGB without direct depth: PASS
- Tap automatically schedules SAM: PASS
- Mask construction does not synchronously scan all surfels: PASS
- Async projected-surfel support: PASS
- Back while semantic operation is active: PASS
- Skip while semantic operation is active: PASS
- Late SAM result after navigation is ignored: PASS
- Pointer + click + touchend DOM-overlay paths: PASS
- Primary plane opacity = 0.016: PASS
- Measurement transition lock: PASS
- Pause -> Map -> Measurement sweep-unwind restart: PASS

## Stock room pseudo-video simulation

Asset: `tests/stock_living_room.jpg` (CC0 Wikimedia Commons).  
12 crop-shifted RGB views were generated in memory.

- selected SAM-like mask cells: 95
- selected first-view direct depth cells: 0 (intentional stress case)
- later projected WebXR surfels inside mask: 348
- candidate becomes metric after later support: PASS
- segmentation -> Back -> stale result ignored: PASS
- segmentation -> Skip -> stale result ignored: PASS
- measurement -> Map -> resume -> Twin: PASS

## Synthetic acoustic measurement

A six-chirp packet was synthesized at 16 kHz with a short multi-path RIR,
independent 410–510 ms output latencies and additive noise.

- chirps: 6
- maximum estimated onset error: < 4.5 ms required; PASS
- packet completion: PASS
- final-processing-ready state: PASS

## Limitation of the container test

A genuine WebXR session requires a physical supported phone/browser and cannot
be instantiated inside the build container. Likewise, the release overlay does
not embed the large ONNX/WASM binaries. Model tensor contracts and model-integrity
logic are covered by the existing H5W6 tests; H5W8 does not modify them.
