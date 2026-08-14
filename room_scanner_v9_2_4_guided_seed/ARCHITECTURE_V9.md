# Room Scanner v9 — Gaussian Surface SLAM + Semantic/Acoustic Fusion

## Design goal

v9 treats the live map as a **probabilistic 2D Gaussian surfel field**, not as an early triangle mesh. Metric geometry comes from WebXR pose/depth/native geometry and multi-view reprojection. Semantic segmentation is only an optional boundary/object prior. Acoustic properties live on stable Gaussian surfels and are refined by measurements acquired at many receiver positions (a virtual acoustic array). Planes, walls, floors and simple furniture primitives are maintained in a separate structural graph and are finalized only in the second processing stage.

The architecture is deliberately fail-open: semantic inference, plane inference, camera readback, acoustic inversion and final meshing are separate subsystems. Failure of one subsystem must not stop WebXR tracking or destroy the primary Gaussian map.

## 0. Metric state: WebXR / AR runtime

Inputs per valid XR frame:

- 6-DoF camera pose and projection matrix from WebXR;
- depth map when the Depth Sensing module/runtime exposes it;
- XRPlane and XRMesh when supported by the user agent;
- raw camera RGB when `camera-access` / XRWebGLBinding readback is available;
- the already-calibrated continuous audio recorder and chirp schedule.

The app does **not** attempt to reimplement VIO from raw JavaScript accelerometer data. The AR runtime already fuses vision and IMU for the metric camera pose. v9 treats that pose as the authoritative metric trajectory and uses multi-view RGB-D consistency to validate map elements.

## 1. Bounded RGB-D keyframe ring

A keyframe is stored only after sufficient translation, rotation, or elapsed time. The ring is bounded (`mapFrameMax`) so memory use cannot grow with scan duration.

Each keyframe stores:

- low-resolution depth grid;
- world-to-view transform;
- projection matrix;
- camera position;
- semantic boundary grid;
- timestamp/id.

This ring is the evidence used to confirm or contradict Gaussian surfels.

## 2. 2D Gaussian surfel map

Each live map element is a thin oriented surface primitive rather than a free volumetric blob. Its state contains:

- position and local normal;
- RGB estimate and RGB support;
- coarse/fine density level;
- depth/XRMesh/XRPlane support;
- independent-view support;
- reprojection support and contradiction counts;
- local manifold coherence;
- existence probability;
- `unstable`, `weak`, or `stable` state;
- semantic-boundary support;
- local acoustic posterior when available.

### Normal-family separation

The spatial hash key includes a normal bucket. Orthogonal surfaces sharing the same physical neighbourhood (for example wall/floor at a corner) are therefore not averaged into an impossible diagonal cloud.

### Multi-view confirmation

Every candidate surfel is projected into recent RGB-D keyframes:

- observed depth close to predicted depth → positive support;
- observed depth clearly behind the candidate → explicit contradiction / likely ghost;
- observed foreground closer than the candidate → occlusion, therefore neutral;
- outside the camera frustum / invalid depth → no evidence.

Existence probability combines independent views, native XR support, local surface coherence, free-space contradiction and rejection statistics. Low-probability stale candidates are pruned instead of remaining forever in the point cloud.

### Stable / unstable map

New or insufficiently supported surfels are unstable. Re-observed consistent surfels become stable. Stable regions are maintained cheaply; unstable regions receive most of the fusion/refinement work.

## 3. Adaptive densification

v9 does not add fine surfels uniformly. Fine resolution is created preferentially when:

- geometry is newly observed;
- the depth residual is large;
- the RGB residual is large;
- a semantic/object boundary is present.

Already-stable, well-explained regions receive lower maintenance weight. This makes the map denser where the data justify additional detail without allowing unbounded growth.

## 4. Semantic prior — optional and isolated

Segmentation never creates metric geometry. It can only increase the probability that a local region is a boundary and therefore deserves separate/dense surfels.

### Always-available fallback

The default fail-open backend uses low-resolution depth discontinuities plus RGB colour edges. It is extremely cheap and requires no ML runtime.

### Browser neural backend

The v9 adapter supports a split EfficientSAM-Ti ONNX encoder/decoder through ONNX Runtime Web. Loading is lazy and low-rate; inference is never performed inside the XR render loop.

Resolution strategy:

1. local `models/efficientsam_ti_encoder.onnx` / `...decoder.onnx` if installed;
2. optional user-selected local ONNX files;
3. remote model URL fallback when network is available;
4. RGB+depth fallback if model/runtime/inference fails.

The backend interface is intentionally replaceable so a future stable ONNX/WebGPU export of EdgeTAM, EfficientTAM or MobileSAM2 can replace the current model without changing the mapping core.

## 5. Structural graph — parallel, not primary

WebXR native planes are kept as persistent structural nodes instead of being converted once and forgotten. Each node stores polygon, centroid, normal, type, support and confidence.

The graph also contains:

