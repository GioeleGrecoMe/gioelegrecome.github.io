# V30.1 phone verification

Use the new V30 folder over HTTPS. For the first deployment, clear only the V30
folder site data if an older V30 service worker was previously installed.

## A. Bootstrap before camera permission

1. Move the camera-height slider. The numeric label must update immediately.
2. Open `Diagnostica / debug`.
3. Press `Esegui self-test`.
4. Expected: secure context, DOM, WASM core, Gaussian worker, IndexedDB and
   service-worker-file tests pass.
5. Press `Scarica log` and verify a JSON file is produced.

## B. Camera/WASM

1. Press `Avvia scansione`.
2. Grant rear camera access.
3. On iOS, grant motion access if requested.
4. `feat` should become non-zero on textured content.
5. With slow motion, `match` should also become non-zero.
6. Expected default: `Deep live OFF` and no model download while measuring.
   The optional live switch may be tested separately; any model issue must not
   close the camera or disable Finish.

## C. Keyframes and metric bootstrap

1. Point at a textured floor patch.
2. Let several keyframes accumulate.
3. If Depth loads, verify the scale label changes from `scala attesa` to a
   confidence value and landmark count begins to increase.
4. Cover floor, walls, ceiling and furniture from several viewpoints.

## D. Markpoint

After some depth-supported landmarks exist, aim the center reticle at a stable,
high-contrast detail and press `Pin repere`. The coach must report accepted or a
specific rejection reason.

## E. Finish/review

1. Press `Salva / termina`.
2. Camera tracks must stop.
3. Review must remain usable even if Deep had failed.
4. Test orbit, pan, zoom and splat size.
5. Export PLY, `.r30` and diagnostics.
6. Return Home and import the PLY and `.r30` again.
7. Return Home, press `Apri` on the saved local session, then export `.r30`
   again. The keyframe count and Gaussian map must still be available.
8. Press `Elabora Deep dopo la scansione`. The review remains available while
   it runs and the button reports progress. If no reliable floor/scale is found,
   it must finish with zero Gaussian rather than invent a metric map.

## F. Failure capture

If the tab reloads, freezes or controls stop responding, reopen V30 immediately
and download diagnostics. Also note browser version, device model, approximate
scan duration and whether Deep showed WebGPU, WASM or an error.
