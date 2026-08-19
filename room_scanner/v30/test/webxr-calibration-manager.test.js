import test from "node:test";
import assert from "node:assert/strict";
import { WebXRCalibrationManager } from "../src/webxr-calibration-manager.js";
import {
  estimateRigidTransform3D,
  mat4TransformEuclideanPoint,
  projectReferencePointToView,
} from "../src/mat4.js";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
}

function identity() {
  return new Float64Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1,
  ]);
}

function perspective90() {
  // Symmetric OpenGL/WebXR-style 90 degree projection.
  return new Float64Array([
    1,0,0,0,
    0,1,0,0,
    0,0,-1.002,-1,
    0,0,-0.2002,0,
  ]);
}

function normalizeQuaternion({ x, y, z, w }) {
  const n = Math.hypot(x, y, z, w) || 1;
  return { x: x/n, y: y/n, z: z/n, w: w/n };
}

function quaternionFromAxisAngle(axis, angleRad) {
  const n = Math.hypot(...axis) || 1;
  const s = Math.sin(angleRad / 2) / n;
  return normalizeQuaternion({ x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angleRad / 2) });
}

function rigidMatrix({ x = 0, y = 0, z = 0, q = { x:0,y:0,z:0,w:1 } } = {}) {
  const { x: qx, y: qy, z: qz, w: qw } = normalizeQuaternion(q);
  const r00 = 1 - 2 * (qy*qy + qz*qz);
  const r01 = 2 * (qx*qy - qz*qw);
  const r02 = 2 * (qx*qz + qy*qw);
  const r10 = 2 * (qx*qy + qz*qw);
  const r11 = 1 - 2 * (qx*qx + qz*qz);
  const r12 = 2 * (qy*qz - qx*qw);
  const r20 = 2 * (qx*qz - qy*qw);
  const r21 = 2 * (qy*qz + qx*qw);
  const r22 = 1 - 2 * (qx*qx + qy*qy);
  return new Float64Array([
    r00,r10,r20,0,
    r01,r11,r21,0,
    r02,r12,r22,0,
    x,y,z,1,
  ]);
}

function rigidInverse(m) {
  const out = identity();
  // R^-1 = R^T for a rigid transform.
  out[0]=m[0]; out[1]=m[4]; out[2]=m[8];
  out[4]=m[1]; out[5]=m[5]; out[6]=m[9];
  out[8]=m[2]; out[9]=m[6]; out[10]=m[10];
  const tx=m[12], ty=m[13], tz=m[14];
  out[12]=-(out[0]*tx + out[4]*ty + out[8]*tz);
  out[13]=-(out[1]*tx + out[5]*ty + out[9]*tz);
  out[14]=-(out[2]*tx + out[6]*ty + out[10]*tz);
  return out;
}

function transformAt(x, y, z) {
  return {
    matrix: rigidMatrix({ x, y, z }),
    position: { x, y, z },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

function viewerAt(x = 0, y = 0, z = 0, q = {x:0,y:0,z:0,w:1}) {
  const cameraToReference = rigidMatrix({ x, y, z, q });
  return {
    transform: {
      matrix: cameraToReference,
      position: { x, y, z },
      orientation: normalizeQuaternion(q),
    },
    views: [{
      eye: "none",
      transform: { matrix: cameraToReference, inverse: { matrix: rigidInverse(cameraToReference) } },
      projectionMatrix: perspective90(),
    }],
  };
}

function poseAt(x, y, z) {
  return { transform: transformAt(x, y, z) };
}

function makeAnchor(id, persistent = true) {
  return {
    anchorSpace: { id: `space-${id}` },
    requestPersistentHandle: persistent ? async () => `uuid-${id}` : undefined,
    delete() {},
  };
}

async function addAnchorPin(manager, id, position, poseBySpace) {
  const anchor = makeAnchor(id);
  poseBySpace.set(anchor.anchorSpace, poseAt(...position));
  const hitResult = { createAnchor: async () => anchor };
  const pin = await manager.addPinFromHitTest({ hitResult, frame: {}, referenceSpace: {} });
  return { pin, anchor };
}

function updateWithAnchors(manager, anchors, poseBySpace, viewerPose = viewerAt()) {
  const frame = {
    trackedAnchors: new Set(anchors),
    getPose: (space) => poseBySpace.get(space) ?? null,
  };
  return manager.updateFrame({ frame, referenceSpace: {}, viewerPose });
}

function geometryFromPositions(positionMap) {
  const entries = Object.entries(positionMap);
  const pairs = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i], b = entries[j];
      pairs.push({ a:a[0], b:b[0], distanceM: Math.hypot(
        a[1][0]-b[1][0], a[1][1]-b[1][1], a[1][2]-b[1][2]) });
    }
  }
  return pairs;
}

