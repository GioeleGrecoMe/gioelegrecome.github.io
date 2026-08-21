# V30.35 phone validation

1. Publish the patch without replacing your existing `models/` folder. Clear the application shell once and verify `V30.35.0`.
2. Scan a textured part of the room slowly until 6-12 exact RGB+Depth photos are connected.
3. In FOTO mode verify that small auto-exposure/white-balance changes no longer produce strong colour seams. Geometry must remain spherical and sharp.
4. Switch to DEPTH. Do not judge the first two frames: wait until several overlaps/layer references exist. `layer ref` should increase as useful overlaps are collected.
5. Revisit an already photographed area at a slightly different angle. The old and new Depth maps should converge to the same global palette instead of creating another rectangular colour layer.
6. Check foreground objects against background walls. At an occlusion edge the system should prefer one posterior surface or mark the region ambiguous; it should not create a broad averaged band halfway between the two.
7. Cross a photo border in an overlap. The colour transition should be smooth (Hann feather), while borders with no second photo should remain fully visible.
8. If `amb` remains high over large smooth surfaces, export diagnostics: this indicates the nonlinear transforms did not obtain enough stable layer anchors and is directly actionable for further tuning.

The existing 3-D output is not the acceptance criterion for this patch; first validate RGB continuity and global Depth consistency in the live map.
