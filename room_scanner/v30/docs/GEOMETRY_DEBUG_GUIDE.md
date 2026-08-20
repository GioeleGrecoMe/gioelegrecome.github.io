# V30.16 geometry debug guide

During Scan use the overlays in this order:

1. **Green Alva points** — they only show that Alva sees stable image features.
2. **Cyan geometry anchors** — these are triangulated 3D points that passed reprojection checks. They must stay on the same physical corners/edges as the phone moves.
3. **Surface splats** — derived from dense depth and multi-view fusion.
4. **Mesh wireframe** — derived from the TSDF.

Interpretation:

- Green stable, no cyan: not enough parallax or descriptor correspondence. Move laterally while keeping the same objects in view.
- Cyan stable, surface/mesh wrong: pose geometry is coherent; investigate dense photometric filtering/fusion.
- Cyan itself slides away from physical edges: investigate camera intrinsics/crop or Alva matrix convention before tuning TSDF.
- `GEOM: attendo più feature Alva/parallasse`: intentional safety gate. No fake geometry is inserted.

For the first validation use a textured cabinet/door/bookshelf and move 10–30 cm laterally, keeping high overlap. Avoid pure rotation.
