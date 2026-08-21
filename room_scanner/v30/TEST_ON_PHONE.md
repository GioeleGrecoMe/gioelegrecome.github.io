# V30.27 EXP-3 phone check - Surface Mesh Lab

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
