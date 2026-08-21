# V30.34 phone validation · spherical panorama + global Depth

1. Publish this patch while preserving the existing `models/` directory. Reset the shell cache once and confirm `V30.34.0`.
2. Open **Mappa → FOTO** and scan slowly with overlap. Each new accepted image must remain a normal undistorted photograph projected on the spherical atlas; straight local content may curve because of the sphere, but the photo itself must never shear, stretch or explode.
3. Deliberately make one intermediate frame weak (brief blur/low texture), then return to a previously seen textured area. The mapper should relocalise against older connected RGB+Depth frames rather than permanently breaking the chain.
4. Turn farther than usual and then come back. A frame with no verified spherical overlap must remain absent instead of being placed arbitrarily. When later overlap becomes sufficient, recent orphan frames may reconnect.
5. During Alva INIT/LOST, continue the same RGB test. Accepted RGB+Depth photographs must keep the same panoramic placement; Alva recovery must not move them.
6. Switch to **DEPTH**. In overlapping regions, colours from different photographs should agree after fusion. When a new frame/loop is accepted, all maps must be recoloured from the single global scale rather than retaining per-frame colour ranges.
7. Revisit the first area to create a loop. Check both FOTO and DEPTH: the spherical registration should tighten globally and the depth scale should remain continuous through the closure.
8. As a negative test, make Deep inference fail. The corresponding RGB frame must not enter the photo graph at all.
