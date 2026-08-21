# V30.34 patch notes

- Replaced homography/projective photo placement with calibrated-ray spherical rotation registration.
- Added rigid equirectangular inverse warping; no planar/local mesh deformation is used to force RGB alignment.
- Added multi-scale photographic features and scale-aware oriented BRIEF/ZNCC matching.
- Expanded live relocalisation across temporal neighbours, visible-component frames, appearance-ranked loops and a bounded emergency search.
- Added post-scan component bridge recovery using only verified spherical RGB geometry.
- Kept exact-frame RGB+Depth admission: no depth evidence means no photo node.
- Reworked raw Depth Anything fusion into one joint global affine consensus across all overlap edges.
- Added dense spherical-overlap depth samples and one global colour range for the entire Depth atlas.
- Preserved Alva poses only as optional metadata for later metric/3-D processing.
- 3-D reconstruction is unchanged.
