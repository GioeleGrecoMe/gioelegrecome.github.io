# V30.33 incremental patch notes

- Removed graph/feature overlays from the live measurement photo preview.
- Replaced forward RGB splatting/adaptive stride with dense inverse image warping.
- Removed dense/SLAM keyframes from the user-visible photo stream.
- Replaced the independent photo clock with an exact RGB+Deep acquisition clock.
- Added atomic `commitCameraFrameWithRelativeDepth`: no valid depth means no photo node.
- Deep errors, sync mismatches and invalid depth maps leave no orphan RGB frame in the mosaic.
- Added conservative homography checks so localized/repeated-texture matches are rejected rather than placed arbitrarily.
- The visible solution stays anchored to the first accepted photographic component; disconnected frames remain unplaced.
- AlvaAR remains optional metadata and is excluded from all 2-D photo alignment.
- Existing 3-D reconstruction is unchanged.
