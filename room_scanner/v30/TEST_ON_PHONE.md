# V30.29 phone validation

1. Apply this patch over V30.28.0. No model directory needs to be replaced.
2. Reload normally and verify that the atomic boot reaches `Interfaccia pronta`.
3. Start a scan and watch the spherical coverage panel. Walk slowly with deliberate overlap; do not only rotate in place.
4. When the guide reports a weak/disconnected view, move slightly back toward the previous view and sweep that region again. The connection/closure indicators should recover.
5. Before finishing, deliberately return to an early part of the room. At least one photo loop closure should appear. Finishing early should produce a warning rather than silently accepting incomplete coverage.
6. Confirm that Deep live preview remains visually sensible. Deep does not need to be metrically perfect at this stage; its scale is solved post-scan from the photo/pose graph.
7. In Review, choose `Photo Puzzle -> piani + particelle`. Start with 2,000–3,000 particles and 20–40 iterations.
8. Watch the spherical photo atlas. It is a connectivity/coverage diagnostic, not a metric panorama: near objects may show parallax/ghosting and this is expected.
9. Watch the status values: connected photo fraction, aligned Deep frames, number of planes, plane-explained fraction, validation loss and shoebox confidence.
10. Validation loss must be non-increasing across accepted particle updates. A rejected update may leave it unchanged.
11. Compare BASE and PUZZLE. Large walls/floor/ceiling should increasingly appear as clean plane patches; particles should concentrate on furniture, corners and non-planar residual geometry.
12. Repeat with 1,000 and 10,000 particles. Large planar room surfaces should not require more particles to remain stable; the higher budget should mainly improve residual object detail.
13. Save the session, reload it from Home and continue to a higher cumulative iteration target. The Photo Puzzle state must resume without overwriting BASE.
14. Export diagnostics if a view stays disconnected or if a plane is visibly wrong; the useful fields are photo graph edges/loops, depth alignment error, aligned frames, validation loss and plane statistics.
