# V30.31 phone validation · photo-first panorama

1. Restore the normal `models/` directory on the deployed site, upload the incremental patch preserving paths, then use **Reset cache** once. Confirm the build badge reports `V30.31.0`.
2. Start a scan and keep the diagnostics panel closed initially. Verify that the camera occupies almost the whole screen and the bottom controls remain reachable in portrait and landscape.
3. Open **Mappa** and select **FOTO**. Rotate first from nearly one position, then walk slowly sideways by 0.5–1 m while keeping 40–60% visual overlap. The panorama should grow continuously without the old global blur. The status should show RGB registered frames, visual links, local-warp points/residual and `ΔAlva` when visual and Alva rotations disagree.
4. Deliberately revisit an already seen direction. A non-temporal loop should be added without requiring Alva to put the two photos in the same pose first.
5. Select **DEPTH**. After several Deep frames, overlapping regions should progressively share one coherent relative colour scale. A single anomalous Deep frame should not recolour the entire map; its contribution should lose confidence.
6. Move through a scene with near and far objects. PHOTO may still show local seam changes (this is not a full 3D renderer), but local parallax correction should keep matched structures substantially closer than a pure rotation-only panorama.
7. Finish the scan, export `.r30`, reload the session and confirm review still opens. The 3D reconstruction output is expected to be the same algorithm as before; this release is validating acquisition evidence, not changing the mesh solver.
8. If a visual match is wrong, export diagnostics. Useful fields are visual RANSAC residual, local-warp residual, Deep overlap error and visual-vs-Alva disagreement.
