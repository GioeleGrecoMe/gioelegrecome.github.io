# Room Scanner v9.2.5 — Guided EfficientSAM Object Seeding

**Build:** `v9.2.5-clean-guided-preflight`

This build keeps the realtime-budgeted Gaussian mapping from v9.2.2 and changes semantic inference to an explicitly guided workflow.

## New acquisition flow

1. Load or run acoustic calibration.
2. Enter WebXR. Pose + depth begin immediately, but scientific microphone capture and chirps are still OFF.
3. Before the object UI is shown, the app runs a **semantic preflight**: ONNX Runtime is loaded, the bundled encoder and decoder sessions are created, and one real encoder→decoder smoke inference is executed.
4. If that preflight fails, the object phase is **skipped automatically** and scientific measurement starts normally with an explicit warning in the HUD/diagnostic snapshot. There is no fake RGB-D substitute presented as SAM.
5. If preflight succeeds, the app enters a dedicated **camera-first object mode**: camera + centre reticle + a compact bottom control bar only. The normal XR HUD, splat preview, debug, lighting, semantic manager and processing overlays are hidden.
6. Point at an object and press **Segmenta al mirino**. Review the green mask and press **Conferma** only if it is correct; otherwise reposition and retry.
7. Repeat for useful objects, then press **Inizia misura**. EfficientSAM sessions are released before scientific acquisition to free CPU/GPU memory; the model can be reloaded later only if an explicit semantic action requires it.
8. WebXR/depth/multi-view evidence refines the visible geometry attached to each confirmed object. Unseen parts remain a conservative box prior with lower `closureConfidence`; this prior is never treated as measured geometry.

This workflow deliberately separates *semantic identity* from *metric truth*: a SAM mask can label visible depth, but only WebXR/depth/multi-view support can make geometry reliable.

## EfficientSAM integration

The exact official EfficientSAM-Ti split ONNX weights from the user-provided `yformer/EfficientSAM` archive are bundled under `models/`:

- `efficient_sam_vitt_encoder.onnx` — SHA-256 `84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951`
- `efficient_sam_vitt_decoder.onnx` — SHA-256 `a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11`

Runtime downloads of **model weights are disabled**. `third_party/EfficientSAM/` retains the upstream Apache-2.0 license and ONNX export/reference scripts.

EfficientSAM itself does not contain a browser ONNX executor. The separate dependency is **ONNX Runtime Web 1.27.0**. The HTML first loads `./vendor/ort.webgpu.bundle.min.mjs`; if the vendor runtime is not installed it can use a pinned jsDelivr runtime fallback. To make segmentation fully offline, copy the matching ONNX Runtime Web artifacts into `vendor/` or run:

```bash
python tools/fetch_onnxruntime_web.py
```

Required matching runtime files are documented in `vendor/README.md`. Geometry/acoustics remain fail-open if ONNX Runtime cannot load.

## Final viewer / RIR

The final 3-D view stays clean until the gear is opened. The RIR plot is now a collapsed row inside the scrollable drawer and cannot overlay the control buttons.

No synthetic RIR is generated automatically on viewer open. The app may pre-position source/receiver at a useful measured pair, but the graph remains **RIR: non calcolata** until **Genera RIR** is pressed. The solver result stores its computation time and provenance. Moving source, receiver, their heights, or a receiver following the virtual camera invalidates the previous result and forces an explicit recalculation.

---

## Realtime mapping carried forward from v9.2.x

## Why v9.1 became heavy

The v9.1 mapping logic was scientifically stricter than v8, but too much of that work ran synchronously during acquisition:

- each newly fused depth surfel could immediately run multi-view reprojection against many keyframes;
- local manifold/coherence scans were repeated during insertion and preview consolidation;
- live splat refresh could rebuild the complete geometry field and reallocate GPU attributes;
- RGB camera readback was relatively large and frequent;
- semantic work could compete with measurement if a keyframe became eligible at the wrong moment;
- packet completion could trigger full geometry/acoustic consolidation;
- manual quality/optimization buttons could accidentally launch final-processing algorithms during XR.

v9.2.1 removes these paths from realtime acquisition.

## Realtime governor

The app continuously measures frame cost and selects load level L0–L3. Long browser tasks can also raise the level immediately.

At increasing load it progressively:

1. pauses automatic neural segmentation;
2. disables RGB edge priors while retaining depth boundaries;
3. lowers RGB readback rate;
4. reduces the number of depth samples fused into live surfels while retaining the full low-resolution depth keyframe used for later multi-view validation;
5. lowers live splat count;
6. reduces the time budget spent validating unstable surfels;
7. skips live acoustic-Gaussian refinement at high load;
8. raises the threshold for displaying uncertain surfels;
9. limits creation of fine surfels and applies an adaptive soft map cap.

The current preview caps are 7000 / 4800 / 2800 / 1600 splats. RGB readback adapts between 2.5 and 0.6 fps. Depth fusion uses strides 1 / 1 / 2 / 3, while the stored map-frame depth grid remains available for later validation.

## Geometry mapping

New depth observations enter the map cheaply. Expensive multi-view reprojection and local-manifold validation are moved to a bounded round-robin/priority queue and consumed in small time slices. A new point can therefore be displayed and later confirmed without forcing one XR callback to validate the whole map.

Surfel storage also has adaptive soft caps (140k / 110k / 85k / 65k). Under pressure, fine surfels are first demoted to coarse cells; ordinary new depth surfels are then suppressed before native XRPlane/XRMesh evidence. This limits long-session memory growth without deleting stable evidence.

The full scientific Gaussian field is built after acquisition or during explicit second-stage processing.

## Edges and semantic priors

