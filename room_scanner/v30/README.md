# Room Scanner V30.32 · Pure photographic mosaic

This patch makes the photograph sequence the sole authority for the live panorama/mosaic.

The first accepted photograph defines only an arbitrary 2-D origin. Every subsequent placement comes from photographic correspondences. No Alva translation, rotation, epipolar prediction or tracking-valid flag participates in photographic registration. Disconnected photographs remain pending rather than being placed from a tracker guess.

Pipeline: photo capture → independent photo feature detection → BRIEF/ZNCC matching → homography RANSAC → global 2-D mosaic/loop refinement → local parallax warp → sharp best-source compositing. Deep Anything is aligned afterwards using the same RGB overlap graph. Alva pose/covariance is optional metadata for later metric reconstruction.

The 3-D reconstruction path is unchanged in this patch.
