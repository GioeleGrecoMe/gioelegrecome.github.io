export const BUILD={
  version:'30.8.0',
  id:'v30.8.0-20260819-user-selected-multiview-xr-landmarks',
  dbName:'room-scanner-v30',
  dbVersion:2
};

export const CONFIG={
  analysisWidth:320,
  analysisHeight:480,
  analysisFps:12,
  cameraFovDeg:62,
  keyframeIntervalMs:950,
  maxKeyframes:520,

  /*
   * V30.8 metric bootstrap.
   *
   * WebXR is still used ONLY during calibration. The important difference is
   * that references are no longer generic automatic rays: the camera proposes
   * visually distinctive regions and the user explicitly pins the physical
   * details that should survive the WebXR -> getUserMedia transition.
   */
  xrCalibrationMinTargets:3,
  xrCalibrationMaxTargets:5,
  xrCalibrationMinPointsPerTarget:3,
  xrCalibrationMinCommonPoints:10,
  xrCalibrationStableFrames:5,
  xrCalibrationHitStdM:0.025,
  xrCalibrationMinSpanM:0.45,
  xrCalibrationMinVerticalSpanM:0.08,
  xrCalibrationPatchFraction:0.065,
  xrCalibrationPatchSize:16,
  xrCalibrationMinPatchVariance:42,
  xrCalibrationMinPatchDetail:7.0,
  xrCalibrationClusterOffsetUv:0.024,
  xrCalibrationMinViewsPerTarget:3,
  xrCalibrationMaxViewsPerTarget:7,
  xrCalibrationViewStepM:0.075,
  xrCalibrationViewStepAngleRad:0.07,
  xrCalibrationMinTargetBaselineM:0.14,
  xrCalibrationMaxTemplatesPerPoint:6,
  xrCalibrationTrackingZncc:0.28,

  // Lightweight Raw Camera candidate detector. It performs only small patch
  // readbacks; no semantic AI model is loaded during calibration.
  xrCandidateRefreshMs:700,
  xrCandidatePatchFraction:0.045,
  xrCandidatePatchSize:12,
  xrCandidateMinVariance:55,
  xrCandidateMinDetail:8.0,
  xrCandidateMaxVisible:8,
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

  // No Depth Anything / DeepAI and no IMU are required by the V30.8 runtime.
  serviceWorker:'sw.js',
  buildInfo:'build_info.json'
};
