# Room Scanner V30.34 · Spherical RGB panorama + global Depth consensus

V30.34 changes the live photographic map from a planar/projective stitch into a rigid spherical panorama. Only exact survey RGB frames that own a valid Depth Anything map from that same capture are admitted to the photo graph.

Photographic placement is independent from AlvaAR. Multi-scale photo corners and oriented BRIEF/ZNCC descriptors propose RGB correspondences; those pixel pairs are converted through the camera intrinsics into calibrated rays. Registration estimates only a 3-DoF relative camera rotation, and all accepted rotations are averaged over the photo graph. The renderer inverse-warps each complete RGB image onto a common sphere. No homography, affine transform or local projective mesh can stretch a photograph to force a fit.

The live graph is more tolerant to temporary reference loss: each new depth-valid frame is compared with several recent frames, recent members of the visible component and visually similar older frames. If that fails, a bounded wider relocalisation is attempted. Later good frames also retry recent disconnected photographs. A frame that still has no real spherical RGB overlap remains unplaced.

Depth fusion uses the same accepted spherical overlaps. All raw monocular maps participate in one global robust affine system, `a_i D_i + b_i = a_j D_j + b_j`, with a fixed gauge. Dense samples from the common spherical regions complement feature correspondences. The depth preview then uses one global robust range for every aligned map, so colours have the same meaning across the complete atlas.

Alva pose/covariance can still be stored as optional metadata for the unchanged metric/3-D path, but it is not read by photographic registration or the panorama renderer. The later 3-D reconstruction is unchanged.