test("projects front/behind/outside-frustum points correctly", () => {
  const view = viewerAt().views[0];
  const center = projectReferencePointToView([0, 0, -2], view);
  assert.equal(center.visible, true);
  assert.ok(Math.abs(center.u - 0.5) < 1e-12);
  assert.ok(Math.abs(center.v - 0.5) < 1e-12);
  assert.equal(projectReferencePointToView([0, 0, 2], view).reason, "behind-camera");
  assert.equal(projectReferencePointToView([4, 0, -2], view).visible, false);
});

test("projection follows the actual XRView pose instead of screen coordinates", () => {
  const point = [0, 0, -2];
  const centered = projectReferencePointToView(point, viewerAt(0,0,0).views[0]);
  const shifted = projectReferencePointToView(point, viewerAt(0.5,0,0).views[0]);
  assert.equal(centered.visible, true);
  assert.equal(shifted.visible, true);
  assert.ok(shifted.u < centered.u, `expected pin to move left, got ${shifted.u} >= ${centered.u}`);
});

test("world-lock diagnostic accepts moving XRView projections for a fixed world anchor", async () => {
  const manager = new WebXRCalibrationManager({
    storage: new MemoryStorage(),
    worldLockMinTranslationM: 0.05,
    worldLockMinProjectionDelta: 0.001,
    worldLockMinCommonPins: 2,
  });
  const poseBySpace = new Map();
  const anchors = [];
  for (const [id,p] of [["a",[-0.3,0,-2]],["b",[0.3,0,-2]],["c",[0,0.3,-2]]]) {
    anchors.push((await addAnchorPin(manager,id,p,poseBySpace)).anchor);
  }
  updateWithAnchors(manager, anchors, poseBySpace, viewerAt(0,0,0));
  const second = updateWithAnchors(manager, anchors, poseBySpace, viewerAt(0.2,0,0));
  assert.equal(second.worldLockDiagnostic.status, "ok");
  assert.ok(second.worldLockDiagnostic.maxProjectionDelta > 0.001);
});

test("world-lock diagnostic catches a stale XRView/screen projection while reported viewer pose moves", async () => {
  const manager = new WebXRCalibrationManager({
    storage: new MemoryStorage(),
    worldLockMinTranslationM: 0.05,
    worldLockMinProjectionDelta: 0.001,
    worldLockMinCommonPins: 2,
  });
  const poseBySpace = new Map();
  const anchors = [];
  for (const [id,p] of [["a",[-0.3,0,-2]],["b",[0.3,0,-2]],["c",[0,0.3,-2]]]) {
    anchors.push((await addAnchorPin(manager,id,p,poseBySpace)).anchor);
  }
  const first = viewerAt(0,0,0);
  updateWithAnchors(manager, anchors, poseBySpace, first);

  const staleView = viewerAt(0,0,0).views[0];
  const movedButStaleView = viewerAt(0.2,0,0);
  movedButStaleView.views = [staleView];
  let warnings = 0;
  manager.addEventListener("worldlockwarning", () => { warnings += 1; });
  const second = updateWithAnchors(manager, anchors, poseBySpace, movedButStaleView);
  assert.equal(second.worldLockDiagnostic.status, "warning");
  assert.equal(second.worldLockDiagnostic.reason, "camera-moved-but-anchor-projections-remained-static");
  assert.equal(warnings, 1);
});

test("a pin cannot be added from a copied reticle pose", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  await assert.rejects(
    manager.addPinFromHitTest({ hitResult: {}, frame: {}, referenceSpace: {} }),
    /requires XRHitTestResult\.createAnchor/,
  );
});

