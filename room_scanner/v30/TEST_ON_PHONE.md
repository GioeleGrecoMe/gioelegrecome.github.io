# EXP-4 phone check

1. Publish the patch once. Reload the page normally. The first transition may take a moment while the new service worker claims the page, but the app must not flash into a second layout or become unclickable.
2. The Home status must reach `Interfaccia pronta.`. In diagnostics, `ui-interactive` should include a shell object whose `version` is `30.27.0-exp.4`, followed by `service-worker-controller` with `coherent:true`.
3. Reload repeatedly (including fast consecutive reloads). Controls must remain clickable. A failed bootstrap must show the inline `Ripristina interfaccia` button instead of a dead page.
4. Run Self-test. `alva-autonomous-world-contract`, `alva-deep-ray-consensus-pipeline`, `service-worker-file`, and `build-info-fresh` must pass.
5. Existing IndexedDB sessions and model/runtime caches must remain available after `Reset cache`; only shell caches are cleared.

# V30.27 EXP-4 phone check - Surface Mesh Lab

1. Apply this patch over **V30.27 EXP-2**, preserving `js/experimental/` and
   `workers/`, then use Reset cache / hard reload once.
2. Reopen the saved session from the diagnostic log. The 17k Gaussian snapshot
   and its completed BASE optimizer iterations remain usable.
3. Press `Avvia EXP`. The old `Failed to fetch dynamically imported module`
   error must disappear. Diagnostics should contain `surface-lab-assets-ready`.
4. Start with 10-20 EXP iterations and voxel 0.03 m. Preview meshing is coarser
   than the final mesh by design; the status also reports mesh build time.
5. Compare `Mostra BASE` / `Mostra EXP` on a wall-floor corner and on thin
   objects. EXP should reduce wavy thickness while preserving the 90-degree edge.
6. If the mesh is too fragmented, retry with voxel 0.035-0.04 m. If it is too
   rounded, retry 0.02-0.025 m after confirming the phone can afford it.
7. Deep/Alva online synchronization remains EXP-2: during a new scan the Deep
   overlay should still show `SYNC ✓`; late inference must not attach to a newer
   pose.

Useful diagnostics:
`surface-lab-assets-ready`, `surface-lab-asset-missing`, mesh face count,
`planarità`, mesh build milliseconds, `deep-frame-sync-ok`.
