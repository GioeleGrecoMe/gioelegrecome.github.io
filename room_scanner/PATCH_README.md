# V20.3 Deep/Gaussian overlay for a modified V20.2.x tree

This package is intentionally an **overlay**, not a replacement of the live app.
It preserves the user's current V20.2.x HTML/UI/capture changes and replaces only
the dense mapping and post-XR Deep fusion path.

## Apply

From any machine with Python 3:

```bash
python3 apply_deep_gaussian_patch.py /path/to/your/room_scanner
```

The script creates `backup_before_v20_3_<timestamp>/` before editing anything.
It then:

1. installs `map_worker_v20_3_0.js`, `processing_worker_v20_3_0.js`,
   `depth_ai_worker_v20_3_0.js`, and `reconstruction_v20_3_0.js`;
2. routes the existing XR capture to the new map worker;
3. routes the existing Processing page to the new processing worker;
4. updates a detected service-worker shell cache when possible;
5. runs `node --check` when Node.js is installed.

If an expected V20.2.x anchor string is absent, the script stops rather than
silently rewriting an unknown custom file.

## What changes

### Online, while walking in WebXR

The map is no longer treated mainly as a precursor to planes. It keeps a bounded
set of dense **Gaussian surfels**. Each cell accumulates mean, full symmetric
3x3 covariance, normal, RGB mean/variance, temporal span, view origins, frame
references and source provenance. A Gaussian becomes robust through repeated
observations from distinct views and/or time, not through a single depth hit.

Raw WebXR remains metric authority. The worker is deliberately bounded and
prunes redundant flat observations before edges, objects, markpoints or uncertain
areas.

### Post-XR Deep fusion

Depth Anything is run over many pose-diverse keyframes, one image at a time.
Each frame is metrically calibrated against stable WebXR/map anchors. Direct and
inverse depth mappings are tested robustly and require anchors distributed across
the image. Dense Deep points are then reprojected with their real RGB and merged
into the existing Gaussian map only when geometrically compatible.

Deep-only geometry is provisional until confirmed by at least two distinct Deep
frames. A single hallucinated monocular surface cannot permanently create a wall.

The worker prefers ONNX Runtime WebGPU and falls back to WASM. The model remains
Depth Anything V2 Small Q4 by default because it is practical for Android Chrome.

## Why this is not full 3D Gaussian Splatting optimization

The map stores Gaussian primitives useful for reconstruction, meshing, acoustic
surface inference and future splatting, but does not optimize millions of SH
parameters photometrically inside the XR session. That would compete with ARCore,
camera access, audio acquisition and persistence for GPU/RAM. The expensive part
is deferred, while metric tracking and raw observations are retained.

## Deploy

After patching, deploy the whole site as usual. If the service worker could not be
patched automatically, clear the site's cache/service worker once before testing.
Do not delete the old worker files: keeping them is useful for rollback.

### Optional online RGB enrichment

If the capture file still contains the exact known V20.2 `photoEvidence` pattern,
the patch adds a 3x3 RGB sample for each visible linked cell. This edit is skipped
rather than guessed when a customized capture no longer matches the known shape.
