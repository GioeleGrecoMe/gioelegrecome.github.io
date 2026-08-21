# Room Scanner V30.33 architecture

## 1. Atomic RGB+Depth survey frame

The live photo graph accepts only one semantic object: an exact camera RGB frame with a valid Depth Anything raster bound to that same frame. Capture creates a pending immutable RGB packet; no graph node exists yet. After Deep returns, the exact-frame synchronization contract validates job ID, frame ID, timestamp, raster size and raster fingerprint. Only then is `RGB + raw depth` committed atomically.

If inference fails, synchronization fails or the depth map has too few valid samples, the frame is discarded from the live mosaic.

## 2. Pure photographic alignment

Depth is an admission invariant, not a placement cue. AlvaAR is optional metadata only. Pairwise placement uses image features detected from the frozen photo, BRIEF/ZNCC matching and homography RANSAC. Weak, spatially concentrated or geometrically implausible homographies are rejected.

A disconnected photo is not assigned a guessed position. The visible mosaic remains anchored to the component containing the first accepted RGB+Depth frame.

## 3. Continuous photo preview

The measurement RGB preview uses inverse warping: each destination canvas pixel is mapped through the inverse photographic homography into the source RGB raster and bilinearly sampled. There are no feature points, graph edges, camera centres or adaptive splat strides in this view.

## 4. Depth view

The Depth view uses the same photographic graph. Raw Deep maps can still be statistically aligned over RGB overlaps and, where Alva metric evidence exists, calibrated later. A suspicious Deep map may be retained at low confidence, but it is still tied one-to-one to its RGB frame.

## 5. Alva/3-D

AlvaAR and the existing metric/3-D reconstruction remain separate. If an accepted RGB+Depth survey frame happens to have an Alva pose, that pose can be persisted for later optimization. It never changes the 2-D mosaic.
