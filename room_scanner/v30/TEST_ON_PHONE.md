# V30.25.0 phone check

1. Apply this patch over a clean V30.24.0 tree and hard-refresh the site.
2. Run `Prova inferenza` once. The live depth can remain coarse, but it must not
   show the previous periodic stripe failure.
3. Start scanning and make small translations with strong image overlap. Rotate
   only gradually; translation supplies the useful triangulation baseline.
4. Revisit the same table edge, radiator, wall corner or chair from two or more
   slightly different positions.
5. In the live/review splats, look for convergence rather than instant density:
   provisional one-view points should stay hidden, while repeatedly observed
   surfaces should become denser/stabler and thin/edge structures may retain
   separate nearby Gaussian hypotheses.
6. If a region is wrong, record the visible Alva status plus the Deep live panel
   and note whether the error decreases after revisiting it. A persistent error
   after 3+ distinct viewpoints is more useful diagnostically than a one-frame
   monocular error.

Expected qualitative result: the Gaussian cloud should improve with redundant
views instead of reproducing each depth map as a permanent camera-facing sheet.
