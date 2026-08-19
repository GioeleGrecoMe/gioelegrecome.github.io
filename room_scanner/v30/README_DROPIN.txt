Room Scanner V30.4.0 relative-L map, deferred Deep and visual markpoints

Copy/overwrite this directory's contents into the existing /room_scanner/v30/ GitHub Pages directory.
Includes portrait WASM sizing, safe Deep shutdown, visual markpoints that work
before depth exists, deferred Deep processing, robust relative-scale-L Gaussian
fusion when metric calibration is unavailable, IndexedDB Gaussian checkpoints,
openable local sessions, and non-destructive R30 import/export.
Replace sw.js too, so an older cached runtime is not reused.
