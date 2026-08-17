# Room Scanner V15.1.0 - Wall Targets + Recovery

Build: `v15.1.0-wall-targets-recovery-20260817`

## Purpose

Room Scanner is a static, smartphone-first webpage for acquiring a lightweight metric model of connected indoor rooms and the objects inside them. One WebXR `local-floor` session is the only global metric coordinate system. Deep Anything is optional and runs only after WebXR has ended.

V15.1.0 fixes two blocking failures in V15.0.1:

1. The coverage coach tracked yaw sectors rather than photographed wall surfaces. A sector could therefore remain red forever even after the useful area had been photographed.
2. Browser Back could tear down the WebXR session while camera conversion or application state was still active, producing a perceived crash and losing the path to Review.

## User workflow

1. Open the page in Chrome Android on an ARCore-compatible phone over HTTPS.
2. Press `Avvia scansione WebXR`.
3. Mark the floor/wall corners of the first room in order and close the footprint.
4. Confirm the room height.
5. Follow the colored quadrilaterals drawn directly on the measured walls.
6. Complete the room after at least three photographs from at least two positions.
7. Use `Attraversa passaggio`, walk through the doorway, then start the connected room without ending WebXR.
8. Press `Salva e chiudi` or browser Back to preserve the scan and open Review.
9. Edit doors and objects, add/remove objects, export RAW/PLY/OBJ, and optionally run the post-XR Deep batch.

## Wall target semantics

Each measured wall is split into a small number of metric columns and two vertical bands:

- lower band, role `objects`: requires two spatially distinct camera positions;
- upper band, role `surface`: requires one usable position.

The overlay uses these states:

- red: no usable photograph has covered the tile;
- yellow: one usable position exists, but the lower/object band still needs another position;
- green: the tile has enough distinct evidence.

The selected tile has a heavier outline and a label such as `FOTO 0/2` or `ALTRA VISTA 1/2`. A large arrow points toward the selected physical area. When the same lower tile has already been seen from the current position, the instruction asks the user to move laterally by about half a metre instead of taking duplicate photographs.

A frame can update more than one visible tile. The user no longer has to chase a single angular bin. The number of targets is bounded by four columns per wall, so the overlay remains light enough for a phone.

## Completion policy

All-green coverage is a quality goal, not a hard lock. A room can be completed after:

- at least three stored photographs;
- at least two spatially distinct camera positions.

Unresolved red/yellow targets are stored in `captureSummary` and displayed in Review. This prevents an occluded, unreachable, or numerically marginal tile from making completion impossible.

## Safe Back and automatic recovery

When browser Back or `Salva e chiudi` is used during WebXR, the application:

1. suspends new automatic captures;
2. lets the active capture settle, or cancels only that transient request after a bounded delay;
3. marks the current measured room as partial when it was not completed;
4. writes a compact checkpoint to IndexedDB;
5. ends the existing WebXR session once;
6. releases XR camera, depth, anchors, WebGL and transient buffers;
7. opens Review in the same document.

The checkpoint contains room footprints, heights, wall targets and observations, synchronized frames, portals, edited objects, wall textures and processing state. Object and portal edits trigger additional checkpoint writes. The landing page exposes `Ripristina ultima scansione` when a checkpoint exists.

A restored scan is reviewable and exportable. It is not resumed inside a new `local-floor` session because a new WebXR session would not share the old metric reference frame.

## Metric and camera contract

- Exactly one `navigator.xr.requestSession('immersive-ar', ...)` call exists.
- `local-floor`, DOM overlay and Raw Camera Access are required.
- hit test, anchors, plane detection, depth sensing and light estimation are optional.
- Exactly one `getCameraImage()` call site exists, reachable only from the XR animation-frame capture path.
- No `getUserMedia`, second camera stream, or MediaStream pipeline is used.
- Every keyframe stores RGB, projection, world-from-view, world-to-view and optional sparse CPU XR depth from the same XR frame.
- Walls remain authoritative WebXR geometry. Neural depth can add object evidence but cannot move walls.

## Object workflow

Sparse XR depth and post-XR Deep depth are compared with the expected room shell. Evidence significantly in front of the shell becomes an object candidate. Candidates are voxelized per room and require persistence from distinct views or complementary XR/Deep evidence.

In `Mappa e oggetti` the user can:

- add a manual cuboid with two taps;
- rename and resize an object;
- change its yaw and height;
- hide/show it;
- remove/restore it;
- edit passage width and top height.

Manual corrections are authoritative in scene preview and OBJ export. Every such change is checkpointed.

## Deep batch

Deep Anything V2 Small Q4 is loaded only after XR ends. The worker attempts local runtime/model files first, then remote URLs. Model bytes are cached in IndexedDB. If Deep fails or the phone lacks memory, the metric room shell, XR photos/depth, manual objects and exports remain usable.

Local offline paths:

- `vendor/onnxruntime-web/`
- `models/depth_anything_v2_small_q4.onnx`

## Deployment

Publish the contents of this directory at the GitHub Pages root. Keep `room_scanner_v12.html` as the canonical entry unless all references and tests are updated.

The executable files used by the page are:

- `roomscan_core_v15_1_0.js`
- `roomscan_app_v15_1_0.js`
- `depth_ai_worker_v15_1_0.js`
- `sw_v15_1_0.js`

Compatibility aliases without a version suffix are byte-identical and are used by tests and integrations.

After deployment, the landing badge must read:

`V15.1.0 · WALL TARGETS + RECOVERY`

The service worker uses network-first delivery for HTML, JavaScript, workers and build metadata, while retaining an offline shell after the first successful online load.

## Local verification

Run:

```sh
sh tests/run_all.sh
```

The suite covers geometry, wall target projection, distinct-view target status, object voxels, Deep worker input contracts, DOM/static contracts, two connected rooms, completion race protection, non-blocking coverage, Back recovery, IndexedDB checkpoint recovery and HTTP delivery.

Physical Raw Camera Access, device-specific ARCore depth, thermal behavior and memory pressure still require the tests in `TEST_ON_PHONE.md`.