test("anchor creation never queries the stale frame after await", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  const anchor = makeAnchor("late");
  let staleGetPoseCalls = 0;
  const staleFrame = {
    getPose() {
      staleGetPoseCalls += 1;
      throw new Error("InvalidStateError: XRFrame is inactive");
    },
  };
  const pin = await manager.addPinFromHitTest({
    hitResult: { createAnchor: async () => anchor },
    frame: staleFrame,
    referenceSpace: {},
  });
  assert.equal(staleGetPoseCalls, 0);
  assert.equal(pin.creationReferencePoseMatrix, null);

  const poseBySpace = new Map([[anchor.anchorSpace, poseAt(0, 0, -2)]]);
  updateWithAnchors(manager, [anchor], poseBySpace);
  const live = manager.pins.get(pin.id);
  assert.ok(live.creationReferencePoseMatrix);
  assert.deepEqual(live.referenceGeometryPosition, [0,0,-2]);
});

test("trackedAnchors is authoritative and tracking loss removes visibility", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  const poseBySpace = new Map();
  const { anchor } = await addAnchorPin(manager, "a", [0,0,-2], poseBySpace);
  updateWithAnchors(manager, [anchor], poseBySpace);
  assert.equal(manager.getFramePinState()[0].visible, true);

  const frameLost = { trackedAnchors: new Set(), getPose: () => { throw new Error("must-not-be-called"); } };
  manager.updateFrame({ frame: frameLost, referenceSpace: {}, viewerPose: viewerAt() });
  const state = manager.getFramePinState()[0];
  assert.equal(state.tracked, false);
  assert.equal(state.locatable, false);
  assert.equal(state.visible, false);
});

test("trackedAnchors is mandatory by default; getPose alone cannot validate a real calibration anchor", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  const poseBySpace = new Map();
  await addAnchorPin(manager, "a", [0,0,-2], poseBySpace);
  let getPoseCalls = 0;
  const frame = { getPose: () => { getPoseCalls += 1; return poseAt(0,0,-2); } };
  const summary = manager.updateFrame({ frame, referenceSpace: {}, viewerPose: viewerAt() });
  assert.equal(summary.trackingSource, "trackedAnchors-required-missing");
  assert.equal(summary.realAnchorTrackingAvailable, false);
  assert.equal(summary.visibleCount, 0);
  assert.equal(getPoseCalls, 0, "strict real-anchor mode must not promote getPose-only data");
  assert.match(manager.getFramePinState()[0].trackingError, /trackedAnchors is unavailable/);
});

test("getPose-only compatibility can be explicitly enabled but is not the default", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage(), requireTrackedAnchors: false });
  const poseBySpace = new Map();
  await addAnchorPin(manager, "a", [0,0,-2], poseBySpace);
  const frame = { getPose: (space) => poseBySpace.get(space) };
  const summary = manager.updateFrame({ frame, referenceSpace: {}, viewerPose: viewerAt() });
  assert.equal(summary.trackingSource, "getPose-compatibility-fallback");
  assert.equal(summary.visibleCount, 1);
});

test("inactive/getPose errors are isolated per pin and exposed for debugging", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  const poseBySpace = new Map();
  const { anchor } = await addAnchorPin(manager, "a", [0,0,-2], poseBySpace);
  const frame = {
    trackedAnchors: new Set([anchor]),
    getPose: () => { throw new Error("InvalidStateError"); },
  };
  const summary = manager.updateFrame({ frame, referenceSpace: {}, viewerPose: viewerAt() });
  assert.equal(summary.errorCount, 1);
  assert.match(manager.getFramePinState()[0].trackingError, /InvalidStateError/);
});

test("3 distinct poses with 3 tracked visible anchors satisfy real 3x3 coverage", async () => {
  const manager = new WebXRCalibrationManager({
    storage: new MemoryStorage(),
    minPoseTranslationM: 0.1,
    minPoseRotationDeg: 10,
  });
  const poseBySpace = new Map();
  const anchors = [];
  for (const [id, p] of [["a",[-0.25,0,-2]],["b",[0.25,0,-2]],["c",[0,0.25,-2]]]) {
    const added = await addAnchorPin(manager, id, p, poseBySpace);
    anchors.push(added.anchor);
  }

  for (const x of [0, 0.15, 0.30]) {
    const vp = viewerAt(x, 0, 0);
    updateWithAnchors(manager, anchors, poseBySpace, vp);
    const capture = manager.captureCalibrationPose({ viewerPose: vp });
    assert.equal(capture.accepted, true);
  }
  assert.equal(manager.getCoverageReport().ready, true);
  assert.equal(manager.getCoverageReport().qualifyingPoses, 3);
});

