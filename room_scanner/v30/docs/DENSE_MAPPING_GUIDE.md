# Dense scanning guide

The reconstruction needs camera translation, not only rotation.

- Move laterally by roughly 5–20 cm while keeping 60–80% of the previous view.
- Move slowly enough that `ALVA TRACKING` remains stable.
- For each wall/object, observe it from at least three nearby viewpoints.
- Return to already scanned areas periodically to exercise Alva relocalisation.
- `DEPTH` grows when a usable multi-view depth map is accepted.
- `surf` grows only after the same surface has independent support.
- The TSDF mesh appears after several accepted depth maps and is updated in the
  same world coordinate frame as Alva.
- Uniform white walls may stay intentionally empty rather than receiving fake
  geometry. That is the case targeted by the optional future Depth Anything
  prior described in `CHANGES_V30_15_0.md`.