Low-cost depth/RGB boundaries are computed only on selected RGB-D keyframes. RGB edge work is skipped at elevated load; depth discontinuities remain available because they are cheap and geometrically useful.

EfficientSAM-Ti remains optional and explicitly bounded:

- a complete encoder→decoder preflight runs before guided object mode is exposed;
- if preflight fails, guided object mode is skipped rather than emulated;
- split encoder/decoder ONNX;
- WebGPU first, WASM fallback;
- during guided seeding, encoder runs only for an explicit user segmentation;
- confirmed identity is then propagated by WebXR/depth/multi-view geometry rather than continuous SAM inference;
- neural sessions are released before scientific measurement to reduce memory/GPU pressure.

Semantic masks are priors only. They cannot create metric depth.

## Acoustic live refinement

Packet-joint RIR processing remains unchanged scientifically. The **live** acoustic map now uses a lightweight cache containing only the recent RIR pose/quality/echo information required by the virtual-array splat. It no longer recomputes RT/EDC and full per-band sample metadata for every prior RIR after each packet.

Live acoustic budgets are limited to 360 geometry nodes / 10 recent RIRs at L0 and 220 / 8 at L1. At L2–L3 live acoustic refinement is skipped; all raw measurements are retained and the complete field is rebuilt after acquisition.

## RGB camera / metric quality

RGB readback is intentionally modest (384×216, adaptive 2.5→0.6 fps). It supplies colour and occasional semantic keyframes. WebXR pose, depth and native plane/mesh metric evidence remain independent of RGB preview resolution.

The Three.js renderer also uses a mobile-aware pixel ratio, XR framebuffer scaling and foveation where supported. These affect display cost, not exported metric coordinates.

## Diagnostic Snapshot

Two buttons are available:

- **Diagnostica ZIP** on the landing page;
- **Diagnostica** in the XR advanced controls.

The ZIP is intentionally much smaller than a RAW project and is designed to be uploaded for debugging. It contains:

- runtime/performance snapshot;
- governor level and recent timeline;
- frame time / long-task history;
- depth, preview, validation and camera average costs;
- surfel counts, stable/verified support and allocation/pruning counters;
- active live budgets;
- renderer draw/memory counters;
- RGB/photometric state;
- semantic scheduler/backend/object state;
- audio/calibration/sweep/packet/RIR summaries;
- tracking/XR errors;
- bounded surfel sample;
- map-frame summary;
- structural graph;
- recent application events/debug messages.

Raw PCM and raw video are deliberately excluded from this diagnostic ZIP.

## Desktop / RAW projects

Existing RAW ZIP, processed project ZIP and twin JSON remain loadable without WebXR. Opening RAW stays lazy: geometry/path first, PCM/DSP only on explicit reprocessing.

## Recommended device test

1. Open the app and optionally preload the semantic model.
2. Start measurement and move continuously through the room.
3. Watch `RT L0..L3` in the HUD. A temporary increase is expected under load; it should recover when load drops.
4. Verify that the Gaussian preview remains responsive and continues filling new regions.
5. Complete several acoustic packets.
6. If there are stalls, immediately export **Diagnostica ZIP** and save it for analysis.
7. Run the complete structural/acoustic second processing only after acquisition.

See `PERFORMANCE_AUDIT_V9_2.md`, `ARCHITECTURE_V9.md`, `MODEL_INTEGRATION_V9_1.md` and `TEST_REPORT.md`.

## v9.2.2 diagnostic-driven fixes

This build addresses three regressions observed in a real v9.2.1 Diagnostic Snapshot:

1. **Sparse live preview despite a dense map.** Candidate reliability is now evaluated before spatial capping. Stable/verified surfels fill the preview first and recent provisional surfels are rendered more transparently.
2. **Final reconstruction stuck at phase 3.** Full multi-view validation is cooperative and progress-aware; it no longer scans ~50k surfels synchronously on the main thread.
3. **No persistent objects.** Readable semantic keyframes survive realtime governor L1/L2 and wait for a packet-safe inference window. At L3 they remain queued. A lightweight RGB-D persistent-region tracker provides low-confidence object priors if neural inference is unavailable.

The bundled `models/` directory contains the exact EfficientSAM-Ti encoder/decoder weights supplied by the user; remote model-weight downloads are disabled.

Use **Diagnostica ZIP** again if the revised final processing stalls or if the visible splat count remains far below the `verified/stable` counters; the v9.2.2 snapshot preserves the same performance timeline and subsystem counters.

## v9.2.3 - EfficientSAM-Ti bundled locally

The EfficientSAM-Ti split ONNX encoder/decoder from the user-provided upstream
archive are now included under `models/`. Runtime model-weight downloads from
Hugging Face/GitHub are disabled. Semantic inference is preflighted before guided object selection and is otherwise explicitly user-driven; no continuous SAM loop runs during scientific acquisition.

ONNX Runtime Web is a separate Microsoft dependency and is not included in the
EfficientSAM repository. Run `python tools/fetch_onnxruntime_web.py` once before
deployment for a fully local semantic stack. Without those vendor files the app
tries the pinned official runtime CDN and otherwise falls back to RGB-D semantic
priors without stopping the scan.


## v9.2.5 - Clean semantic preflight

Guided object selection is now a dedicated XR mode with an unobstructed camera. Before it appears, the app validates the complete semantic path by creating the local EfficientSAM encoder/decoder sessions and running an end-to-end smoke inference. Failure is fail-open: the app reports the reason and starts measurement without object seeding. Successful sessions are unloaded when object selection ends so they do not consume resources during the acoustic/geometry scan. The diagnostic ZIP records preflight result, provider, runtime, duration and error.
