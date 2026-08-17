# Audit V14.0.1 — Room Cells

## Architectural reset

V14 removes the global reconstruction stack used in earlier revisions. The application has one authoritative local geometry per cell and only rigid cell-to-cell registration.

Removed from the main architecture:

- global TSDF / signed-ray volume;
- global Gaussian/surfel optimizer;
- autonomous plane/wall discovery;
- corner bundle adjustment;
- free per-wall rotations;
- continuous structural rebuild;
- live Depth Anything;
- global ICP / dense point-cloud registration.

## Authoritative state

A cell contains:

- capture station pose/yaw;
- user-selected floor footprint in station-local coordinates;
- scalar ceiling height;
- derived wall surfaces;
- panorama coverage;
- per-wall coverage;
- photographs and texture atlas;
- explicit portal links.

The footprint does not move during panorama/Deep processing.

## Portal registration

The source opening is explicitly marked by the user. The target matching wall is selected automatically from the new cell.

Registration solves only one rigid SE(2) transform for the complete target cell. Shared-wall overlap is calculated after registration and stored as a synthetic full-height cutout on the target cell. This suppresses only the duplicated interval, not the entire target wall.

## Height

Height inference uses image evidence on a known metric wall plane. The automatic search evaluates projected wall-ceiling lines over a bounded height range. A manual tap creates a ray/wall intersection and is retained as a metric height sample.

Height photos are also available to texture/Deep processing.

## Panorama

A panorama is a set of normal posed photos. Directional coverage is tracked in 24 angular bins. No image stitching is performed.

## Deep safety

Deep runs only in `processModel()`, after XR is ended. The XR animation frame contains no worker initialization or inference calls.

The relative map is fitted to metric depth with robust affine direct/inverse models. Foreground becomes object evidence; behind-shell samples become optical/portal evidence; structural samples never move the cell shell.

Full Deep float maps are set to `null` after each frame.

## Objects

The primary object representation is a bounded voxelized RGB population. Connected components require temporal/source persistence. OBBs are derived only for selection and dimensions.

Object evidence is capped at 34,000 voxels.

## Texture

Wall atlases are generated in bounded resolution profiles. Foreground masks reject object pixels. Viewer rendering uses the atlas on the planar wall pieces around portal/shared-wall cutouts.

## Static audit

Automated tests verify:

- one immersive `requestSession()` call;
- no `getUserMedia()` or `ImageCapture` second-camera path;
- no `setInterval()`;
- no V12/V13 TSDF/global wall optimizer symbols;
- no duplicate function declarations;
- no duplicate DOM IDs;
- no duplicate direct listeners;
- Deep absent from the XR frame loop;
- package/service-worker version coherence;
- cell/portal registration and object persistence.

## Browser/HTTP smoke

The final HTML was served by a local HTTP server and fetched successfully (HTTP 200). A headless Chromium launch produced no application `ReferenceError`, `TypeError`, `SyntaxError`, failed module-load or `net::ERR` diagnostics, but this container did not return a usable `--dump-dom` result before timeout. The deterministic VM bootstrap test is therefore the authoritative browser-JavaScript bootstrap check. Immersive WebXR/ARCore hardware behavior remains device-only.

## Device-only validation still required

- `camera-access` permission and raw camera image;
- ARCore `local-floor` stability;
- CPU depth availability/format on target handset;
- tracking under motion/low texture;
- practical panorama guidance visibility outdoors/indoors;
- portal wall matching with real WebXR drift;
- physical accuracy of image-guided height estimation.


## V14.0.1 capture-lifetime audit

The V14.0.0 regression was traced to `captureFrame()`: it called `readCameraRGBA(S.currentView)` from the button event after the producing XR animation callback had returned. The stored `XRView` still existed as a JavaScript object but its underlying `XRFrame` was inactive, so Chromium correctly rejected `XRWebGLBinding.getCameraImage()`.

V14.0.1 enforces a single ownership rule: only `onXRFrame()` (and helpers invoked synchronously by it) may access raw camera or frame depth. UI handlers enqueue `S.captureRequest`; `fulfillCaptureRequest(frame, view)` performs the synchronized copy inside the next valid XR callback. Static regression tests assert that `captureFrame()` contains no `readCameraRGBA`, `getCameraImage`, `sampleDepthGrid` or `S.currentFrame` access.
