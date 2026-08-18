/**
 * Room Scanner V20.4 configuration.
 *
 * V20.4 deliberately prioritizes dense metric evidence over early surface
 * simplification.  The online map is still bounded, but capture persists a
 * compact ray stream so later processing (phone, desktop or GPU) can rebuild
 * a much denser virtual twin without rescanning the room.
 */
export const BUILD = Object.freeze({
  version: '20.4.0',
  id: 'v20.4.0-20260818-dense-ray-gaussian-twin',
  dbName: 'room-scanner-v20-2',
  dbVersion: 1,
  rawFormat: 'RSCAN-ZIP-1'
});

export const PROFILES = Object.freeze({
  light: {
    depthStride: 9,
    depthIntervalMs: 150,
    maxPointBatch: 3200,
    cameraWidth: 320,
    minPhotoIntervalMs: 1500,
    denseRgbIntervalMs: 1900,
    rayRgbIntervalMs: 900,
    gridSnapshotIntervalMs: 5200,
    maxVisibleTiles: 80,
    maxPendingWrites: 6,
    audioChunkFrames: 16384,
    mapBudgetCells: 90000
  },
  balanced: {
    depthStride: 6,
    depthIntervalMs: 105,
    maxPointBatch: 6200,
    cameraWidth: 416,
    minPhotoIntervalMs: 1050,
    denseRgbIntervalMs: 1250,
    rayRgbIntervalMs: 520,
    gridSnapshotIntervalMs: 3900,
    maxVisibleTiles: 120,
    maxPendingWrites: 8,
    audioChunkFrames: 12288,
    mapBudgetCells: 160000
  },
  detail: {
    depthStride: 4,
    depthIntervalMs: 75,
    maxPointBatch: 11000,
    cameraWidth: 512,
    minPhotoIntervalMs: 720,
    denseRgbIntervalMs: 760,
    rayRgbIntervalMs: 320,
    gridSnapshotIntervalMs: 3000,
    maxVisibleTiles: 155,
    maxPendingWrites: 10,
    audioChunkFrames: 8192,
    mapBudgetCells: 220000
  }
});

export const GRID = Object.freeze({
  // Kept for old RSPT decoders.  V20.4 online point Gaussians use the much
  // finer pointGaussianVoxelM and raw rays retain their original UV+depth.
  sourceVoxelM: 0.055,
  pointGaussianVoxelM: 0.020,
  unknownTileM: 0.11,
  flatTileM: 0.18,
  objectTileM: 0.075,
  edgeTileM: 0.045,
  minIndependentBaselineM: 0.18,
  strongIndependentBaselineM: 0.42,
  minParallaxDeg: 5,
  strongParallaxDeg: 13,
  maxFrameRefsPerCell: 8,
  redGeometryThreshold: 0.30,
  greenGeometryThreshold: 0.68,
  greenPhotoThreshold: 0.56,
  normalStableResultant: 0.80,
  objectCurvatureThreshold: 0.17,
  deepRequestAfterMs: 3600,
  staleAfterMs: 14000
});

export const MARKPOINT = Object.freeze({
  minDepthM: 0.28,
  maxDepthM: 5.5,
  minSaturation: 0.24,
  minContrast: 0.07,
  minEdgeEnergy: 0.045,
  maxDepthStdM: 0.045,
  minDistanceFromOtherM: 0.24,
  confirmationBaselineM: 0.20,
  descriptorDistanceMax: 0.31,
  validConfirmations: 2
});

export const AUDIO = Object.freeze({
  preferredSampleRate: 48000,
  sweepDurationS: 0.135,
  sweepStartHz: 180,
  sweepEndHz: 15000,
  tailDurationS: 0.62,
  minIntervalS: 1.05,
  maxIntervalS: 1.85,
  level: 0.22,
  maxLinearSpeedMps: 0.85,
  maxAngularSpeedRadps: 1.5,
  minBatteryFriendlyIntervalS: 1.35
});

export const PROCESSING = Object.freeze({
  planeDistanceM: 0.055,
  planeNormalDeg: 18,
  minPlaneSupport: 50,
  floorNormalY: 0.76,
  wallNormalYMax: 0.34,
  planeIterations: 260,
  maxPlanes: 36,
  objectClusterRadiusM: 0.13,
  minObjectPoints: 18,
  maxObjectPoints: 48000,
  maxFrameLinksPerSurface: 16,
  denseGaussianVoxelM: 0.018,
  denseGaussianMaxPhone: 320000,
  denseGaussianMaxDesktop: 900000
});

export function profileFor(name) {
  return PROFILES[name] || PROFILES.balanced;
}
