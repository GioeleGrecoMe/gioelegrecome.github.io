# V30.27 EXP-2 phone check - exact Alva/Deep frame synchronization

1. Apply this patch over **V30.27 EXP-1** and hard-refresh/reset the site cache.
2. Start Scan and keep the phone moving slowly. The Deep overlay should show
   `SYNC ✓` after every accepted live inference. The displayed `lag` is only
   inference latency: it must not change which Alva pose/features own that depth.
3. In diagnostics look for `deep-frame-sync-ok`. Its `frameId` belongs to the
   same captured raster used to create the Alva keyframe and sparse anchors.
4. There must be no `deep-frame-sync-rejected` during a normal scan. If one
   appears, that Deep result is intentionally NOT fused; the UI reports that
   multi-view geometry is used instead. Save the diagnostic log in that case.
5. Move more quickly for a few seconds while Deep is busy. This is the stress
   case: even if Alva processes several newer frames before Deep returns, the
   old Deep result must remain attached to its original `frameId`.
6. Finish the scan and compare BASE/EXP exactly as in EXP-1. The Surface Mesh Lab
   is unchanged by this patch and can still be discarded independently.

Useful fields in the log:
`frameId`, `frameAt`, `frameSignature`, `refId`, `featureCount`, `anchors`,
`completionLagMs`, and `deepSyncRejected`.
