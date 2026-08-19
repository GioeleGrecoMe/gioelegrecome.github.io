import {
  WebXRCalibrationManager,
  XRAnchorScenePinRenderer,
  CalibrationVerificationOverlay,
  openIndexedDBVersionSafe,
} from "../src/index.js";

/**
 * Host integration reference for the two user-reported regressions.
 * Replace the placeholder callbacks with the host application's existing scene,
 * mesh factory and IndexedDB migrations; no network dependency is introduced.
 */
export async function installCalibrationRuntime({
  session,
  referenceSpace,
  scene,
  createCalibrationPinMesh,
  solveCalibration,
  validateCalibration,
  databaseName,
  databaseTargetVersion = 2,
  upgradeDatabase,
}) {
  // Never request an IndexedDB version lower than an already-installed build.
  const database = await openIndexedDBVersionSafe({
    name: databaseName,
    targetVersion: databaseTargetVersion,
    onUpgrade: upgradeDatabase,
  });

  const calibration = new WebXRCalibrationManager({
    solveCalibration,
    validateCalibration,
    requireTrackedAnchors: true,
  });

  // THIS is the visible calibration pin. It lives in the 3D scene and receives
  // the XRAnchor pose matrix every frame. It is not a DOM marker.
  const scenePins = new XRAnchorScenePinRenderer(calibration, {
    scene,
    createObject: ({ pinId }) => createCalibrationPinMesh(pinId),
  });

  // Optional debug projection. This helps compare the 3D pin with the camera
  // image, but it must never be used as the canonical scene pin.
  const debugOverlay = new CalibrationVerificationOverlay(document.body);
  debugOverlay.bind(calibration);

  // On-device diagnostic: if this fires, disable capture/solve in the host UI.
  calibration.addEventListener("worldlockwarning", (event) => {
    console.error("[calibration/world-lock]", event.detail);
  });

  const onXRFrame = (_time, frame) => {
    session.requestAnimationFrame(onXRFrame);
    const viewerPose = frame.getViewerPose(referenceSpace);
    if (!viewerPose) return;

    // IMPORTANT: exactly one authoritative update per XR animation frame.
    // XRAnchorScenePinRenderer listens synchronously to this update and applies
    // the live anchor matrix before the callback returns.
    calibration.updateFrame({ frame, referenceSpace, viewerPose });
  };
  session.requestAnimationFrame(onXRFrame);

  return {
    database,
    calibration,
    scenePins,
    debugOverlay,
    dispose() {
      scenePins.dispose();
      debugOverlay.destroy();
      database.db?.close?.();
    },
  };
}

/**
 * Place a calibration pin only from the current hit-test result. Do not create a
 * visible pin from tap coordinates, reticle CSS position, or a cached matrix.
 */
export async function placeCalibrationAnchor({ calibration, hitResult, label }) {
  if (!hitResult?.createAnchor) {
    throw new Error("Real WebXR anchor placement is unavailable; calibration pin was not created.");
  }
  return calibration.addPinFromHitTest({ hitResult, label });
}