- dominant Manhattan axes inferred from persistent wall normals;
- candidate intersections between orthogonal planes;
- second-stage planes inferred from stable surfels when native plane detection is insufficient;
- connected occupied components classified conservatively as furniture boxes/tabletops/shelves.

During measurement these are not rendered as the main geometry. The user sees the Gaussian RGB map. Structural geometry is finalized only when second-stage processing is explicitly requested.

## 6. Acoustic virtual-array field

The primary acoustic unit is also the Gaussian surfel, not an entire wall.

For a source position `s`, receiver position `r_i`, candidate surfel position `x` and observed early-echo time `t`, consistency is evaluated from

`|s-x| + |x-r_i| ≈ c t`.

As RIR measurements accumulate at many receiver locations, they form a virtual array. Evidence is accumulated robustly on geometrically stable surfels, producing per-band local estimates of:

- reflection coefficient / energy reflectivity `rho`;
- absorption `alpha = 1-rho`;
- uncertainty;
- evidence confidence;
- probability of high reflectivity / high absorption;
- independent receiver-cell and RIR support.

This field can be visualized live over the RGB surfels. A surfel with poor geometric existence probability is prevented from becoming acoustically authoritative.

## 7. Second-stage / desktop refinement

A RAW or processed project can be opened on a PC without WebXR. The first view should appear from the stored Gaussian/path data; heavy RIR replay and structural processing remain explicit operations.

Second-stage processing may:

- re-evaluate multi-view consistency using the stored v9 RGB-D map-frame metadata;
- prune weak surfels more aggressively;
- infer missing planes from stable surfels;
- intersect Manhattan planes and close the room envelope;
- fit simple furniture primitives;
- triangulate/proxy-mesh the stable Gaussian field;
- replay packet-joint chirp segmentation and acoustic inversion;
- transfer/refine local acoustic posterior values on the optimized field.

## 8. Project persistence

v9 exports the evidence needed for later refinement rather than only the final interpretation:

- `surfels_raw.csv` / `surfel_map.csv` with probability, multi-view and semantic fields;
- `map_frames_v9.json` with bounded RGB-D keyframe evidence;
- `structural_graph.json`;
- `xr_raw_geometry.json`;
- continuous audio + chirp schedule + clock sync;
- geometry/acoustic Gaussian fields;
- tracking path and source positions.

Older v8 RAW exports remain loadable; missing v9 evidence is initialized conservatively and can be refined when possible.

## Failure containment

- No semantic model → RGB/depth-edge prior only.
- No RGB camera readback → metric depth/XR Gaussian mapping still works; neutral colour is used.
- No depth → native XRPlane/XRMesh and pose path remain usable; density is reduced.
- No XRPlane/XRMesh → stable surfels can still feed second-stage plane inference.
- Semantic inference exception → logged and disabled; XR loop continues.
- Acoustic DSP failure → geometry remains usable and RAW PCM remains replayable.
- Structural inference failure → Gaussian map remains the primary result.


## 9. Realtime execution budget (v9.2.1)

The scientific representation and the realtime representation are deliberately separated.

The realtime loop may:

- append WebXR poses;
- capture bounded RGB/depth evidence;
- fuse a budgeted subset of depth observations;
- update native XR plane/mesh nodes;
- enqueue surfels for later validation;
- render a bounded representative Gaussian set;
- update lightweight HUD statistics.

It must not synchronously perform:

- full multi-view validation of the complete map;
- global Gaussian consolidation;
- primitive/furniture clustering;
- complete surface fitting;
- full acoustic-array recomputation;
- RT/EDC analysis of all RIRs;
- neural segmentation outside an explicitly safe packet boundary.

A four-level governor adapts optional workload. Crucially, the system preserves the metric path and retained depth keyframes while degrading RGB/semantic/preview workload first. The full field is reconstructed from retained evidence during second-stage processing.

## 10. Sparse edge prior

Image/depth edge information is treated as a prior rather than geometry. On selected map frames, depth discontinuities are always cheap enough to evaluate. RGB gradients are evaluated only at low realtime load. Edge evidence can:

- prevent averaging across likely object/surface boundaries;
- request fine surfels locally;
- seed semantic/object prompts;
- support the later structural graph.

It cannot invent depth or override contradictory multi-view metric evidence.

## 11. Diagnostics and reproducibility

The diagnostic snapshot is a bounded observability artifact separate from RAW data. It records runtime timing, active governor budgets and subsystem states so device-specific stalls can be diagnosed without transferring the full audio/video project.


## v9.3 workflow engineering

The acquisition controller is now an explicit five-state UI machine (`calibration`, `map`, `objects`, `measurement`, `review`). The map and object screens live inside the WebXR DOM-overlay root and never share the normal measurement toolbar. Object segmentation is performed only after a metric warm-up and only after an encoder+decoder preflight. Back-navigation pauses excitation rather than discarding captured PCM. See `ENGINEERING_WORKFLOW_V93.md` for transition semantics.
