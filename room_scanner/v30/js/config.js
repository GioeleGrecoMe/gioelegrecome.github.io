/*
 * Room Scanner V30.27.0 EXP-3 exact-frame synchronized robust surface-field runtime configuration.
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
  version:'30.27.0-exp.3',
  id:'v30.27.0-exp.3-20260821-surface-field',
  dbName:'room-scanner-v30',
  dbVersion:3
};

export const CONFIG={
  // Mobile budget: Alva stays responsive while neural depth runs separately.
  // AlvaAR initialization needs more image support than the 256x384 low-power
  // profile provided on the test phone. 320x480 is still modest, but gives the
  // monocular initializer 56% more pixels while the expensive neural depth stays
  // in its own worker at a much smaller raster.
  analysisWidth:320,
  analysisHeight:480,
  analysisFps:8,
  cameraFovDeg:62,
  keyframeIntervalMs:900,
  // Independent tracking heartbeat: keep one compact camera observation per second even
  // before Alva has produced its first pose. Dense geometry still requires a valid pose.
  alvaObservationIntervalMs:900,
  alvaHeartbeatBufferFrames:8,
  alvaHeartbeatPersistMaxSide:160,
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
  xrCalibrationMinPointsPerTarget:1,
  xrCalibrationMinCommonPoints:3,
  xrCalibrationStableFrames:5,
  xrCalibrationHitStdM:0.025,
  // Apply must be reachable after three well-spaced pins.  The old V30.11
  // gate (0.45 m span + vertical span + 8 ROI + 4 sectors + 3 global poses)
  // was unnecessarily strict and could keep the button disabled forever.
  xrCalibrationMinSpanM:0.20,
  xrCalibrationMinTriangleAreaM2:0.0025,
  xrCalibrationMinScreenTriangleArea:0.0015,
  xrCalibrationPatchFraction:0.065,
  xrCalibrationPatchSize:16,
  xrCalibrationMinPatchVariance:42,
  xrCalibrationMinPatchDetail:7.0,
  xrCalibrationClusterOffsetUv:0.024,
  xrCalibrationClusterGrid:false,
  xrManualAimStableFrames:6,
  xrManualAimHitStdM:0.018,
  xrManualAimRefreshMs:90,
  xrRoiScales:[0.055,0.11,0.20],
  xrRoiPatchSize:24,
  xrRoiMaxViewsPerTarget:24,
  // Four genuinely separated ROI observations are enough to *apply*.  Capture
  // continues in the background up to xrRoiMaxViewsPerTarget, so more views
  // still improve later re-localisation without blocking the user.
  xrRoiMinViewsPerTarget:4,
  xrRoiMinAzimuthSectors:2,
  xrRoiAzimuthSectors:8,
  xrRoiElevationBands:3,
  xrRoiCaptureStepM:0.055,
  xrRoiCaptureStepAngleRad:0.055,
  xrCalibrationMinViewsPerTarget:3,
  xrCalibrationMaxViewsPerTarget:16,
  xrCalibrationViewStepM:0.075,
  xrCalibrationViewStepAngleRad:0.07,
  xrCalibrationMinTargetBaselineM:0.08,
  xrCalibrationMaxTemplatesPerPoint:12,
  xrCalibrationTrackingZncc:0.28,

  // Global multi-pin poses are still collected as a diagnostic/quality bonus,
  // but no longer gate Apply. Per-pin useful multi-view evidence + a common
  // frame with >=3 useful pins is sufficient.
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



  // Dense mapping: AlvaAR owns poses; a low-frequency multi-view
  // plane-sweep worker estimates depth from a tiny local keyframe graph. Dense
  // depth is fused into surfels + a sparse TSDF. The live splats are derived
  // only from confirmed surfels; the mesh is extracted from the TSDF.
  denseDepthWorker:'workers/dense_depth_worker.js',
  denseFusionWorker:'workers/dense_fusion_worker.js',
  denseWidth:160,
  denseHeight:240,
  // Pose-associated neural raster.  Keep it separate from the cheaper MVS
  // raster: 160x240 was visibly sufficient for photometric matching but throws
  // away detail before the 224px Depth Anything preprocessor ever sees it.
  deepKeyframeWidth:224,
  deepKeyframeHeight:336,
  denseMaxKeyframes:10,
  denseMinSourceViews:2,
  denseMaxSourceViews:4,
  denseMinKeyframeIntervalMs:750,
  denseMinBaselineM:0.028,
  denseMaxBaselineM:0.75,
  denseMinBaselineAlva:0.014,
  denseMaxBaselineAlva:1.50,
  denseMaxViewAngleRad:0.38,
  denseNearM:0.28,
  denseFarM:8.5,
  denseDepthSteps:56,
  // Start sparse on low-budget devices; the existing runtime can tighten this on fast frames.
  densePixelStep:4,
  denseInitialSourceLimit:2,
  denseMaxPhotoCost:0.22,
  denseMinConfidence:0.11,
  denseMinTexture:0.018,
  denseMinDistinctiveness:0.025,
  denseMinSparseSeeds:5,
  denseSeedMaxReprojectionPx:2.8,
  denseSeedMinAngleRad:0.006,
  denseSeedMaxGapBaselineRatio:0.14,
  denseSeedRadiusPx:22,
  denseSeedMaxRelativeError:0.48,
  denseMaxSamplesPerDepth:14000,
  denseTsdfVoxelM:0.035,
  denseTsdfVoxelAlva:0.030,
  // Gaussian centres are continuous. This finer grid is ONLY a spatial index;
  // multiple Gaussians may coexist in one cell at corners/occlusions.
  denseGaussianHashVoxelM:0.020,
  denseGaussianHashVoxelAlva:0.018,
  denseGaussianMahalanobis2:11.34,
  denseProvisionalMaxAge:18,
  denseTsdfTruncVoxels:3,
  denseMinSurfaceSupport:2,
  // A surfel is confirmed only after a DIFFERENT Alva keyframe contributes a
  // ray-compatible observation with actual view diversity. Deep and MVS from
  // the same keyframe share one frameId, so they cannot self-confirm.
  denseRayConfirmBaselineM:0.035,
  denseRayConfirmBaselineAlva:0.018,
  denseRayMaxSigma:3.0,
  denseMaxSurfels:180000,
  denseMaxTsdfVoxels:450000,
  // The mesh TSDF is rebuilt from current confirmed surfels. Historical bad
  // one-frame depths therefore disappear when the consensus moves/refines.
  denseTsdfMinSupport:3,
  denseLiveTsdfMaxSurfels:18000,
  denseFinalTsdfMaxSurfels:60000,
  denseTsdfMaxSurfels:60000,
  denseSurfaceSnapshotEvery:2,
  // A fresh TSDF rebuild is intentionally less frequent than surfel updates.
  // Live AR uses splats between rebuilds; the final mesh is always requested on
  // Finish with the larger final budget below.
  denseMeshEvery:12,
  denseMaxMeshTriangles:90000,

  /*
   * Sparse Depth Anything V2 guidance. The model runs only on spatially novel
   * Alva keyframes that already contain enough triangulated depth anchors. Its
   * relative output is calibrated to Alva world depth and used ONLY to narrow
   * plane-sweep search; multi-view geometry remains the acceptance test.
   */
  deepDepthEnabled:true,
  deepDepthWorker:'workers/deep_depth_worker.js',
  // This is the actual bundled model.  Do not silently fall back to a remote
  // download: a typo or an offline phone must fail clearly instead of looking
  // like an endless download.
  deepModelUrl:'models/model_q4.onnx',
  deepModelRemoteUrl:null,
  deepModelLabel:'Depth Anything V2 Small Q4 locale',
  // Live diagnostic depth is intentionally independent from Alva tracking. It
  // runs at roughly 1 Hz during Scan even while Alva is still INIT, so the user
  // can immediately see whether the neural prior is geometrically meaningful.
  deepLiveDuringScan:true,
  deepInferenceIntervalMs:1000,
  // 224 px = 16 ViT/14 patches on the short side. On the test phone 168 px was
  // fast (~0.5 s) but collapsed into global vertical bands. 224 remains close to
  // the sub-second budget while providing substantially more spatial tokens.
  deepPreferredShortSide:224,
  // Dynamic-shape compatibility and quality-rescue ladder. A pathological map
  // first retries at 280 px (20 patches), then at 336 px only if the banding
  // detector still reports a collapsed DPT output. The first healthy plan is
  // cached for all later live/keyframe inferences on that device.
  deepCompatibilityShortSide:280,
  deepQualityRescueShortSide:280,
  deepQualityMaxRescueShortSide:336,
  deepInputMaxSide:518,
  // 0 restores ONNX Runtime Web's automatic WASM thread budget. V30.20 forced
  // one thread, which unnecessarily serialized CPU inference on isolated sites.
  deepWasmThreads:0,
  // The explicit test is a single inference on the healthy path. A second WASM
  // pass is created only when the spatial quality gate suspects corrupt WebGPU.
  deepTestFlipCheck:false,
  // Camera diagnostic source is downsampled before getImageData/worker transfer.
  deepTestCaptureMaxSide:480,
  // No local ORT bundle is currently shipped; avoid a guaranteed initial 404.
  // Add an actual matching ESM file here only for a fully offline deployment.
  deepOrtLocal:null,
  deepOrtRemote:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',
  deepMinAnchors:7,
  deepMinAnchorCells:3,
  // Inference is now sub-second on the test phone. Collect redundant Deep
  // constraints much more often; near-duplicate poses are still rejected.
  deepMinIntervalMs:750,
  deepMaxIntervalMs:2200,
  deepMinTranslationM:0.025,
  deepMinTranslationAlva:0.014,
  deepMinRotationRad:0.040,
  deepDepthNovelty:0.22,
  deepCalibrationMaxMedianRelativeError:0.18,
  deepPriorRelRange:0.18,
  // Coarse Deep prior means the local multi-view search can also use fewer hypotheses.
  deepPriorDepthSteps:10,
  deepPriorWeight:0.10,
  deepPriorMinConfidence:0.28,
  deepPriorMinTexture:0.006,
  // Calibrated pixels also become low-authority anisotropic ray observations.
  // They are cheap to store because only running surfel statistics survive.
  deepRayPixelStep:4,
  deepRayMaxSamples:6500,
  // Correctness first: non-selected near-duplicate frames are skipped instead of
  // reintroducing unconstrained plane-sweep sheets. A later novel view will fill
  // the same surface with one calibrated AI call.
  deepSkipUnprioritized:true,
  // Every geometrically accepted dense keyframe gets a Deep proxy. The dense
  // keyframe manager, not the neural selector, is now the sampling authority.
  deepInferEveryDenseKeyframe:true,

  // Legacy camera-only MVS remains available for diagnostics/fallback tooling.
  mvsWorker:'workers/mvs_worker.js',
  mvsEveryNthKeyframe:1,
  // V30.14 feeds only AlvaAR-tracked metric keyframe pairs to MVS. A 3 cm
  // lateral baseline is usually enough for local triangulation at room scale,
  // while still preserving strong visual overlap on a phone camera.
  mvsMinBaselineM:0.03,
  // When no physical scale is known, reconstruction still runs in Alva world
  // units. These thresholds gate parallax without pretending the unit is a metre.
  mvsMinBaselineAlva:0.015,
  mvsMaxBaselineAlva:3.0,
  mvsMaxBaselineM:1.25,
  mvsMaxAngleRad:0.55,
  mvsNearM:0.30,
  mvsFarM:9.0,
  mvsDepthSteps:36,
  mvsGridStep:7,
  mvsMinParallaxPx:2.0,
  mvsMaxRayGapM:0.065,
  mvsMaxFeatures:620,
  mvsMaxPoints:5200,


  // One-shot AlvaAR -> metric-world bootstrap. These samples are collected only
  // while the three calibrated pins are being re-observed. Once locked, this
  // transform is immutable and the pin matcher is disconnected from tracking.
  alvaBootstrapMinSamples:5,
  alvaBootstrapMinBaselineM:0.07,
  alvaBootstrapMaxPositionRmseM:0.045,
  alvaBootstrapMaxOrientationRmseRad:0.20,

  gaussianVoxelM:0.022,
  gaussianMaxLive:240000,
  gaussianSnapshot:90000,
  gaussianWorker:'workers/gaussian_worker.js',
  gaussianMinSupport:2,
  liveOverlayMaxSplats:3200,

  // Post-scan optimisation is deliberately decoupled from acquisition.  The
  // fusion map saves only a bounded multi-view observation reservoir per
  // Gaussian, then a Worker refines the map in user-selected iteration batches.
  // At most postOptimizePreviewUpdates snapshots are pushed to the main thread,
  // so a 100-iteration run does not serialize the whole cloud 100 times.
  postOptimizeWorker:'workers/gaussian_opt_worker.js',
  postOptimizeDefaultIterations:30,
  postOptimizeMaxIterations:300,
  postOptimizePreviewUpdates:16,
  postOptimizeMaxGaussians:70000,
  postOptimizeObservationReservoir:4,
  postOptimizePriorWeight:0.18,
  postOptimizePlaneWeight:0.10,
  postOptimizeDamping:0.68,

  /*
   * EXPERIMENTAL Surface Mesh Lab.  Nothing in this block replaces the V30.26
   * Gaussian/TSDF path: the review screen sends a bounded COPY to a dedicated
   * worker and keeps the production map as an immediate rollback point.
   */
  surfaceLabWorker:'workers/surface_mesh_lab_worker.js',
  surfaceLabMaxGaussians:30000,
  surfaceLabPreviewMaxGaussians:14000,
  surfaceLabDefaultIterations:20,
  surfaceLabMaxIterations:160,
  surfaceLabPreviewUpdates:12,
  surfaceLabMeshPreviewEvery:4,
  surfaceLabVoxelM:0.03,
  surfaceLabPreviewVoxelM:0.05,
  surfaceLabMaxVoxels:320000,
  surfaceLabPreviewMaxVoxels:120000,
  surfaceLabMaxTriangles:120000,
  surfaceLabPreviewMaxTriangles:35000,
  // Official AlvaAR ESM distribution. A physical vendor/alva_ar.js is used
  // first. If absent, the browser downloads one official/mirrored copy once,
  // validates the real AlvaAR API and stores it in CacheStorage for offline use.
  alvaRemoteUrls:[
    'https://cdn.jsdelivr.net/gh/alanross/AlvaAR@main/dist/alva_ar.js',
    'https://alanross.github.io/AlvaAR/dist/alva_ar.js',
    'https://raw.githubusercontent.com/alanross/AlvaAR/main/dist/alva_ar.js'
  ],
  // Kept as a compatibility alias for diagnostics from older V30 modules.
  alvaRemoteUrl:'https://raw.githubusercontent.com/alanross/AlvaAR/main/dist/alva_ar.js',
  wasmCore:'wasm/slam_core.wasm',
  // Depth Anything is lazy/optional: Alva tracking still works if the model is
  // not yet cached or a neural backend is unavailable. No IMU is required.
  serviceWorker:'sw.js',
  serviceWorkerRegisterDelayMs:2500,
  buildInfo:'build_info.json'
};
