Room Scanner V30.5.0 guided feature mesh, sparse Gaussian support and deferred Deep

Copy/overwrite this directory's contents into the existing /room_scanner/v30/ GitHub Pages directory.
Includes portrait WASM sizing, safe Deep shutdown, visual markpoints that work
before depth exists, deferred Deep processing, robust relative-scale-L mesh
reconstruction from tracked features, Delaunay patches with red/yellow/green
confidence, explicit final closure estimate, IndexedDB mesh checkpoints,
openable local sessions, and non-destructive R30 import/export.
Replace sw.js too, so an older cached runtime is not reused.