test("near-duplicate calibration pose is rejected", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  const poseBySpace = new Map();
  const anchors = [];
  for (const [id,p] of [["a",[-.2,0,-2]],["b",[.2,0,-2]],["c",[0,.2,-2]]]) {
    anchors.push((await addAnchorPin(manager,id,p,poseBySpace)).anchor);
  }
  updateWithAnchors(manager, anchors, poseBySpace, viewerAt());
  assert.equal(manager.captureCalibrationPose().accepted, true);
  updateWithAnchors(manager, anchors, poseBySpace, viewerAt(0.02,0,0, quaternionFromAxisAngle([0,1,0], 2*Math.PI/180)));
  const duplicate = manager.captureCalibrationPose();
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "pose-too-similar");
});

test("rigid alignment solver recovers rotation and translation", () => {
  const source = [[0,0,0],[1,0,0],[0,1,0],[0,0,1]];
  const expected = rigidMatrix({ x:2, y:-1, z:0.5, q:quaternionFromAxisAngle([0,0,1], Math.PI/2) });
  const target = source.map((p) => mat4TransformEuclideanPoint(expected, p));
  const fit = estimateRigidTransform3D(source, target);
  assert.equal(fit.ok, true);
  assert.ok(fit.rmseM < 1e-10);
  for (let i = 0; i < 16; i += 1) assert.ok(Math.abs(fit.matrix[i] - expected[i]) < 1e-9);
});

test("rigid alignment rejects three collinear pins", () => {
  const fit = estimateRigidTransform3D([[0,0,0],[1,0,0],[2,0,0]], [[0,1,0],[1,1,0],[2,1,0]]);
  assert.equal(fit.ok, false);
  assert.equal(fit.reason, "degenerate-collinear-anchor-geometry");
});

test("saved persistent anchors restore and recover old-reference to current-reference transform", async () => {
  const storage = new MemoryStorage();
  const initial = new WebXRCalibrationManager({ storage });
  initial.calibration = { cameraToSavedReference: "opaque-project-calibration" };
  initial.referencePinPositions = {
    a: [-0.3,-0.2,-2],
    b: [ 0.4,-0.2,-2],
    c: [-0.3, 0.5,-2],
    d: [ 0.3, 0.4,-2.2],
  };
  initial.referencePinGeometry = geometryFromPositions(initial.referencePinPositions);
  for (const id of Object.keys(initial.referencePinPositions)) {
    initial.pins.set(id, { id, label:id.toUpperCase(), persistentHandle:`uuid-${id}`, persistence:"native-persistent" });
  }
  initial.saveProfile("room");

  const loaded = new WebXRCalibrationManager({ storage });
  assert.ok(loaded.loadProfile("room"));
  const transform = rigidMatrix({ x:0.18, y:-0.07, z:0.03, q:quaternionFromAxisAngle([0,0,1], 12*Math.PI/180) });
  const anchors = new Map();
  const poseBySpace = new Map();
  for (const [id, source] of Object.entries(loaded.referencePinPositions)) {
    const anchor = makeAnchor(`restored-${id}`, false);
    anchors.set(id, anchor);
    const target = mat4TransformEuclideanPoint(transform, source);
    poseBySpace.set(anchor.anchorSpace, poseAt(...target));
  }
  const session = {
    persistentAnchors: Object.keys(loaded.referencePinPositions).map((id) => `uuid-${id}`),
    restorePersistentAnchor: async (uuid) => anchors.get(uuid.replace("uuid-", "")),
  };
  const report = await loaded.restorePersistentAnchors(session);
  assert.equal(report.restored.length, 4);
  updateWithAnchors(loaded, [...anchors.values()], poseBySpace, viewerAt());
  const verify = loaded.verifyCurrentFrame();
  assert.equal(verify.ok, true);
  assert.ok(verify.sessionAlignment.rmseM < 1e-9);
  assert.equal(loaded.state, "verified");
  assert.ok(loaded.getSessionAlignment());

  const usable = loaded.getCurrentSessionCalibration();
  assert.equal(usable.usable, true);
  assert.equal(usable.requiresConsumerRebase, true);
  for (let i = 0; i < 16; i += 1) {
    assert.ok(Math.abs(usable.savedReferenceToCurrentReferenceMatrix[i] - transform[i]) < 1e-8);
  }
});

test("loaded calibration remains unusable before anchor verification", () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  manager.calibration = { k:1 };
  manager.loadedFromProfile = true;
  manager.state = "loaded-needs-verification";
  const current = manager.getCurrentSessionCalibration();
  assert.equal(current.usable, false);
  assert.equal(current.reason, "calibration-reference-not-verified-in-current-session");
});

