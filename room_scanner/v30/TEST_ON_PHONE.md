# V30.32 phone validation · pure photo mosaic

1. Publish the patch while preserving your existing `models/` directory and reset the shell cache once. Confirm `V30.32.0`.
2. Open **Mappa → FOTO** and begin scanning slowly with at least 40–60% visual overlap between neighbouring views.
3. During an Alva `INIT` or temporary `LOST` interval, verify that the RGB photo count continues increasing. Those photographs must still appear in the mosaic.
4. Return to a previously photographed area. The RGB graph should create a loop and the mosaic should redistribute its alignment instead of snapping to the current Alva pose.
5. Intentionally translate the phone sideways around nearby furniture. Check that the local-warp counter grows and that overlapping edges remain sharper than with a single global homography.
6. Switch to **DEPTH**. It must occupy the same photo-derived mosaic regions. Deep may be incomplete while inference is pending, but it must not reposition RGB.
7. If a photo cannot be matched reliably, it should remain outside the main component until a later photograph provides a real RGB connection; it must never be inserted because Alva says where it belongs.
