# Physical phone test plan - Room Scanner V15.1.0

Use Chrome Android on an ARCore-compatible phone over HTTPS. Before the first V15.1.0 test, clear the old site data once so no previous service worker controls the page.

## 1. Build and cache identity

1. Open the deployed root URL.
2. Verify the badge reads `V15.1.0 · WALL TARGETS + RECOVERY`.
3. Reload once online, then enable airplane mode and reload.
4. Confirm the landing page still opens offline.

Pass: no V15.0.x page or old yaw-sector UI appears.

## 2. Single-room metric shell

1. Start WebXR.
2. Walk to each floor/wall corner and add it in order.
3. Close the footprint and confirm height.
4. Compare the displayed wall lengths/area with tape measurements.

Record: phone model, Chrome version, ARCore version, measured dimensions, scanner dimensions and maximum error.

## 3. Physical target overlay

1. Enter coverage after height confirmation.
2. Verify colored quadrilaterals appear attached to wall surfaces, not as a compass circle.
3. Rotate and translate the phone.
4. Confirm the boxes remain on the same physical wall regions while the camera moves.
5. Follow the large arrow to the selected red box.
6. Hold still until a photograph is captured.

Pass: the selected physical area is visually unambiguous and one photograph may update several visible boxes.

## 4. Red/yellow/green semantics

1. Photograph an upper wall box once.
2. Confirm it becomes green.
3. Photograph a lower/object box once.
4. Confirm it becomes yellow and shows a one-of-two indication.
5. Without moving, keep aiming at it.
6. Confirm duplicate shots from the same position do not falsely complete it.
7. Move laterally about 0.5 m and photograph it again.
8. Confirm it becomes green.

Pass: lower areas request spatial diversity instead of repeated identical photos.

## 5. Completion without deadlock

1. Acquire at least three photos from at least two positions.
2. Deliberately leave one difficult or occluded tile red/yellow.
3. Press `Completa vano`.

Pass: the room completes. Review records the number of unresolved tiles instead of blocking forever.

## 6. Complete during an active capture

1. Wait for an automatic capture to begin.
2. Immediately press `Completa vano`.
3. Confirm the label changes to `Salvo e completo...`.
4. Confirm WebXR remains active and the room changes phase only after capture settlement.

Pass: no crash, duplicate action or accidental entire-scan termination.

## 7. Browser Back recovery

1. Scan a footprint, confirm height and acquire at least one photo.
2. Press the Android/browser Back control while WebXR is active.
3. Observe the application without reopening the URL.

Pass:

- WebXR ends once;
- the page does not crash or go blank;
- Review opens automatically;
- the partial room and acquired frames are visible;
- `Ripristina ultima scansione` appears after reloading the page.

Repeat while an automatic photo is being captured. Pass if the capture settles or is safely cancelled and Review still opens.

## 8. Save and close

1. Repeat a partial or complete scan.
2. Press `Salva e chiudi`.

Pass: behavior matches browser Back recovery and the latest checkpoint can be restored after a reload/browser restart.

## 9. Two connected rooms

1. Complete room one.
2. Press `Attraversa passaggio`.
3. Walk through the doorway and press `Sono nel nuovo vano`.
4. Acquire room two without ending WebXR.
5. Save and open the plan.

Pass: both rooms share one metric frame and the doorway connects the correct wall sides without independent rotation or ICP.

## 10. Objects

1. Place a chair/table near a wall.
2. Photograph the lower wall/object tiles from two positions.
3. End XR and run the balanced Deep batch.
4. Inspect the plan and 3D scene.
5. Rename/resize one detected object, hide it, restore it, remove it, restore it again.
6. Add one manual object with two taps.
7. Reload and restore the checkpoint.

Pass: edits persist and removed objects stay excluded from active preview/export until restored.

## 11. Memory and thermal test

1. Scan two or three rooms with the balanced profile.
2. End XR and run Deep.
3. Monitor browser termination, phone temperature and processing duration.
4. Repeat with `Rapido` if balanced is unstable.

Pass: the app remains usable even if Deep fails; room geometry, photos and manual editing remain available.

## Required report

For every failure capture:

- exact step;
- phone/OS/Chrome/ARCore versions;
- screenshot or screen recording;
- diagnostics text;
- whether the page, XR session or entire browser process closed;
- exported RAW checkpoint when possible.