test("verification detects anchor geometry drift", () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage(), anchorGeometryRmseThresholdM:0.01 });
  manager.calibration = { ok:true };
  manager.referencePinPositions = { a:[0,0,-2], b:[1,0,-2], c:[0,1,-2] };
  manager.referencePinGeometry = geometryFromPositions(manager.referencePinPositions);
  manager.framePinState = new Map([
    ["a", {pinId:"a",label:"A",tracked:true,locatable:true,visible:true,position:[0,0,-2],projections:[]}],
    ["b", {pinId:"b",label:"B",tracked:true,locatable:true,visible:true,position:[1.08,0,-2],projections:[]}],
    ["c", {pinId:"c",label:"C",tracked:true,locatable:true,visible:true,position:[0,1,-2],projections:[]}],
  ]);
  const result = manager.verifyCurrentFrame();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "anchor-geometry-drift");
});

test("verification rejects collinear saved pins even if pairwise distances match", () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  manager.calibration = { ok:true };
  manager.referencePinPositions = { a:[0,0,-2], b:[0.5,0,-2], c:[1,0,-2] };
  manager.referencePinGeometry = geometryFromPositions(manager.referencePinPositions);
  manager.framePinState = new Map(Object.entries(manager.referencePinPositions).map(([id,p]) => [id, {
    pinId:id,label:id,tracked:true,locatable:true,visible:true,position:p,projections:[],
  }]));
  const result = manager.verifyCurrentFrame();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "degenerate-collinear-anchor-geometry");
});

test("persistent restore handles missing, unsupported and thrown restores separately", async () => {
  const manager = new WebXRCalibrationManager({ storage: new MemoryStorage() });
  manager.pins.set("a", {id:"a",persistentHandle:"uuid-a"});
  manager.pins.set("b", {id:"b",persistentHandle:"uuid-b"});
  manager.pins.set("c", {id:"c",persistentHandle:null});
  const report = await manager.restorePersistentAnchors({
    persistentAnchors: Object.freeze(["uuid-a", "uuid-b"]),
    restorePersistentAnchor: async (uuid) => {
      if (uuid === "uuid-b") throw new Error("runtime-lost-anchor");
      return makeAnchor("ok", false);
    },
  });
  assert.deepEqual(report.restored, ["a"]);
  assert.deepEqual(report.missing, ["b"]);
  assert.deepEqual(report.unsupported, ["c"]);
  assert.match(report.errors.b, /runtime-lost-anchor/);
});

test("refinement rejection preserves previous calibration", async () => {
  const manager = new WebXRCalibrationManager({
    storage: new MemoryStorage(),
    solveCalibration: async ({mode}) => ({ value: mode === "initial" ? 1 : 2 }),
    validateCalibration: async ({mode}) => ({ accepted: mode === "initial", score: mode === "initial" ? 1 : 5 }),
  });
  manager.calibrationPoses = [1,2,3].map((i) => ({ id:`p${i}`, visiblePins:[{},{},{}] }));
  assert.equal((await manager.solve()).accepted, true);
  assert.equal(manager.calibration.value, 1);
  assert.equal((await manager.improve()).accepted, false);
  assert.equal(manager.calibration.value, 1);
});

test("schema v3 profiles migrate to v5 using one captured pin snapshot", () => {
  const storage = new MemoryStorage();
  const legacyKey = "webxr-calibration-profiles-v3";
  const profile = {
    schemaVersion:3,
    profileName:"legacy",
    calibration:{old:true},
    pins:[{id:"a"},{id:"b"},{id:"c"}],
    calibrationPoses:[{
      id:"pose-legacy",
      visiblePins:[
        {pinId:"a",position:[0,0,-2]},
        {pinId:"b",position:[1,0,-2]},
        {pinId:"c",position:[0,1,-2]},
      ],
    }],
  };
  storage.setItem(legacyKey, JSON.stringify({legacy:profile}));
  const manager = new WebXRCalibrationManager({ storage });
  const migrated = manager.loadProfile("legacy");
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(manager.referenceSnapshotPoseId, "pose-legacy");
  assert.deepEqual(manager.referencePinPositions.a, [0,0,-2]);
  assert.equal(manager.referencePinGeometry.length, 3);
  assert.ok(storage.getItem("webxr-calibration-profiles-v5"));
});

