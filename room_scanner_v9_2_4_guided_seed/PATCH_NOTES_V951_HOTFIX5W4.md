# v9.5.1 Hotfix5W4 — object selection + fullscreen Twin

Build: `v9.5.1-hotfix5w4-object-ui-fullscreen-viewer`  
Deploy revision: `951h5w4`

## Root causes fixed

1. **Guided MobileSAM UI was not actually selectable.** The full-screen mask
   canvas had no pointer interaction and the first segmentation was gated by
   strict multi-view geometry. The first mask can now be requested as soon as
   the tapped location has local XR depth; multi-view reliability is enforced
   when subsequent views/proxies are accepted.
2. **The v9.5 reticle wrapper ignored the user's tap.** It kept sampling the
   screen center for the 3D target. Reticle/world lookup, SAM prompt and the
   RGB-D fallback now all use the same normalized `promptUV`.
3. **Boundary points were incomplete.** The boundary tool expected
   `readiness.targetPoint`, but the readiness function did not reliably return
   one. A depth-backed world target is now returned for the selected point.
4. **Stage 5 could remain in the workflow UI instead of the 3D viewer.** End of
   measurement now creates a raw Gaussian preview and opens an exclusive
   full-screen Twin automatically. The workflow rail/HUD/landing are hidden.
5. **The WebXR-only preview could still become empty.** The previous visual
   fallback reused the live probabilistic filter. H5W4 adds a viewer-only,
   spatially downsampled fallback from measured WebXR/depth surfels. It is never
   promoted to validated acoustic geometry.

## Object workflow

`tap object -> local depth ready -> Segmenta qui -> confirm mask -> move phone -> save independent views -> finalize compact proxy`

MobileSAM remains optional and is released before the acoustic measurement.
The raw masks/images are discarded after a compact object proxy is finalized.

## Stage 5

- Full-screen preview opens automatically at the end of measurement.
- The existing Three.js/WebGL renderer is reused; no second WebGL context.
- A gear opens the controls drawer. `Riprocessa modello 3D` runs the full
  deferred reconstruction/DepthAI path without returning to the workflow rail.
- While processing over the viewer, the progress UI is a small bottom bar.
- Strict Gaussian geometry remains the only geometry eligible for scientific
  acoustic inference; provisional raw WebXR surfels are display-only.

## Regression coverage

`tests/test_v951_hotfix5w4_object_viewer.py` checks tap selection, prompt UV,
metric-readiness separation, boundary target, full-screen viewer state,
automatic preview, raw WebXR visual fallback and deploy revision. The complete
historical suite is also run before packaging.
