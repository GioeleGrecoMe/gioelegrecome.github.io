/*
 * Room Scanner V30.10.2 runtime configuration.
 *
 * Debugging note:
 * - V30.8 used dbVersion=2 even on devices that already contained schema v3,
 *   which caused IndexedDB VersionError during bootstrap/self-test.
 * - V30.10 keeps the desired schema at v3, but db.js is version-safe and never
 *   requests a downgrade if a newer schema is already installed.
 * - WebXR calibration now requires the Anchors feature. There is deliberately
 *   no screen-space/static-coordinate fallback for calibration pins.
 */
export const BUILD={
  version:'30.10.2',
  id:'v30.10.2-20260819-interactive-boot-fix',
  dbName:'room-scanner-v30',
  dbVersion:3
};

export const CONFIG={
  analysisWidth:320,
  analysisHeight:480,
  analysisFps:12,
  cameraFovDeg:62,
  keyframeIntervalMs:950,
  maxKeyframes:520,

  /*
   * V30.10 metric bootstrap.
   *
   * A visual calibration pin is valid only after an XRHitTestResult has created
   * a real XRAnchor and that anchor is present in XRFrame.trackedAnchors.
   * The pin position is read again from anchor.anchorSpace on every XR frame.
   */
  xrCalibrationMinTargets:3,
  xrCalibrationMaxTargets:7,
  xrCalibrationMinPointsPerTarget:3,
  xrCalibrationMinCommonPoints:9,
  xrCalibrationStableFrames:5,
  xrCalibrationHitStdM:0.025,
  xrCalibrationMinSpanM:0.45,
  xrCalibrationMinVerticalSpanM:0.08,
  xrCalibrationPatchFraction:0.065,
  xrCalibrationPatchSize:16,
  xrCalibrationMinPatchVariance:42,
  xrCalibrationMinPatchDetail:7.0,
  xrCalibrationClusterOffsetUv:0.024,
  xrCalibrationClusterGrid:true,
  xrManualAimStableFrames:6,
  xrManualAimHitStdM:0.018,
  xrManualAimRefreshMs:90,
  xrRoiScales:[0.055,0.11,0.20],
  xrRoiPatchSize:24,
  xrRoiMaxViewsPerTarget:24,
  xrRoiMinViewsPerTarget:8,
  xrRoiMinAzimuthSectors:4,
  xrRoiAzimuthSectors:8,
  xrRoiElevationBands:3,
  xrRoiCaptureStepM:0.055,
  xrRoiCaptureStepAngleRad:0.055,
  xrCalibrationMinViewsPerTarget:3,
  xrCalibrationMaxViewsPerTarget:16,
  xrCalibrationViewStepM:0.075,
  xrCalibrationViewStepAngleRad:0.07,
  xrCalibrationMinTargetBaselineM:0.14,
  xrCalibrationMaxTemplatesPerPoint:12,
  xrCalibrationTrackingZncc:0.28,

  // Global coverage contract requested for calibration quality: at least three
  // distinct camera poses, each with at least three real anchored pins visible.
  xrCalibrationMinGlobalPoses:3,
  xrCalibrationMinPinsPerPose:3,
  xrCalibrationGlobalPoseStepM:0.075,
  xrCalibrationGlobalPoseStepAngleRad:0.07,

  // Strict world-lock mode. If the browser cannot provide WebXR Anchors, the
  // calibration is rejected instead of silently reverting to 2D/fake pins.
  xrRequireRealAnchors:true,
  xrRequestPersistentHandles:true,

  // Lightweight Raw Camera candidate detector. It performs only small patch
  // readbacks; no semantic AI model is loaded during calibration.
  xrCandidateRefreshMs:700,
  xrCandidatePatchFraction:0.045,
  xrCandidatePatchSize:12,
  xrCandidateMinVariance:55,
  xrCandidateMinDetail:8.0,
  xrCandidateMaxVisible:8,

  // Keep the V30.8 storage key so an existing visual calibration remains
  // inspectable/bridge-compatible. New results carry realAnchor=true and
  // persistentHandle metadata for forward migration/verification.
  calibrationStorageKey:'room-scanner-v30-xr-calibration-v2',

  // Camera-only multi-view densification. No monocular AI depth is involved.
  mvsWorker:'workers/mvs_worker.js',
  mvsEveryNthKeyframe:1,
  mvsMinBaselineM:0.10,
  mvsMaxBaselineM:1.25,
  mvsMaxAngleRad:0.55,
  mvsNearM:0.30,
  mvsFarM:9.0,
  mvsDepthSteps:36,
  mvsGridStep:7,
  mvsMaxPoints:5200,

  gaussianVoxelM:0.025,
  gaussianMaxLive:240000,
  gaussianSnapshot:90000,
  gaussianWorker:'workers/gaussian_worker.js',
  wasmCore:'wasm/slam_core.wasm',
  // No Depth Anything / DeepAI and no IMU are required by the V30.10.2 runtime.
  serviceWorker:'sw.js',
  buildInfo:'build_info.json'
};
