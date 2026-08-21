# V30.33 phone validation · continuous RGB+Depth mosaic

1. Publish the patch while preserving the existing `models/` directory and reset the V30 shell cache once. Confirm `V30.33.0`.
2. Open **Mappa → FOTO**. The panel must show only normal continuous photographs: no feature dots, no graph lines and no camera markers.
3. Move slowly while keeping roughly 40–60% visual overlap. A new photo should appear only after its Deep inference completes.
4. Temporarily make an overlap poor by turning quickly. That frame may be captured for Deep, but if it cannot be registered reliably it must not appear at a random location in the visible mosaic.
5. Cover/disable the Depth model as a negative test: the live RGB+Depth mosaic must stop accepting new photographs rather than accumulating RGB-only frames.
6. During Alva INIT/LOST, RGB+Depth frames may still be accepted and aligned if Deep and photographic overlap are valid. Their placement must not jump when Alva later recovers.
7. Switch to **DEPTH** and verify that depth support follows exactly the same accepted photo regions.
