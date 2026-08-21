# Room Scanner V30.33 · Continuous RGB+Depth mosaic

The measurement preview is now intentionally simple: it is a dense RGB mosaic made only from photographs that own a Depth Anything map from the exact same camera frame.

A survey frame is frozen only when the Deep worker can accept it. The RGB image is kept pending while inference runs and is committed to the live mosaic only after frame ID, capture time, raster signature and depth validity all pass. Failed/invalid Deep frames never become photo nodes.

Photographic placement is still completely independent from AlvaAR: photo features → BRIEF/ZNCC → homography RANSAC → global 2-D mosaic. Alva pose/covariance may be stored as optional metadata but has no authority over the RGB alignment.

The live RGB renderer is a standard inverse image warp, not a point/splat renderer. Graph nodes, feature points and edges are never drawn over the measurement photo preview. A photograph with no reliable RGB overlap remains disconnected and invisible instead of being placed from a tracker guess.

The later 3-D reconstruction path is unchanged.
