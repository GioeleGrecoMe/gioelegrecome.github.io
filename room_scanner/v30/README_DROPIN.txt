Room Scanner V30.6.0 live visual-inertial mesh without Deep AI

Copy/overwrite this directory's contents into the existing /room_scanner/v30/ GitHub Pages directory.
Includes portrait WASM sizing, visual markpoints that work without a neural
depth model, real-time relative-scale-L reconstruction from
tracked keypoints plus IMU priors, Delaunay patches with red/yellow/green
confidence, live 3D preview, explicit final closure estimate, IndexedDB mesh
checkpoints, openable local sessions, and non-destructive R30 import/export.
Replace sw.js too, so an older cached runtime is not reused.
