# Room Scanner V12.1.4 - audited batch fusion

V12.1.4 is an audited replacement for `room_scanner_v12.html`, based on the stable V12.0.2-compatible WebXR acquisition path and the V12.1.x TSDF/ray/structural reconstruction path.

The primary rule of this revision is that acquisition and final reconstruction are separated:

`WebXR scan -> stored metric evidence/keyframes -> explicit Deep batch -> atomic global fusion -> optimized surfaces -> ROOM_SHELL -> final viewer/export`

The final model is not replaced while the Deep batch is only partially complete.

## Files to deploy

Replace/add these files in `room_scanner/`:

- `room_scanner_v12.html`
- `sw.js`
- `build_info.json`
- `tests/test_v12_1_4_static.js`
- `tests/test_v12_1_4_runtime.js`
- `tests/test_v12_1_4_package.js`

Keep these existing dependencies from commit `e45bd0ff0b825af010cd4d2c95f51bf3c7deb0ab`:

- `depth_ai_worker.js`
- `models/depth_anything_v2_small_q4.onnx`
- `vendor/depthai-123/`

The worker/model/runtime are intentionally not duplicated in this archive because they are unchanged binary/runtime dependencies. The V12 product path continues to use the verified Q4/WASM model.

## Processing workflow

During XR acquisition the app collects:

- WebXR poses;
- CPU metric depth when available;
- XR planes and XR meshes when available;
- raw RGB keyframes from the same XRView camera;
- colored native XR surfels;
- sparse signed-ray/TSDF evidence;
- coverage diagnostics.

Depth Anything is not automatically run for every keyframe during scanning. Press `Processa modello` after acquisition.

The processing modal reports:

- Deep photos processed / total;
- photos that actually contributed accepted geometry to the global 3D map;
- weak/excluded photos;
- current processing stage and progress.

Only after all selected photos have been inferred, optimized, globally fused and the structural shell has been rebuilt is `modelReady` committed and the final scene opened.

If processing is too slow, `Riduci qualita e riavvia` safely cancels after the current step and restarts the whole transaction at the next lower quality. The previous final model remains untouched until the new batch succeeds.

### Quality profiles

- High: Deep target 392 px, source up to 720 px, 12 optimizer iterations, denser per-photo mesh.
- Balanced: Deep target 336 px, source up to 560 px, 8 optimizer iterations. Default.
- Fast: Deep target 280 px, source up to 420 px, 5 optimizer iterations and reduced mesh budget.

WebXR metric depth, poses and planes are not downscaled by this choice; the quality control primarily changes Deep inference/optimization cost.

## UI audit

- `Chiudi` is at the bottom of Scene and Review.
- `Ricalcola modello` is at the bottom of Review.
- There is no stale/duplicate `rebuildAll` button or event listener.
- The two visible processing entry points (`Processa modello` on the welcome screen and `Ricalcola modello` in Review) call the same transaction.
- Scene/PLY/OBJ final export are gated until a complete model is committed.
- PLY/OBJ import remains available independently and imported models are shown in a separate viewer layer.
- Fullscreen and `visualViewport`/safe-area handling keep mobile controls reachable.

## Memory audit and protections

V12.1.4 adds explicit limits instead of relying on garbage collection to save the session:

