# V30.30 phone validation · live PHOTO / GLOBAL DEPTH

1. Apply this patch over V30.29.0. No model directory needs to be replaced.
2. Reload and verify `V30.30.0` / interactive boot.
3. Start a scan only after Alva has a valid pose. The live panel must start in `FOTO` mode.
4. Move slowly with translation, not only rotation. Roughly once per Deep inference a new photo node should appear. The status should report `N/N foto` and the number of graph links.
5. Check that a photo is created at Deep request time, not completion time. In Debug, Deep results should still report exact-frame sync while Alva continues processing newer frames.
6. In `FOTO`, overlapping textured parts of the room should remain sharp. Small seams are acceptable; a uniformly averaged/blurred panorama is not. The atlas origin is fixed, so already pasted content should not slide merely because a new camera pose was added.
7. A new view with no metric Deep yet may appear faintly. Once the raw Deep returns and RGB+Alva provide enough scale anchors, the same area should become stronger without jumping to a later camera frame.
8. Tap `DEPTH`. Initially it may be sparse. It must not invent depth for unaligned photos. As the photo graph obtains baseline and matches, more Deep frames should become global/aligned and the status should show `Deep nF -> metriche mF` plus a scale error when observable.
9. Toggle `FOTO <-> DEPTH` repeatedly while moving. The same connected regions should occupy the same atlas directions. RGB discontinuity without a corresponding graph break is a bug; a red/disconnected node is instead an explicit request to revisit.
10. Deliberately move to a weak/no-texture area. If that photo does not connect, return slightly to the previous textured view and sweep through it again. The graph should reconnect rather than silently forcing a false edge.
11. Deliberately return to an early view. A non-temporal photo edge/loop should appear when visual evidence is sufficient.
12. Compare local `DEEP LIVE` with `GLOBAL DEPTH`: the local panel is raw relative depth for one exact frame; the global panel is the pose-transformed common-scale result. They are not expected to use the same colour scale.
13. Finish the scan and open `Photo Puzzle -> piani + particelle`. The persistent factor graph should contain the ~1 Hz posed survey photos and their raw Deep maps, not only the old dense keyframes.
14. If the final 3D is still poor, export diagnostics only after inspecting these two live products. A bad PHOTO atlas points first to pose/matching; a good PHOTO atlas with bad GLOBAL DEPTH points to Deep scale/calibration; two good atlases with bad 3D isolate the remaining fault to surface reconstruction.
