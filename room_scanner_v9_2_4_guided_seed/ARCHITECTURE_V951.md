# Room Scanner v9.5.1 Architecture

## Core rule

The realtime product is a metric RGB-D surfel/Gaussian map. Neural semantics are finite, user-guided observations that are fused into compact 3D proxies before acoustic measurement.

## Geometry lifecycle

Each surfel is tentative, verified, or stable. Repeated hits from one camera pose are weak evidence. Independent views, reprojection support, local manifold consistency, XRPlane/XRMesh support, free-space contradictions, and rejected normal/position updates determine existence probability.

Single-view evidence is capped. A point cannot become stable simply because the same depth cell samples it many times.

Pruning is progressive:

1. Cheap validation and pruning run at map-keyframe boundaries.
2. Small validation/pruning slices run under the realtime frame budget.
3. A slightly larger cooperative budget is used after a chirp packet is closed, where audio acquisition is in a safe window.
4. Final processing only resolves the residual ambiguous queue and yields to the UI.

Young points are not deleted merely because they are young or low weight. A mono-view point is removed online only after it has had enough independent-view opportunities and remained unsupported, or when explicit contradictions/free-space evidence are strong.

## Guided object capture

Object capture starts only after the local metric readiness gate is green. Readiness is computed around the reticle from depth support, local surfels, independent views, verified/stable support, depth span, local normals, and orientation confidence.

For each object, the user captures multiple sufficiently separated views. MobileSAM segments only those requested views. RGB masks/images are temporary. The accepted observations are fused into a compact proxy containing center, dimensions, yaw/orientation, semantic kind, confidence, material prior, acoustic prior, and optional manual boundary.

During acoustic measurement, the compact proxy is rendered instead of the object's dense surfels. Raw masks and images are not retained in the final object record.

Large walls can use user-drawn metric limits when a segmentation is truncated. Floor and ceiling can be represented as continuous parallel horizontal planes only when a reliable metric level is available; the application does not invent an unknown ceiling height.

## Acoustic object encoding

Each compact proxy contributes simulation surfaces with geometry confidence and a low-confidence material/acoustic prior. Measured local RIR evidence has higher authority and overwrites or dominates the visual prior when reliable.

## Semantic backend

The active production semantic adapter is MobileSAM split encoder/decoder ONNX. The encoder runs once per accepted view and the decoder handles the user prompt. The runtime is ONNX Runtime Web 1.14 WASM, selected for compatibility with the browser MobileSAM conversion used by the deployment path.

Model binaries are intentionally lazy. If MobileSAM is not available or its preflight encoder-to-decoder smoke test fails, the optional object stage is skipped rather than degrading the metric/acoustic measurement.
