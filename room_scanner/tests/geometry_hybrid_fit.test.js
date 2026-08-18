'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');
const G = require('../roomscan_geometry.js');

const room = {
  id: 'R1',
  height: 2.7,
  footprint: [[0, 0], [4, 0], [4, 3], [0, 3]],
};
room.model = C.buildRoomModel(room.footprint, 0, room.height);
const map = new G.MetricSurfelMap({ voxelSize: 0.03, maxSurfels: 10000 });

for (const wall of room.model.walls) {
  for (let index = 0; index < 80; index += 1) {
    const amount = (index + 0.5) / 80;
    const y = 0.18 + (index % 15) / 15 * 2.35;
    const measuredOffset = 0.08;
    const planar = C.add2(
      C.add2(wall.a, C.mul2(wall.tangent, amount * wall.length)),
      C.mul2(wall.inwardNormal, measuredOffset),
    );
    map.addPoint([planar[0], y, planar[1]], {
      normal: [wall.inwardNormal[0], 0, wall.inwardNormal[1]],
      roomId: room.id,
      viewId: `V${index % 4}`,
      source: 'synthetic-xr-depth',
    });
  }
}
for (let index = 0; index < 50; index += 1) {
  map.addPoint([0.15 + (index % 10) * 0.37, 2.78, 0.15 + Math.floor(index / 10) * 0.55], {
    normal: [0, -1, 0], roomId: room.id, viewId: `C${index % 3}`, source: 'synthetic-ceiling',
  });
}

const fit = G.fitRoomHybrid(room, map.values(), {
  maximumAngleDegrees: 4.5,
  maximumOffset: 0.26,
  maximumCornerShift: 0.38,
});
assert.equal(fit.ok, true);
assert.equal(fit.reverted, false);
assert.ok(fit.meanConfidence > 0.8);
assert.ok(Math.abs(fit.footprint[0][0] - 0.08) < 0.025);
assert.ok(Math.abs(fit.footprint[0][1] - 0.08) < 0.025);
assert.ok(Math.abs(fit.model.area - 10.9056) < 0.12);
assert.ok(fit.ceiling.refined);
assert.ok(Math.abs(fit.ceiling.height - 2.736) < 0.03);
for (let index = 0; index < room.footprint.length; index += 1) {
  assert.ok(C.len2(C.sub2(fit.footprint[index], room.footprint[index])) <= 0.38 + 1e-9);
}

const serialized = map.serialize(400);
const restored = G.MetricSurfelMap.deserialize(serialized);
assert.ok(restored.map.size > 0 && restored.map.size <= 400);
assert.doesNotThrow(() => structuredClone(serialized));

console.log('PASS geometry_hybrid_fit');
