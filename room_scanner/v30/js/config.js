export const BUILD={
  version:'30.4.0',
  id:'v30.4.0-20260819-relative-L-map',
  dbName:'room-scanner-v30',
  dbVersion:2
};
export const CONFIG={
  analysisWidth:320,
  analysisHeight:480,
  analysisFps:12,
  cameraFovDeg:62,
  keyframeIntervalMs:1100,
  maxKeyframes:360,
  deepOnlineDefault:false,
  deepQueueMax:3,
  deepEveryNthKeyframe:1,
  deferredDeepMaxKeyframes:96,
  gaussianVoxelM:0.028,
  gaussianMaxLive:180000,
  gaussianSnapshot:65000,
  snapshotPersistIntervalMs:10000,
  minimumMetricConfidence:.30,
  // If metric scale cannot be estimated reliably, map depths are normalized
  // around this reference. L is an arbitrary, user-editable map unit.
  relativeReferenceDepthL:1,
  gaussianMinDepthL:.03,
  gaussianMaxDepthL:16,
  depthWorker:'workers/depth_worker.js',
  gaussianWorker:'workers/gaussian_worker.js',
  wasmCore:'wasm/slam_core.wasm',
  // Local files win. Remote fallback is optional and never blocks bootstrap.
  transformersLocal:'vendor/transformers/transformers.min.js',
  transformersRemote:'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm',
  depthModelId:'onnx-community/depth-anything-v2-small',
  serviceWorker:'sw.js'
};
