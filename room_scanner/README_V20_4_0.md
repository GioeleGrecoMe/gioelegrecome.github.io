# Room Scanner V20.4.0 - Dense Ray / Point-Gaussian Twin

V20.4 changes the map authority from surface tiles to dense metric evidence.
The capture loop stores compact WebXR rays (RSRY v1) and continuously fuses
their 3-D terminations into 2 cm point-Gaussians. Structural planes, rooms and
objects are derived products; they never replace the dense evidence.

## Capture layers

1. **Raw rays (authoritative evidence)**
   - normalized WebXR view UV
   - metric Z depth
   - camera pose + projection matrix per batch
   - normal, confidence and optional same-frame RGB
   - append-only IndexedDB storage
2. **Online point-Gaussians**
   - ~2 cm spatial cells
   - mean, covariance, normal and RGB statistics
   - temporal span, view count, baseline and source provenance
   - confirmation requires repeated evidence
3. **Post-XR Deep fusion**
   - many RGB keyframes selected by pose/coverage/quality
   - Depth Anything is calibrated against metric WebXR anchors
   - single-view Deep geometry remains provisional
   - multi-view evidence updates the same Gaussian map
4. **Derived geometry**
   - floor, ceiling, walls, openings and RGB residual objects are fitted from
     the dense map; the dense map and raw rays remain exportable.

## CPU and GPU WebXR depth

CPU depth is read from XRCPUDepthInformation using normalized view coordinates
and the raw depth buffer when available. GPU depth is sampled inside the active
XR animation frame by a small WebGL2 downsample shader. The shader understands
float32, unsigned-short and luminance-alpha formats, applies
normDepthBufferFromNormView and rawValueToMeters, and transfers only a bounded
RGBA8 metric-depth image back to CPU. This avoids reading a full native depth
texture while still producing thousands of metric rays per batch.

GPU readback is automatically disabled after repeated shader/readback failures;
Raw Camera, hit-test, RGB keyframes and Deep processing continue.

## Density profiles

Approximate configured upper bounds before invalid-depth/backpressure losses:

- Light: 3,200 rays / 150 ms depth batch, ~90k live point-Gaussian budget
- Balanced: 6,200 rays / 105 ms depth batch, ~160k live point-Gaussian budget
- Detail: 11,000 rays / 75 ms depth batch, ~220k live point-Gaussian budget

Actual rates depend on ARCore depth resolution, valid pixels, device GPU, flash
storage and browser scheduling. Backpressure skips a depth batch rather than
blocking the XR frame or allowing the write queue to grow without bound.

## Files to replace in an existing V20.3 site

- `build_info.json`
- `sw_v20_2_0.js`
- `js/config_v20_2_0.js`
- `js/xr_capture_v20_2_0.js`
- `js/raw_export_v20_2_0.js`
- `js/processing_ui_v20_2_0.js`

Files to add:

- `js/reconstruction_v20_4_0.js`
- `workers/map_worker_v20_4_0.js`
- `workers/processing_worker_v20_4_0.js`

The existing `workers/depth_ai_worker_v20_3_0.js` is also included in the
drop-in so the package is self-contained.

## Raw export

`.rscan.zip` keeps `.rsry` ray batches. The desktop helper can reconstruct a
metric point cloud from each ray using its normalized UV and the stored camera
and projection matrices:

```bash
python3 tools/process_rscan.py session.rscan.zip --out processed --extract-images
```

Phone processing can retain up to ~320k fused point-Gaussians at the highest memory budget; RAW ray batches are not discarded and can be reprocessed off-device at much higher density.

The helper writes `metric_point_gaussians.ply` and preserves the images/audio
for later multi-view or acoustic processing.