// Public-data replay: excerpt from TUM RGB-D benchmark freiburg1_rpy ground truth.
// Source: https://cvg.cit.tum.de/data/datasets/rgbd-dataset/download
// The official dataset describes this sequence as intended for debugging camera
// rotations. We use real trajectory quaternions to stress the pose-diversity gate.
const TUM_FREIBURG1_RPY_EXCERPT = [
  [1305031225.9334,1.3357,0.6698,1.6180, 0.6504,0.6012,-0.3056,-0.3496],
  [1305031226.0333,1.3353,0.6765,1.6165, 0.6608,0.5893,-0.2555,-0.3883],
  [1305031226.1333,1.3359,0.6837,1.6162, 0.6700,0.5727,-0.2059,-0.4251],
  [1305031226.2333,1.3363,0.6895,1.6163, 0.6724,0.5579,-0.1567,-0.4605],
  [1305031226.3334,1.3369,0.6950,1.6156, 0.6726,0.5441,-0.1142,-0.4884],
  [1305031226.4333,1.3395,0.7014,1.6144,-0.6762,-0.5222, 0.0684, 0.5151],
  [1305031226.5533,1.3423,0.7082,1.6146,-0.6723,-0.4957, 0.0169, 0.5496],
  [1305031226.6733,1.3433,0.7109,1.6143,-0.6697,-0.4884, 0.0006, 0.5594],
  [1305031226.7932,1.3424,0.7128,1.6119,-0.6758,-0.4960, 0.0109, 0.5451],
  [1305031226.8932,1.3368,0.7114,1.6053, 0.6889,0.5280,-0.0981,-0.4869],
  [1305031226.9932,1.3305,0.7085,1.5967, 0.6930,0.5506,-0.1654,-0.4350],
  [1305031227.0932,1.3241,0.7017,1.5864, 0.6951,0.5740,-0.2382,-0.3615],
];

test("TUM freiburg1_rpy public trajectory produces genuinely diverse rotation samples", () => {
  const manager = new WebXRCalibrationManager({ storage:new MemoryStorage(), minPoseTranslationM:0.12, minPoseRotationDeg:10 });
  // We isolate the diversity logic from visibility here: the frame states are
  // three valid anchored points, while the viewer poses use real benchmark poses.
  manager.framePinState = new Map([
    ["a",{pinId:"a",visible:true}], ["b",{pinId:"b",visible:true}], ["c",{pinId:"c",visible:true}],
  ]);
  let accepted = 0;
  for (const row of TUM_FREIBURG1_RPY_EXCERPT) {
    const [,x,y,z,qx,qy,qz,qw] = row;
    const vp = viewerAt(x,y,z,{x:qx,y:qy,z:qz,w:qw});
    if (manager.captureCalibrationPose({ viewerPose:vp, tag:"tum-rpy" }).accepted) accepted += 1;
  }
  assert.ok(accepted >= 3, `expected >=3 distinct real poses, got ${accepted}`);
  assert.equal(manager.getCoverageReport().ready, true);
});


test("non-finite rigid-transform correspondences are rejected instead of producing NaN calibration", () => {
  const fit = estimateRigidTransform3D(
    [[0,0,0],[1,0,0],[0,1,0]],
    [[0,0,0],[1,0,0],[Number.NaN,1,0]],
  );
  assert.equal(fit.ok, false);
  assert.equal(fit.reason, "non-finite-correspondence");
});

test("XRReferenceSpace reset discards mixed-space pose collection and requires re-verification", () => {
  class FakeReferenceSpace extends EventTarget {}
  const manager = new WebXRCalibrationManager({ storage:new MemoryStorage() });
  const ref = new FakeReferenceSpace();
  manager.calibration = { worldTransform:"saved-basis" };
  manager.referencePinPositions = { a:[0,0,-2], b:[1,0,-2], c:[0,1,-2] };
  manager.referencePinGeometry = geometryFromPositions(manager.referencePinPositions);
  manager.calibrationPoses = [
    {id:"old-1",visiblePins:[{},{},{}]},
    {id:"old-2",visiblePins:[{},{},{}]},
    {id:"old-3",visiblePins:[{},{},{}]},
  ];

  // updateFrame automatically subscribes to reset on the actual reference space.
  manager.updateFrame({ frame:{trackedAnchors:new Set(),getPose:()=>null}, referenceSpace:ref, viewerPose:viewerAt() });
  ref.dispatchEvent(new Event("reset"));

  assert.equal(manager.referenceSpaceResetCount, 1);
  assert.equal(manager.calibrationPoses.length, 0, "pre-reset coordinates must not enter post-reset refinement");
  assert.equal(manager.requiresReferenceAlignment, true);
  assert.equal(manager.state, "reference-space-reset-needs-verification");
  assert.equal(manager.getCurrentSessionCalibration().usable, false);
});