- bounded native XR surfels;
- bounded Deep surfels;
- separate bounded XR and Deep TSDF volumes;
- pruning before persistent sparse maps saturate;
- adaptive lower budgets on devices reporting <= 4 GB through `navigator.deviceMemory`;
- automatic keyframes stop at a soft cap (140 normally, 100 on <=4 GB devices); manual photos remain available and are never silently deleted;
- only a few hot 720p RGBA frames remain decoded;
- older RGB keyframes are stored as JPEG and decoded on demand;
- synchronized XR anchors are reconstructed from the stored metric depth grid instead of being duplicated as hundreds of JS objects per frame;
- completed Deep maps are quantized to 16-bit in RAM after their local mesh/optimizer pass;
- per-frame Deep meshes and ray guides are released after global commit;
- the ONNX worker is terminated before XR acquisition and after batch processing so WebXR/ARCore and the Depth session are not intentionally resident together;
- WebGL raw-camera framebuffer/texture/program/buffer/shaders are disposed at XR end;
- WebXR plane/mesh records no longer reported by the runtime are removed from the active maps;
- XR plane/mesh updates are throttled and unchanged `lastChangedTime` records are skipped;
- Review thumbnail DOM is rebuilt only while Review is open;
- viewer redraws are coalesced through one animation frame;
- imported PLY/OBJ files have per-file and aggregate geometry budgets;
- RAW import validates frame count and suspicious map dimensions before expanding typed arrays.

The RGB color painter reuses the WebGL camera readback buffer for continuous XR coloring instead of allocating a new 720p copy at every color pass. Saved keyframes still receive their own copy.

## Geometry audit

The final scene keeps raw evidence separate from derived geometry.

- WebXR remains the metric authority.
- Deep is aligned to synchronized XR depth, signed-ray/TSDF evidence, structural planes and independent views.
- Deep-only derived planes cannot authorize more Deep geometry by themselves.
- Nearby coplanar structural surfaces can be optimized/merged, but distant coplanar walls are not merged across unknown space.
- stale XR planes/meshes are removed from active primitive maps.
- final PLY points are voxel-compacted.
- ROOM_SHELL remains the compact structural OBJ representation.
- room shell colors fall back to already painted metric XR surfels after cold RGB buffers have been evicted.

## RAW / PLY / OBJ

RAW schema: `room-scanner-v12.1.4-raw`.

The RAW keeps the evidence required for reprocessing, while avoiding derived per-frame Deep mesh duplication. Deep maps are serialized as linear uint16 plus min/max. New keyframes do not serialize a second copy of synchronized XR anchors because those anchors are derivable from the XR depth grid and pose.

PLY export contains the compact fused colored point cloud. OBJ export contains the closed room shell. PLY/OBJ exported by the app can be loaded back into the viewer with `Carica PLY/OBJ`.

Dynamic text originating from imported RAW/model files is HTML-escaped before being placed in Review.

## Service worker audit

The repository snapshot audited for this revision still identified its service worker/build metadata as a legacy V10 build. V12.1.4 replaces those runtime metadata files.

The new worker:

- uses V12.1.4 cache names;
- removes older Room Scanner/Room Acoustic caches on activation;
- keeps install pre-cache small;
- treats HTML, Depth worker and build metadata as network-first;
- caches ONNX/WASM only on demand;
- does not download the large Depth model during service-worker installation.

## Automated tests

From `room_scanner/` run:

```bash
node --check /tmp/v1214.mjs   # or extract the module and check it
node tests/test_v12_1_4_static.js
node tests/test_v12_1_4_runtime.js
node tests/test_v12_1_4_package.js
```

The included report contains the actual results produced for this package.

## Device validation still required

Node cannot emulate Android/ARCore WebXR. On the real phone verify:

1. one AR/camera permission flow and stable XR start;
2. native depth coverage changing with movement;
3. manual and automatic keyframes;
4. coverage overlay red/yellow/green behavior;
5. end scan, select Balanced and press `Processa modello`;
6. progress counts advance one photo at a time;
7. the final Scene appears only after the complete batch;
8. downgrade quality during a deliberately long batch;
9. memory remains stable during a long perimeter scan;
10. export and re-import RAW, PLY and OBJ;
11. repeat on a lower-memory Android device if available.

Useful logs for field debugging include `MEMORY_BUDGET`, `MEMORY_PRUNE`, `AUTO_KEYFRAME_SOFT_CAP`, `MODEL_BATCH_START`, `MODEL_BATCH_COMMIT`, `MODEL_BATCH_CANCELLED`, `DEPTH_READY`, `DEPTH_WORKER_CRASH` and the XR capability logs.
