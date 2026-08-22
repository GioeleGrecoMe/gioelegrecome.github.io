import test from "node:test";
import assert from "node:assert/strict";
import { XRAnchorScenePinRenderer } from "../src/xr-anchor-scene-renderer.js";

function matrixAt(x, y, z) {
  return [
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    x,y,z,1,
  ];
}

class FakeManager extends EventTarget {
  constructor(states = []) {
    super();
    this.states = states;
  }
  getFramePinState() { return structuredClone(this.states); }
  pushFrame(states) {
    this.states = states;
    this.dispatchEvent(new Event("frameupdate"));
  }
}

function makeThreeLikeObject() {
  return {
    visible: false,
    matrixAutoUpdate: true,
    matrixWorldNeedsUpdate: false,
    matrix: {
      values: null,
      fromArray(values) { this.values = Array.from(values); },
    },
  };
}

test("scene pin renderer applies the live XRAnchor 3D matrix and never screen u/v", () => {
  const manager = new FakeManager();
  const created = [];
  const renderer = new XRAnchorScenePinRenderer(manager, {
    createObject: () => {
      const object = makeThreeLikeObject();
      created.push(object);
      return object;
    },
  });

  manager.pushFrame([{
    pinId: "p1",
    tracked: true,
    locatable: true,
    visible: true,
    poseMatrix: matrixAt(1.25, 0.4, -2.0),
    projections: [{ viewIndex: 0, u: 0.5, v: 0.5 }],
  }]);

  const object = renderer.getObject("p1");
  assert.equal(created.length, 1);
  assert.equal(object.visible, true);
  assert.equal(object.matrixAutoUpdate, false);
  assert.equal(object.matrixWorldNeedsUpdate, true);
  assert.deepEqual(object.matrix.values, matrixAt(1.25, 0.4, -2.0));

  // Change only the screen projection. A correct world-locked scene object must
  // ignore these values and retain exactly the anchor's world transform.
  manager.pushFrame([{
    pinId: "p1",
    tracked: true,
    locatable: true,
    visible: true,
    poseMatrix: matrixAt(1.25, 0.4, -2.0),
    projections: [{ viewIndex: 0, u: 0.1, v: 0.9 }],
  }]);
  assert.deepEqual(object.matrix.values, matrixAt(1.25, 0.4, -2.0));

  renderer.dispose();
});

test("scene pin hides immediately when XRAnchor tracking/pose is lost", () => {
  const manager = new FakeManager();
  const object = makeThreeLikeObject();
  const renderer = new XRAnchorScenePinRenderer(manager, { createObject: () => object });
  manager.pushFrame([{ pinId:"p1", tracked:true, locatable:true, poseMatrix:matrixAt(0,0,-2), projections:[] }]);
  assert.equal(object.visible, true);
  manager.pushFrame([{ pinId:"p1", tracked:false, locatable:false, poseMatrix:null, projections:[] }]);
  assert.equal(object.visible, false);
  renderer.dispose();
});

test("optional reference-to-scene transform is premultiplied before rendering", () => {
  const manager = new FakeManager();
  const object = makeThreeLikeObject();
  const renderer = new XRAnchorScenePinRenderer(manager, {
    createObject: () => object,
    sceneFromReferenceMatrix: matrixAt(10, 0, 0),
  });
  manager.pushFrame([{ pinId:"p1", tracked:true, locatable:true, poseMatrix:matrixAt(1,2,3), projections:[] }]);
  assert.equal(object.matrix.values[12], 11);
  assert.equal(object.matrix.values[13], 2);
  assert.equal(object.matrix.values[14], 3);
  renderer.dispose();
});