test("profile load keeps old observations separate from current-session refinement poses", () => {
  const storage = new MemoryStorage();
  const original = new WebXRCalibrationManager({ storage });
  original.calibration = { k:123 };
  original.calibrationPoses = [1,2,3].map((i)=>({id:`saved-${i}`,visiblePins:[{},{},{}]}));
  original.referencePinPositions = {a:[0,0,-2],b:[1,0,-2],c:[0,1,-2]};
  original.referencePinGeometry = geometryFromPositions(original.referencePinPositions);
  original.saveProfile("room");

  const loaded = new WebXRCalibrationManager({ storage });
  loaded.loadProfile("room");
  assert.equal(loaded.calibrationPoses.length, 0);
  assert.equal(loaded.savedCalibrationPoses.length, 3);
  assert.equal(loaded.getCoverageReport().qualifyingPoses, 0);
});

test("four-pin leave-one-out alignment validation exposes a single drifting anchor", () => {
  const manager = new WebXRCalibrationManager({ storage:new MemoryStorage() });
  manager.referencePinPositions = {
    a:[-0.4,-0.3,-2], b:[0.5,-0.25,-2.1], c:[-0.35,0.45,-1.95], d:[0.4,0.4,-2.2],
  };
  const shift = rigidMatrix({x:0.2,y:-0.1,z:0.03,q:quaternionFromAxisAngle([0,1,0],8*Math.PI/180)});
  const states = Object.entries(manager.referencePinPositions).map(([id,p])=>{
    const current = mat4TransformEuclideanPoint(shift,p);
    if (id === "d") current[0] += 0.06;
    return [id,{pinId:id,label:id,tracked:true,locatable:true,visible:true,position:current,projections:[]}];
  });
  manager.framePinState = new Map(states);
  const alignment = manager.estimateCurrentSessionAlignment();
  assert.equal(alignment.accepted, false);
  assert.equal(alignment.reason, "session-alignment-cross-validation-failed");
  assert.ok(alignment.crossValidationMaxErrorM > alignment.crossValidationThresholdM);
  assert.equal(alignment.crossValidationErrorsM.length, 4);
});

test("refinement after loaded calibration requires verified old-to-current alignment", async () => {
  const manager = new WebXRCalibrationManager({
    storage:new MemoryStorage(),
    solveCalibration: async () => ({ refined:true }),
  });
  manager.calibration = { old:true };
  manager.loadedFromProfile = true;
  manager.requiresReferenceAlignment = true;
  manager.calibrationPoses = [1,2,3].map((i)=>({id:`p${i}`,visiblePins:[{},{},{}]}));
  await assert.rejects(
    () => manager.improve(),
    /Verify restored anchors before refinement/,
  );
});

test("TUM Freiburg1 public intrinsics agree with WebXR-style projection math", () => {
  // Official TUM Freiburg1 RGB calibration: fx=517.3, fy=516.5,
  // cx=318.6, cy=255.3 for the 640x480 RGB stream.
  const width=640, height=480, fx=517.3, fy=516.5, cx=318.6, cy=255.3;
  const near=0.1, far=100;
  const projection = new Float64Array([
    2*fx/width,0,0,0,
    0,2*fy/height,0,0,
    1-2*cx/width,2*cy/height-1,-(far+near)/(far-near),-1,
    0,0,-2*far*near/(far-near),0,
  ]);
  const view = { transform:{inverse:{matrix:identity()}}, projectionMatrix:projection };
  for (const p of [[0,0,-2],[0.2,0.1,-1.5],[-0.3,-0.15,-2.4]]) {
    const result = projectReferencePointToView(p,view);
    assert.equal(result.visible,true);
    const expectedU = (fx*(p[0]/(-p[2])) + cx) / width;
    const expectedV = (cy - fy*(p[1]/(-p[2]))) / height;
    assert.ok(Math.abs(result.u-expectedU) < 1e-12);
    assert.ok(Math.abs(result.v-expectedV) < 1e-12);
  }
});
