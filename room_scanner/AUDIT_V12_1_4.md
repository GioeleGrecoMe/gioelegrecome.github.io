# V12.1.4 code audit - findings and fixes

Audited source baseline: repository tree at commit `e45bd0ff0b825af010cd4d2c95f51bf3c7deb0ab` plus the V12.1.3 code developed in this project.

## Critical / high-impact findings fixed

1. **Stale deploy/cache identity** - `sw.js` and `build_info.json` still identified a V10-era build while V12 was the current application. Replaced with V12.1.4 build/cache identity and update policy.
2. **Partial-model visibility** - previous workflows could expose evolving derived geometry. V12.1.4 makes final reconstruction a transaction and commits the viewer model only after all selected Deep frames, global fusion and ROOM_SHELL complete.
3. **Hidden heavy Deep work during acquisition** - removed automatic full Deep processing/revalidation from keyframe capture. Acquisition remains WebXR-focused; Deep is an explicit batch.
4. **ONNX + XR simultaneous pressure** - the Depth worker/session is released before XR and after processing.
5. **Unbounded-ish sparse reconstruction growth** - XR TSDF, Deep TSDF, native surfels and Deep surfels now have explicit budgets and pruning.
6. **TSDF cap could silently freeze new areas** - pruning now frees weak/old/Deep cells while preferentially preserving strong XR zero-crossing/free-space evidence.
7. **Stale active XRPlane/XRMesh records** - records no longer reported by the runtime are removed from active primitive maps.
8. **Repeated XRMesh/XRPlane work** - updates are throttled and unchanged `lastChangedTime` records are skipped.
9. **RGBA memory growth** - only a small hot set remains decoded. Older keyframes are JPEG-backed and decoded on demand.
10. **Duplicated synchronized anchors** - new frames no longer keep a second object-heavy anchor list in addition to the metric XR depth grid.
11. **Float32 Deep-map retention** - processed relative-depth maps are quantized to uint16 in RAM after local optimization/mesh construction.
12. **Continuous camera color-copy churn** - XR color painting borrows the reusable readback buffer; persistent copies are made only for keyframes.
13. **Repeated canvas allocation during Deep resizing** - source/destination resize canvases are reused across the batch.
14. **Review DOM churn while hidden** - thumbnail generation is lazy.
15. **Viewer RAF duplication** - scene redraws are coalesced.
16. **Import memory accumulation** - added per-file and aggregate model caps plus RAW frame/map guards.
17. **Imported-data markup injection** - filenames and imported RAW metadata are escaped before `innerHTML` rendering.
18. **Coplanar overmerge** - surface optimization requires spatial/tangential proximity in addition to angle/offset compatibility.
19. **Cold-photo shell colors** - ROOM_SHELL can recover color from painted native XR surfels after RGBA eviction.
20. **Automatic photo accumulation** - automatic keyframes have a soft memory cap; manual captures remain available and are not automatically deleted.

## UI / button audit

- all HTML IDs unique;
- every `$()` ID reference resolves to an element;
- no direct duplicate event listeners found;
- obsolete `rebuildAll` button/listener removed;
- `Processa modello` and `Ricalcola modello` intentionally share one batch function;
- `Chiudi` and `Ricalcola modello` remain in bottom footers;
- process overlay includes progress, Deep count, fused count, weak count, cancel and quality downgrade;
- final Scene/export are gated by complete model commit;
- imported PLY/OBJ models can still be viewed independently.

## Worker/runtime audit

The existing `depth_ai_worker.js` was inspected and intentionally left unchanged. It owns an isolated ONNX Runtime session, validates the model contract, verifies the pinned Q4 model size/hash, transfers the output depth buffer back to the main thread and supports session disposal. The current V12 product path forces the verified Q4/WASM route.

The repository also retains legacy MobileSAM and older ONNX runtime assets for old pages. V12.1.4 does not load MobileSAM and references only `vendor/depthai-123/` for Depth. They can remain for backward compatibility, but they should not be added to the V12.1.4 service-worker pre-cache.

## Remaining device-only risks

- Chrome/ARCore raw-camera/depth/plane/mesh feature behavior cannot be fully reproduced in Node.
- A JS `Map`-based sparse TSDF is still more memory-expensive than a native packed hash volume. Budgets/pruning bound it, but if sessions become much larger the next architectural step should be a typed-array/open-addressed voxel store or a worker/WASM volume.
- JSON RAW export still requires `JSON.stringify`, so very large RAW exports can create a transient memory spike. The acquisition caps and compressed evidence reduce this risk; a future revision could stream/chunk RAW into ZIP/OPFS.
- PLY/OBJ parsers are text parsers by design; very large external meshes are deliberately rejected instead of risking a mobile crash.
- Physical long-session profiling on the target phone remains required before raising any configured budgets.
