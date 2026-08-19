# V30.7 Phone Test

1. Load `/room_scanner/v30/room_scanner_v30.html` online.
2. Normal refresh twice: build badge must remain current; it must not require clearing site data.
3. Open Diagnostics and run self-test. Save log if anything fails.
4. Calibrate WebXR while looking at a textured floor/wall corner. Verify anchor/span/vertical counters rise.
5. Confirm; XR must close.
6. Start scan and repoint the calibration view. Verify template count, PnP inliers and RMSE appear; scan must not begin until metric bridge passes.
7. During scan verify FEATURE, MATCH, LM, KF, GS and TRI increase.
8. Walk sideways/vertically to create baseline. TRI and GS should increase more strongly than with pure rotation.
9. Create a markpoint on a previously mapped detail.
10. Finish, orbit/pan the Gaussian model, export PLY and diagnostics.
11. Reopen the exported PLY to verify persistence independent of IndexedDB.

Hardware-only items not reproducible in container: ARCore WebXR hit-test quality, Raw Camera Access texture readback, permissions, thermal throttling and device camera intrinsics.
