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
- Uniform white walls may still stay empty when neither Alva anchors nor
  cross-view evidence are sufficient. V30.17 uses Depth Anything only after
  anchor calibration; it does not force-fill unsupported regions.


## V30.17 sparse AI rule

Depth Anything now runs only on keyframes that already have enough triangulated
Alva depth anchors and that add new spatial/view context. The HUD shows `AI→ALVA`
after successful calibration and `DEPTH AI+ALVA` after multi-view refinement.
Repeated nearby views are expected to be skipped; this is intentional and keeps
neural calls low. If you see many `deep-depth-request` entries without moving
roughly 20 cm or changing view direction, export diagnostics because the novelty
gate is not behaving as intended.

For metric output, complete the one-shot metric bootstrap first. Without it, AI
depth is still aligned coherently to Alva world units, but those units are not
claimed to be metres.
