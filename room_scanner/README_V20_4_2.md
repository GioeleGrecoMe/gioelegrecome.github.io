# Room Scanner V20.4.2 - Live Mesh Points + 3D Preview

Drop-in patch for an existing V20.4.1 site.

Replace/upload exactly these files:

- `js/grid_v20_2_0.js`
- `js/processing_ui_v20_2_0.js`
- `js/model_preview_v20_4_2.js` (new)
- `css/preview_v20_4_2.css` (new)
- `processing.html`

No capture logic, XR depth logic, config, database schema, worker, service worker or main capture HTML is replaced.

## Capture overlay

Adaptive coverage cells are still the same metric diagnostic cells, but are rendered as point splats plus a sparse adjacency wire mesh. Only the current target receives a halo and `FOTO` label. No filled world-space rectangles are drawn.

## Processing preview

`processing.html` now uses a lightweight local WebGL orbit viewer. It renders RGB surfels / point-Gaussians first, then fitted structural surfaces and object geometry as derived layers. It auto-fits the camera, supports drag/pinch/wheel/double-click, bounds the draw count, and has a CPU canvas fallback.

The viewer intentionally does not modify or decimate the stored model. The draw limit affects only preview rendering.
