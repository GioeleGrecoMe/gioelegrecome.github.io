/**
 * Room Scanner V20.2 configuration.
 *
 * All budgets live in one file so a phone profile can be changed without
 * touching acquisition or reconstruction logic. Values are intentionally
 * conservative: losing a frame is preferable to losing the browser process.
 */
export const BUILD = Object.freeze({
  version: '20.3.0',
  id: 'v20.3.0-20260818-dense-gaussian-deep-fusion',
  dbName: 'room-scanner-v20-2',
  dbVersion: 1,
  rawFormat: 'RSCAN-ZIP-1'
});

export const PROFILES = Object.freeze({
  light: {
    depthStride: 22,
    maxPointBatch: 900,
    cameraWidth: 320,
    minPhotoIntervalMs: 2200,
    gridSnapshotIntervalMs: 6000,
    maxVisibleTiles: 70,
    maxPendingWrites: 5,
    audioChunkFrames: 16384,
    mapBudgetCells: 36000
  },
  balanced: {
    depthStride: 16,
    maxPointBatch: 1600,
    cameraWidth: 416,
    minPhotoIntervalMs: 1500,
    gridSnapshotIntervalMs: 4500,
    maxVisibleTiles: 105,
    maxPendingWrites: 7,
    audioChunkFrames: 12288,
    mapBudgetCells: 52000
  },
  detail: {
    depthStride: 11,
    maxPointBatch: 2600,
    cameraWidth: 512,
    minPhotoIntervalMs: 1050,
    gridSnapshotIntervalMs: 3500,
    maxVisibleTiles: 135,
    maxPendingWrites: 8,
    audioChunkFrames: 8192,
    mapBudgetCells: 65000
  }
});

export const GRID = Object.freeze({
  sourceVoxelM: 0.055,
  unknownTileM: 0.13,
  flatTileM: 0.22,
  objectTileM: 0.075,
  edgeTileM: 0.065,
  minIndependentBaselineM: 0.22,
  strongIndependentBaselineM: 0.48,
  minParallaxDeg: 7,
  strongParallaxDeg: 15,
  maxFrameRefsPerCell: 6,
  redGeometryThreshold: 0.34,
  greenGeometryThreshold: 0.72,
  greenPhotoThreshold: 0.62,
  normalStableResultant: 0.82,
  objectCurvatureThreshold: 0.19,
  deepRequestAfterMs: 4500,
  staleAfterMs: 12000
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
  planeDistanceM: 0.065,
  planeNormalDeg: 18,
  minPlaneSupport: 36,
  floorNormalY: 0.78,
  wallNormalYMax: 0.32,
  planeIterations: 210,
  maxPlanes: 28,
  objectClusterRadiusM: 0.16,
  minObjectPoints: 12,
  maxObjectPoints: 18000,
  maxFrameLinksPerSurface: 10
});

export function profileFor(name) {
  return PROFILES[name] || PROFILES.balanced;
}
