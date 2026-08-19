export const BUILD={
  version:'30.7.0',
  id:'v30.7.0-20260819-xr-metric-camera-slam-gs',
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

  // Metric bootstrap. WebXR is used ONLY during this guided calibration stage.
  // Once calibration finishes the immersive session is ended and all mapping
  // continues from getUserMedia camera frames only.
  xrCalibrationMinAnchors:10,
  xrCalibrationTargetAnchors:12,
  xrCalibrationStableFrames:5,
  xrCalibrationHitStdM:0.025,
  xrCalibrationMinSpanM:0.65,
  xrCalibrationMinVerticalSpanM:0.18,
  xrCalibrationPatchFraction:0.08,
  xrCalibrationPatchSize:16,
  calibrationStorageKey:'room-scanner-v30-xr-calibration-v1',

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

  // V30.7 intentionally has no Depth Anything / DeepAI runtime path and no IMU
  // dependency. This keeps the metric contract easy to diagnose: WebXR seeds
  // scale once, visual SLAM + MVS maintain and densify it afterwards.
  serviceWorker:'sw.js',
  buildInfo:'build_info.json'
};
