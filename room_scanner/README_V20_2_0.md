# Room Scanner V20.2.0 - Observation Graph Capture

Room Scanner V20.2.0 is a static, offline-capable WebXR application for collecting a metric, photo-linked and acoustically oriented description of connected indoor spaces with a smartphone.

The release deliberately separates three responsibilities:

1. **Capture:** WebXR, compact metric depth, RGB keyframes, markpoints and rapid chirps are appended to IndexedDB while the session is running.
2. **Safe handoff:** closing WebXR does not start reconstruction, inference, FFT processing, export, navigation or page reload. The application remains in the same document and only shows the saved-session review.
3. **Processing:** reconstruction is an explicit action in `processing.html`, can be restarted, and can also be performed from an exported `.rscan.zip` on another device.

This design avoids the large memory peak that occurs when camera images, PCM and the complete session state are serialized while Chrome/ARCore is dismantling the immersive compositor.

## Main user flow

1. Open `room_scanner_v12.html` over HTTPS in Chrome Android.
2. Check microphone settings and start a new metric segment.
3. Walk naturally through the environment. Manual wall marking is not required.
4. Follow the projected adaptive cells:
   - red: insufficient geometric evidence;
   - yellow: observed, but weak, single-view or lacking useful RGB/depth;
   - green: stable enough for the current target class.
5. Add a recognizable markpoint when entering difficult areas or before intentionally ending/restarting WebXR.
6. Press **Save and leave XR**. No processing starts.
7. From the review screen, export RAW immediately, export diagnostics, continue in a new segment, or open the separate processing page.

Cells are quality guidance, never a hard completion gate. Hidden or unreachable regions can remain red.

## Geometric representation

Capture is stored as an observation graph rather than a single unbounded point cloud. Nodes include metric depth batches, poses, RGB frames, markpoints and acoustic measurements. Edges preserve temporal order, view relations and frame-to-surface support.

The online map worker uses bounded surfel statistics and adaptive metric tiles. It prioritizes:

- boundaries and normal discontinuities;
- floor, ceiling and large structural planes;
- object residuals observed from more than one view;
- cells associated with useful photos or markpoints;
- rare geometry over redundant samples from the same pose.

The offline/on-device processing stage extracts and regularizes floor, ceiling, walls and object surfaces while retaining WebXR scale. It does not globally rescale the scene to make planes fit.

## Markpoints and restarted segments

A markpoint is a compact visual/depth patch descriptor, not a manually typed coordinate. The application reports whether the candidate is distinctive, stable, well exposed and separated from previously saved marks.

When WebXR is restarted, the new local-floor space becomes a separate metric segment. Segments are fused only when there are enough cross-segment markpoint correspondences. Registration estimates gravity-constrained yaw plus translation. Scale is fixed to WebXR metric scale. An unregistered segment remains available in RAW and is explicitly reported rather than silently fused.

## Acoustic capture

Rapid short ESS chirps are distributed along the walking trajectory with permissive motion thresholds. The goal is many usable observations, not a small set of supposedly perfect poses. Each measurement stores pose, timing maps, expected PCM indices, device settings and quality metadata.

RIR analysis is deferred. The acoustic processor aligns each response to its detected direct path, uses relative reflection delays and robustly aggregates multiple measurements. Geometry surfaces and object-face groups carry stable IDs so future reflection association and zone-wise effective absorption estimation remain possible.

## Raw export

`Export RAW` creates an uncompressed ZIP to minimize CPU and memory overhead. It contains:

- session and segment manifests;
- append-only records and event diagnostics;
- compact metric depth batches (`RSPT v1`);
- JPEG keyframes and their metric poses;
- Int16 PCM chunks and chirp metadata;
- markpoint descriptors and observations;
- grid snapshots and quality metrics;
- any generated model and acoustic results.

The desktop utility `tools/process_rscan.py` validates the archive, decodes metric points, performs markpoint-constrained segment registration, writes a fused PLY, trajectory CSV, WAV and diagnostic summary, and can extract all images.

## Deployment

Publish the complete directory to an HTTPS static origin. GitHub Pages is sufficient. The canonical entry point remains:

```text
room_scanner_v12.html
```

When upgrading from an older build, clear the old site's storage once or uninstall the previous PWA. V20.2.0 uses versioned modules and a versioned service worker.

## Local optional dependencies

For fully offline Deep processing, place ONNX Runtime Web assets under `vendor/onnxruntime-web/` and a compatible Depth Anything ONNX model under `models/`. See the README files in those directories. Capture and RAW export do not depend on either component.

## Validation status

Automated tests cover syntax, persistence contracts, compact depth encoding, grid state transitions and propagation, markpoint descriptors, segment registration constraints, safe XR handoff, RAW archive structure, DSP primitives, service-worker routing and static deployment.

A real Chrome Android/ARCore session cannot be reproduced in the build container. Follow `TEST_ON_PHONE.md` before considering a specific handset validated.
