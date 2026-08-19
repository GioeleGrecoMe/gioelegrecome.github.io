import assert from "node:assert/strict";
import { WebXRCalibrationManager } from "../src/webxr-calibration-manager.js";
import { XRAnchorScenePinRenderer } from "../src/xr-anchor-scene-renderer.js";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k,v) { this.map.set(k,String(v)); }
}

function matrixAt(x=0,y=0,z=0) {
  return new Float64Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    x,y,z,1,
  ]);
}
function inverseTranslation(m) { return matrixAt(-m[12],-m[13],-m[14]); }
function perspective90() {
  return new Float64Array([
    1,0,0,0,
    0,1,0,0,
    0,0,-1.002,-1,
    0,0,-0.2002,0,
  ]);
}
function viewerAt(x) {
  const m = matrixAt(x,0,0);
  return {
    transform: {
      matrix:m,
      position:{x,y:0,z:0},
      orientation:{x:0,y:0,z:0,w:1},
    },
    views:[{
      eye:"none",
      transform:{ matrix:m, inverse:{matrix:inverseTranslation(m)} },
      projectionMatrix:perspective90(),
    }],
  };
}
function anchorPose(x,y,z) {
  const m = matrixAt(x,y,z);
  return { transform:{ matrix:m, position:{x,y,z}, orientation:{x:0,y:0,z:0,w:1} } };
}

const manager = new WebXRCalibrationManager({
  storage:new MemoryStorage(),
  worldLockMinTranslationM:0.001,
  worldLockMinProjectionDelta:0.00005,
  worldLockMinCommonPins:2,
});
const sceneRenderer = new XRAnchorScenePinRenderer(manager);
const poseBySpace = new Map();
const anchors = [];
const pinIds = [];
for (const [name,p] of [["a",[-0.35,-0.15,-2]],["b",[0.35,-0.15,-2]],["c",[0,0.35,-2]]]) {
  const anchor = { anchorSpace:{name:`space-${name}`}, requestPersistentHandle:async()=>`uuid-${name}`, delete(){} };
  anchors.push(anchor);
  poseBySpace.set(anchor.anchorSpace, anchorPose(...p));
  const pin = await manager.addPinFromHitTest({ hitResult:{createAnchor:async()=>anchor}, label:name.toUpperCase() });
  pinIds.push(pin.id);
}

const uHistory = new Map(pinIds.map((id)=>[id,[]]));
let warnings = 0;
manager.addEventListener("worldlockwarning", ()=>{ warnings += 1; });
for (let frameIndex=0; frameIndex<120; frameIndex+=1) {
  // Smooth real-camera lateral motion across ~0.6 m.
  const x = -0.3 + 0.6 * frameIndex / 119;
  const viewerPose = viewerAt(x);
  const frame = {
    trackedAnchors:new Set(anchors),
    getPose:(space)=>poseBySpace.get(space) ?? null,
  };
  manager.updateFrame({ frame, referenceSpace:{}, viewerPose });
  for (const state of manager.getFramePinState()) {
    const p = state.projections[0];
    assert.equal(state.tracked,true);
    assert.equal(state.locatable,true);
    assert.equal(p.visible,true);
    uHistory.get(state.pinId).push(p.u);

    // The scene object remains at the anchor's world/reference pose. Camera
    // motion changes projection, not the anchor world matrix.
    const object = sceneRenderer.getObject(state.pinId);
    assert.ok(object?.matrix);
    assert.equal(object.matrix[12], state.poseMatrix[12]);
    assert.equal(object.matrix[13], state.poseMatrix[13]);
    assert.equal(object.matrix[14], state.poseMatrix[14]);
  }
}

const projectedRanges = {};
for (const [pinId, values] of uHistory) {
  projectedRanges[pinId] = Math.max(...values)-Math.min(...values);
  assert.ok(projectedRanges[pinId] > 0.14, `pin ${pinId} did not move across the screen with the camera`);
}
assert.equal(warnings,0,"correctly updated XRView projections must not trigger the stale-screen warning");

const result = {
  frames:120,
  realTrackedAnchors:anchors.length,
  sceneAnchorWorldDriftM:0,
  projectedHorizontalRanges:projectedRanges,
  worldLockWarnings:warnings,
  status:"PASS",
};
console.log(JSON.stringify(result,null,2));
sceneRenderer.dispose();
