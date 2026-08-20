# V30.26.0 phone check

1. Apply this patch over a clean V30.25.0 tree and hard-refresh the site.
2. Start a scan and revisit textured walls, table/radiator edges and corners from
   several small translated viewpoints. Finish the scan normally.
3. Return to the main screen. Under **Sessioni locali**, verify that the new row
   has an enabled `Apri 3D` button. Reopen it and confirm that the same Gaussian
   map appears without rescanning.
4. In 3D review set the target to `5` or `10` iterations. Start optimisation. For
   this short run the preview should update every iteration and the UI must stay
   responsive. Press `Stop` during a run and verify that it stops after the
   current worker iteration.
5. Increase the target (for example 30 or 60). The target is cumulative: after
   10 completed iterations, choosing 30 performs 20 more. Long runs update the
   visual preview in batches rather than repainting on every iteration.
6. Go back to the main screen while viewing an optimised result, reopen the
   session and verify that the completed iteration count and refined map persist.
7. After any non-zero optimisation, the old TSDF mesh should be hidden/marked
   stale. PLY Gaussian export remains valid; mesh export must refuse a stale mesh
   instead of exporting geometry inconsistent with the refined splats.

Useful diagnostic observations: note whether loss decreases, mean displacement
shrinks over successive previews, and repeated planar surfaces become more stable
without corners visibly collapsing into a single plane.
