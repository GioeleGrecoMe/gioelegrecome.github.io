# V30.6 phone verification

Use the new V30 folder over HTTPS. For the first deployment, clear only the V30
folder site data if an older V30 service worker was previously installed.

## A. Bootstrap before camera permission

1. Move the camera-height slider. The numeric label must update immediately.
2. Open `Diagnostica / debug`.
3. Press `Esegui self-test`.
4. Expected: secure context, DOM, WASM core, Gaussian worker, mesh worker, IndexedDB and
   service-worker-file tests pass.
5. Press `Scarica log` and verify a JSON file is produced.

## B. Camera/WASM

1. Press `Avvia scansione guidata`.
2. Grant rear camera access.
3. On iOS, grant motion access if requested.
4. `feat` should become non-zero on textured content.
5. With slow motion, `match` should also become non-zero.
6. Expected: `Deep AI escluso` and no model download while measuring.

## C. Visual-inertial mesh

1. Point at a textured wall with edges, furniture or handles.
2. Let two keyframes accumulate, then take a slow lateral step while keeping
   the same details visible.
3. Verify that `lm`, `mesh` and the live 3D preview start changing. The scale
   label should say `scala L (visuale)`.
4. Continue with lateral arcs; do not reconstruct by only rotating in place.

## D. Markpoint

After some visual landmarks exist, aim the center reticle at a stable,
high-contrast detail and press `Pin repere`. The coach must report accepted or a
specific rejection reason.

## E. Finish/review

1. Press `Salva / termina`.
2. Camera tracks must stop.
3. Review must show the confidence mesh even though no Deep model was loaded.
4. Test orbit, pan, zoom and splat size.
5. Export PLY, `.r30` and diagnostics.
6. Return Home and import the PLY and `.r30` again.
7. Return Home, press `Apri` on the saved local session, then export `.r30`
   again. The keyframe count and Gaussian map must still be available.
8. Press `Rifinisci mesh da keypoint`. The review remains available while it
   rebuilds from saved tracks; no network or neural model must start.

## F. Failure capture

If the tab reloads, freezes or controls stop responding, reopen V30 immediately
and download diagnostics. Also note browser version, device model, approximate
scan duration, whether IMU permission was granted and whether the live mesh
appeared after a lateral movement.
