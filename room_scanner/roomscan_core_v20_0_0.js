/*
 * Room Scanner V20.0.0 - metric scene and acoustic surface core
 * ----------------------------------------------------
 * This file intentionally contains only deterministic geometry and data
 * operations. It has no DOM, WebXR, WebGL or neural-network dependency, so it
 * can be unit-tested with Node and reused by the browser application.
 *
 * Design contract:
 *   - one continuous WebXR local-floor reference space is the metric authority;
 *   - room footprints are explicit user-verified polygons in that global space;
 *   - Deep depth may add object evidence, but it never moves room walls;
 *   - objects are bounded voxel components or user-created cuboids;
 *   - every algorithm has bounded memory and predictable complexity.
 */
(function attachRoomScanCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoomScanCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildCore() {
  'use strict';

  const EPS = 1e-9;
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul2 = (a, scale) => [a[0] * scale, a[1] * scale];
  const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
  const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
  const len2 = a => Math.hypot(a[0], a[1]);
  const norm2 = a => {
    const length = len2(a);
    return length > EPS ? [a[0] / length, a[1] / length] : [0, 0];
  };
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul3 = (a, scale) => [a[0] * scale, a[1] * scale, a[2] * scale];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len3 = a => Math.hypot(a[0], a[1], a[2]);
  const norm3 = a => {
    const length = len3(a);
    return length > EPS ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
  };

  function angleWrap(angle) {
    let value = angle;
    while (value > Math.PI) value -= 2 * Math.PI;
    while (value < -Math.PI) value += 2 * Math.PI;
    return value;
  }

  function angleDiff(a, b) {
    return Math.abs(angleWrap(a - b));
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const middle = sorted.length >> 1;
    return sorted.length & 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile(values, q) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const position = clamp(q) * (sorted.length - 1);
    const index = Math.floor(position);
    const fraction = position - index;
    return sorted[index] * (1 - fraction) + sorted[Math.min(sorted.length - 1, index + 1)] * fraction;
  }

  function mad(values, center = median(values)) {
    return Number.isFinite(center)
      ? median(values.map(value => Math.abs(value - center)))
      : NaN;
  }

  // WebXR matrices are column-major, matching WebGL conventions.
  function mat4Point(matrix, point) {
    const x = point[0];
    const y = point[1];
    const z = point[2];
    const w = point[3] ?? 1;
    return [
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
      matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
    ];
  }

  function invert4(matrix) {
    const output = new Array(16);
    const b00 = matrix[0] * matrix[5] - matrix[1] * matrix[4];
    const b01 = matrix[0] * matrix[6] - matrix[2] * matrix[4];
    const b02 = matrix[0] * matrix[7] - matrix[3] * matrix[4];
    const b03 = matrix[1] * matrix[6] - matrix[2] * matrix[5];
    const b04 = matrix[1] * matrix[7] - matrix[3] * matrix[5];
    const b05 = matrix[2] * matrix[7] - matrix[3] * matrix[6];
    const b06 = matrix[8] * matrix[13] - matrix[9] * matrix[12];
    const b07 = matrix[8] * matrix[14] - matrix[10] * matrix[12];
    const b08 = matrix[8] * matrix[15] - matrix[11] * matrix[12];
    const b09 = matrix[9] * matrix[14] - matrix[10] * matrix[13];
    const b10 = matrix[9] * matrix[15] - matrix[11] * matrix[13];
    const b11 = matrix[10] * matrix[15] - matrix[11] * matrix[14];
    let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!determinant) return null;
    determinant = 1 / determinant;
    output[0] = (matrix[5] * b11 - matrix[6] * b10 + matrix[7] * b09) * determinant;
    output[1] = (-matrix[1] * b11 + matrix[2] * b10 - matrix[3] * b09) * determinant;
    output[2] = (matrix[13] * b05 - matrix[14] * b04 + matrix[15] * b03) * determinant;
    output[3] = (-matrix[9] * b05 + matrix[10] * b04 - matrix[11] * b03) * determinant;
    output[4] = (-matrix[4] * b11 + matrix[6] * b08 - matrix[7] * b07) * determinant;
    output[5] = (matrix[0] * b11 - matrix[2] * b08 + matrix[3] * b07) * determinant;
    output[6] = (-matrix[12] * b05 + matrix[14] * b02 - matrix[15] * b01) * determinant;
    output[7] = (matrix[8] * b05 - matrix[10] * b02 + matrix[11] * b01) * determinant;
    output[8] = (matrix[4] * b10 - matrix[5] * b08 + matrix[7] * b06) * determinant;
    output[9] = (-matrix[0] * b10 + matrix[1] * b08 - matrix[3] * b06) * determinant;
    output[10] = (matrix[12] * b04 - matrix[13] * b02 + matrix[15] * b00) * determinant;
    output[11] = (-matrix[8] * b04 + matrix[9] * b02 - matrix[11] * b00) * determinant;
    output[12] = (-matrix[4] * b09 + matrix[5] * b07 - matrix[6] * b06) * determinant;
    output[13] = (matrix[0] * b09 - matrix[1] * b07 + matrix[2] * b06) * determinant;
    output[14] = (-matrix[12] * b03 + matrix[13] * b01 - matrix[14] * b00) * determinant;
    output[15] = (matrix[8] * b03 - matrix[9] * b01 + matrix[10] * b00) * determinant;
    return output;
  }

  function transformPoint(matrix, point) {
    const result = mat4Point(matrix, [point[0], point[1], point[2], 1]);
    return [result[0], result[1], result[2]];
  }

  function projectPoint(projection, worldToView, point) {
    const viewPoint = mat4Point(worldToView, [point[0], point[1], point[2], 1]);
    if (viewPoint[2] >= -1e-4) return null;
    const clip = mat4Point(projection, viewPoint);
    if (Math.abs(clip[3]) < EPS) return null;
    const nx = clip[0] / clip[3];
    const ny = clip[1] / clip[3];
    return {
      u: (nx + 1) / 2,
      v: (1 - ny) / 2,
      depthZ: -viewPoint[2],
      nx,
      ny,
    };
  }

  function rayFromUV(projection, worldFromView, u, v) {
    const px = projection[0];
    const py = projection[5];
    const ox = projection[8];
    const oy = projection[9];
    if (Math.abs(px) < EPS || Math.abs(py) < EPS) return null;
    const nx = 2 * u - 1;
    const ny = 1 - 2 * v;
    const viewDirection = norm3([(nx + ox) / px, (ny + oy) / py, -1]);
    const worldDirection = norm3([
      worldFromView[0] * viewDirection[0] + worldFromView[4] * viewDirection[1] + worldFromView[8] * viewDirection[2],
      worldFromView[1] * viewDirection[0] + worldFromView[5] * viewDirection[1] + worldFromView[9] * viewDirection[2],
      worldFromView[2] * viewDirection[0] + worldFromView[6] * viewDirection[1] + worldFromView[10] * viewDirection[2],
    ]);
    return {
      origin: [worldFromView[12], worldFromView[13], worldFromView[14]],
      direction: worldDirection,
    };
  }

  function worldFromViewDepth(projection, worldFromView, u, v, depthZ) {
    if (!(depthZ > 0)) return null;
    const inverseProjection = invert4(projection);
    if (!inverseProjection) return null;
    const clip = mat4Point(inverseProjection, [2 * u - 1, 1 - 2 * v, -1, 1]);
    if (Math.abs(clip[3]) < EPS) return null;
    const viewRay = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
    if (viewRay[2] >= -1e-5) return null;
    const scale = depthZ / -viewRay[2];
    return transformPoint(worldFromView, [viewRay[0] * scale, viewRay[1] * scale, viewRay[2] * scale]);
  }

  function viewYaw(worldFromView) {
    const forward = [-worldFromView[8], -worldFromView[10]];
    return Math.atan2(forward[1], forward[0]);
  }

  function viewPitch(worldFromView) {
    const forwardY = -worldFromView[9];
    const horizontal = Math.hypot(worldFromView[8], worldFromView[10]);
    return Math.atan2(forwardY, horizontal);
  }

  function horizontalFov(projection) {
    return 2 * Math.atan(1 / Math.max(EPS, Math.abs(projection[0])));
  }

  function rayPlaneY(ray, floorY = 0) {
    if (!ray || Math.abs(ray.direction[1]) < 1e-6) return null;
    const distance = (floorY - ray.origin[1]) / ray.direction[1];
    if (distance <= 0) return null;
    return {
      distance,
      point: add3(ray.origin, mul3(ray.direction, distance)),
    };
  }

  function signedArea(polygon) {
    let area = 0;
    for (let i = 0; i < polygon.length; i += 1) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      area += current[0] * next[1] - next[0] * current[1];
    }
    return area / 2;
  }

  function polygonCentroid(polygon) {
    const area = signedArea(polygon);
    if (Math.abs(area) < EPS) {
      const sum = polygon.reduce((acc, point) => add2(acc, point), [0, 0]);
      return sum.map(value => value / Math.max(1, polygon.length));
    }
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < polygon.length; i += 1) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      const factor = current[0] * next[1] - next[0] * current[1];
      cx += (current[0] + next[0]) * factor;
      cz += (current[1] + next[1]) * factor;
    }
    return [cx / (6 * area), cz / (6 * area)];
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[i];
      const b = polygon[j];
      const intersects = ((a[1] > point[1]) !== (b[1] > point[1]))
        && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] + EPS) + a[0];
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function segmentIntersection(a, b, c, d, inclusive = true) {
    const r = sub2(b, a);
    const s = sub2(d, c);
    const denominator = cross2(r, s);
    if (Math.abs(denominator) < 1e-8) return null;
    const offset = sub2(c, a);
    const t = cross2(offset, s) / denominator;
    const u = cross2(offset, r) / denominator;
    const margin = inclusive ? 1e-6 : 1e-5;
    if (t < -margin || t > 1 + margin || u < -margin || u > 1 + margin) return null;
    return {
      t,
      u,
      point: add2(a, mul2(r, t)),
    };
  }

  function closestPointOnSegment(point, a, b) {
    const edge = sub2(b, a);
    const lengthSquared = dot2(edge, edge);
    const t = lengthSquared > EPS ? clamp(dot2(sub2(point, a), edge) / lengthSquared) : 0;
    const closest = add2(a, mul2(edge, t));
    return { point: closest, t, distance: len2(sub2(point, closest)) };
  }

  function validateFootprint(polygon, options = {}) {
    // V20 accepts recesses, pilasters and nearly coincident corners. Only an
    // effectively zero edge is rejected because it cannot define a stable
    // plane normal or triangulation. This is a numerical epsilon, not a
    // user-facing minimum wall length.
    const minEdge = options.minEdge ?? 1e-5;
    const minArea = options.minArea ?? 1e-7;
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return { ok: false, reason: 'Servono almeno tre angoli.' };
    }
    for (let i = 0; i < polygon.length; i += 1) {
      const edgeLength = len2(sub2(polygon[(i + 1) % polygon.length], polygon[i]));
      if (edgeLength < minEdge) {
        return { ok: false, reason: `Il lato ${i + 1} coincide numericamente con il precedente. Sposta appena il punto.` };
      }
    }
    for (let i = 0; i < polygon.length; i += 1) {
      for (let j = i + 1; j < polygon.length; j += 1) {
        if (j === i || j === (i + 1) % polygon.length || i === (j + 1) % polygon.length) continue;
        if (segmentIntersection(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length], false)) {
          return { ok: false, reason: 'Il perimetro si incrocia.' };
        }
      }
    }
    const area = Math.abs(signedArea(polygon));
    if (area < minArea) return { ok: false, reason: 'Il perimetro ha area praticamente nulla.' };
    return { ok: true, area };
  }

  function buildWalls(polygon, floorY, height) {
    const center = polygonCentroid(polygon);
    return polygon.map((a, index) => {
      const b = polygon[(index + 1) % polygon.length];
      const tangent = norm2(sub2(b, a));
      let inwardNormal = [-tangent[1], tangent[0]];
      if (dot2(inwardNormal, sub2(center, a)) < 0) inwardNormal = mul2(inwardNormal, -1);
      return {
        index,
        a: [...a],
        b: [...b],
        tangent,
        inwardNormal,
        length: len2(sub2(b, a)),
        floorY,
        ceilingY: floorY + height,
      };
    });
  }

  function buildRoomModel(footprint, floorY = 0, height = 2.7) {
    const validation = validateFootprint(footprint);
    if (!validation.ok) throw new Error(validation.reason);
    const polygon = signedArea(footprint) > 0
      ? footprint.map(point => [...point])
      : [...footprint].reverse().map(point => [...point]);
    return {
      footprint: polygon,
      floorY,
      height,
      ceilingY: floorY + height,
      area: Math.abs(signedArea(polygon)),
      centroid: polygonCentroid(polygon),
      walls: buildWalls(polygon, floorY, height),
    };
  }

  function updateRoomHeight(model, height) {
    model.height = height;
    model.ceilingY = model.floorY + height;
    model.walls = buildWalls(model.footprint, model.floorY, height);
    return model;
  }

  function wallPoint(wall, distanceAlong, y) {
    return [
      wall.a[0] + wall.tangent[0] * distanceAlong,
      y,
      wall.a[1] + wall.tangent[1] * distanceAlong,
    ];
  }

  function rayWallHit(ray, wall, minY, maxY) {
    const denominator = wall.inwardNormal[0] * ray.direction[0] + wall.inwardNormal[1] * ray.direction[2];
    if (Math.abs(denominator) < 1e-7) return null;
    const planeConstant = dot2(wall.inwardNormal, wall.a);
    const distance = (planeConstant
      - wall.inwardNormal[0] * ray.origin[0]
      - wall.inwardNormal[1] * ray.origin[2]) / denominator;
    if (distance <= 0) return null;
    const point = add3(ray.origin, mul3(ray.direction, distance));
    const along = dot2([point[0] - wall.a[0], point[2] - wall.a[1]], wall.tangent);
    if (along < -0.03 || along > wall.length + 0.03 || point[1] < minY - 0.03 || point[1] > maxY + 0.03) return null;
    return { distance, point, along, wallIndex: wall.index, kind: 'wall' };
  }

  function rayRoomHit(ray, model) {
    let best = null;
    for (const wall of model.walls) {
      const hit = rayWallHit(ray, wall, model.floorY, model.ceilingY);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    if (ray.direction[1] < -1e-6) {
      const distance = (model.floorY - ray.origin[1]) / ray.direction[1];
      if (distance > 0) {
        const point = add3(ray.origin, mul3(ray.direction, distance));
        if (pointInPolygon([point[0], point[2]], model.footprint) && (!best || distance < best.distance)) {
          best = { distance, point, kind: 'floor' };
        }
      }
    }
    if (ray.direction[1] > 1e-6) {
      const distance = (model.ceilingY - ray.origin[1]) / ray.direction[1];
      if (distance > 0) {
        const point = add3(ray.origin, mul3(ray.direction, distance));
        if (pointInPolygon([point[0], point[2]], model.footprint) && (!best || distance < best.distance)) {
          best = { distance, point, kind: 'ceiling' };
        }
      }
    }
    return best;
  }

  function nearestWallPoint(pointXZ, model) {
    let best = null;
    for (const wall of model.walls) {
      const candidate = closestPointOnSegment(pointXZ, wall.a, wall.b);
      if (!best || candidate.distance < best.distance) {
        best = {
          ...candidate,
          wallIndex: wall.index,
          along: candidate.t * wall.length,
        };
      }
    }
    return best;
  }

  function stablePoint(samples, maxAgeMs = 550) {
    if (!samples.length) return null;
    const newestTime = samples[samples.length - 1].time;
    const recent = samples.filter(sample => newestTime - sample.time <= maxAgeMs && sample.point);
    if (!recent.length) return null;
    const x = median(recent.map(sample => sample.point[0]));
    const y = median(recent.map(sample => sample.point[1]));
    const z = median(recent.map(sample => sample.point[2]));
    const radial = recent.map(sample => Math.hypot(sample.point[0] - x, sample.point[2] - z));
    return {
      point: [x, y, z],
      count: recent.length,
      jitter: quantile(radial, 0.9),
      stable: recent.length >= 4 && quantile(radial, 0.9) <= 0.055,
    };
  }

  function snapFloorCorner(rawPoint, polygon, options = {}) {
    const orthogonal = options.orthogonal !== false;
    const angularTolerance = options.angularTolerance ?? (9 * Math.PI / 180);
    if (!orthogonal || polygon.length < 2) return { point: [...rawPoint], snapped: false, reason: '' };
    const previous = polygon[polygon.length - 1];
    const previousPrevious = polygon[polygon.length - 2];
    const rawEdge = sub2(rawPoint, previous);
    const rawLength = len2(rawEdge);
    if (rawLength < 1e-5) return { point: [...rawPoint], snapped: false, reason: '' };
    const previousDirection = norm2(sub2(previous, previousPrevious));
    const baseAngle = Math.atan2(previousDirection[1], previousDirection[0]);
    const rawAngle = Math.atan2(rawEdge[1], rawEdge[0]);
    const candidates = [baseAngle, baseAngle + Math.PI / 2, baseAngle - Math.PI / 2, baseAngle + Math.PI];
    let best = null;
    for (const angle of candidates) {
      const difference = angleDiff(rawAngle, angle);
      if (!best || difference < best.difference) best = { angle, difference };
    }
    if (!best || best.difference > angularTolerance) return { point: [...rawPoint], snapped: false, reason: '' };
    const direction = [Math.cos(best.angle), Math.sin(best.angle)];
    const projectedLength = Math.max(1e-5, dot2(rawEdge, direction));
    return {
      point: add2(previous, mul2(direction, projectedLength)),
      snapped: true,
      reason: best.difference < angularTolerance * 0.45 ? 'allineata' : 'ortogonale',
    };
  }

  function pathBoundaryCrossing(path, model) {
    if (!model || path.length < 2) return null;
    let firstAny = null;
    for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
      const previous = path[pathIndex - 1];
      const current = path[pathIndex];
      const wasInside = pointInPolygon(previous, model.footprint);
      const isInside = pointInPolygon(current, model.footprint);
      for (const wall of model.walls) {
        const crossing = segmentIntersection(previous, current, wall.a, wall.b, true);
        if (!crossing) continue;
        const result = {
          point: crossing.point,
          wallIndex: wall.index,
          pathIndex,
          pathT: crossing.t,
          wallT: crossing.u,
          direction: norm2(sub2(current, previous)),
          wasInside,
          isInside,
          kind: wasInside && !isInside ? 'exit' : (!wasInside && isInside ? 'entry' : 'crossing'),
        };
        if (result.kind === 'exit') return result;
        if (!firstAny) firstAny = result;
      }
    }
    return firstAny;
  }

  function createPortalFromCrossing(room, crossing, width = 0.95, top = 2.1) {
    if (!room?.model || !crossing) return null;
    const wall = room.model.walls[crossing.wallIndex];
    if (!wall) return null;
    const centerAlong = clamp(crossing.wallT, 0, 1) * wall.length;
    // Doorways may touch a measured corner. The previous six-centimetre
    // safety margin made short returns and recesses impossible to represent.
    const safeWidth = clamp(width, 0.10, Math.max(0.10, wall.length));
    let s0 = centerAlong - safeWidth / 2;
    let s1 = centerAlong + safeWidth / 2;
    if (s0 < 0) {
      s1 -= s0;
      s0 = 0;
    }
    if (s1 > wall.length) {
      s0 -= s1 - wall.length;
      s1 = wall.length;
    }
    s0 = clamp(s0, 0, wall.length);
    s1 = clamp(s1, 0, wall.length);
    return {
      id: null,
      width: Math.max(0.05, s1 - s0),
      top: clamp(top, 1.65, room.model.height),
      status: 'open',
      sourceRoomId: room.id,
      targetRoomId: null,
      sides: [{ roomId: room.id, wallIndex: wall.index, s0, s1 }],
      crossing: [...crossing.point],
      confidence: crossing.kind === 'exit' ? 0.9 : 0.55,
    };
  }

  function portalSideSegment(room, side) {
    const wall = room?.model?.walls?.[side.wallIndex];
    if (!wall) return null;
    return {
      a: [wall.a[0] + wall.tangent[0] * side.s0, wall.a[1] + wall.tangent[1] * side.s0],
      b: [wall.a[0] + wall.tangent[0] * side.s1, wall.a[1] + wall.tangent[1] * side.s1],
      midpoint: [
        wall.a[0] + wall.tangent[0] * (side.s0 + side.s1) / 2,
        wall.a[1] + wall.tangent[1] * (side.s0 + side.s1) / 2,
      ],
      wall,
    };
  }

  function linkPortalToRoom(portal, rooms, targetRoom, options = {}) {
    if (!portal?.sides?.length || !targetRoom?.model) return { ok: false, reason: 'Dati passaggio incompleti.' };
    const sourceRoom = rooms.find(room => room.id === portal.sides[0].roomId);
    const sourceSegment = portalSideSegment(sourceRoom, portal.sides[0]);
    if (!sourceSegment) return { ok: false, reason: 'Parete sorgente non trovata.' };
    const maxDistance = options.maxDistance ?? 0.45;
    const maxAngle = options.maxAngle ?? (18 * Math.PI / 180);
    let best = null;
    for (const wall of targetRoom.model.walls) {
      const angleA = Math.atan2(sourceSegment.wall.tangent[1], sourceSegment.wall.tangent[0]);
      const angleB = Math.atan2(wall.tangent[1], wall.tangent[0]);
      const parallelError = Math.min(angleDiff(angleA, angleB), angleDiff(angleA, angleB + Math.PI));
      if (parallelError > maxAngle) continue;
      const nearest = closestPointOnSegment(sourceSegment.midpoint, wall.a, wall.b);
      if (nearest.distance > maxDistance) continue;
      const halfWidth = portal.width / 2;
      const centerAlong = nearest.t * wall.length;
      const s0 = clamp(centerAlong - halfWidth, 0, wall.length);
      const s1 = clamp(centerAlong + halfWidth, 0, wall.length);
      const widthError = Math.abs((s1 - s0) - portal.width);
      const score = nearest.distance + 0.45 * parallelError + 0.6 * widthError;
      if (!best || score < best.score) best = { wall, nearest, s0, s1, score, parallelError };
    }
    if (!best) return { ok: false, reason: 'Nessuna parete compatibile nel nuovo vano.' };
    portal.targetRoomId = targetRoom.id;
    portal.sides = portal.sides.filter(side => side.roomId !== targetRoom.id);
    portal.sides.push({ roomId: targetRoom.id, wallIndex: best.wall.index, s0: best.s0, s1: best.s1 });
    portal.confidence = clamp(1 - best.score / 0.8, 0.25, 0.96);
    return { ok: true, score: best.score, wallIndex: best.wall.index };
  }

  function coverageBins(count = 12) {
    return { count, values: new Float32Array(count) };
  }

  function markAngularCoverage(coverage, yaw, fov, quality = 1) {
    const half = Math.max(0.08, fov * 0.46);
    for (let index = 0; index < coverage.count; index += 1) {
      const binYaw = -Math.PI + (index + 0.5) * 2 * Math.PI / coverage.count;
      const distance = angleDiff(binYaw, yaw);
      if (distance > half) continue;
      const edgeWeight = 1 - distance / half;
      coverage.values[index] = Math.max(coverage.values[index], clamp((0.55 + 0.45 * edgeWeight) * quality));
    }
  }

  function angularCoverageFraction(coverage, threshold = 0.52) {
    if (!coverage?.values?.length) return 0;
    let covered = 0;
    for (const value of coverage.values) if (value >= threshold) covered += 1;
    return covered / coverage.values.length;
  }

  /* ---------------------------------------------------------------------
   * Wall-attached photo targets
   * ------------------------------------------------------------------ */

  function createWallPhotoTargets(model, options = {}) {
    if (!model?.walls?.length) return [];
    const desiredWidth = Math.max(0.08, options.desiredWidth ?? 1.35);
    const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? 4));
    const verticalOverlap = Math.max(0, options.verticalOverlap ?? 0.08);
    const floorMargin = Math.min(0.20, Math.max(0.08, options.floorMargin ?? 0.14));
    const ceilingMargin = Math.min(0.20, Math.max(0.08, options.ceilingMargin ?? 0.14));
    const bottom = model.floorY + Math.min(floorMargin, model.height * 0.12);
    const top = model.ceilingY - Math.min(ceilingMargin, model.height * 0.10);
    const split = clamp(
      model.floorY + Math.min(1.45, model.height * 0.58),
      bottom + 0.45,
      top - 0.45,
    );
    const rows = top - bottom >= 1.05
      ? [
        {
          role: 'objects',
          requiredViews: Math.max(1, Math.floor(options.objectRequiredViews ?? 2)),
          y0: bottom,
          y1: Math.min(top, split + verticalOverlap / 2),
        },
        {
          role: 'surface',
          requiredViews: Math.max(1, Math.floor(options.surfaceRequiredViews ?? 1)),
          y0: Math.max(bottom, split - verticalOverlap / 2),
          y1: top,
        },
      ]
      : [{ role: 'mixed', requiredViews: 1, y0: bottom, y1: top }];

    const targets = [];
    for (const wall of model.walls) {
      // A very short wall still receives one target. The margin scales down so
      // the target remains physically attached to the measured wall segment.
      const edgeMargin = Math.min(options.edgeMargin ?? 0.03, wall.length * 0.04);
      const usable = Math.max(1e-5, wall.length - 2 * edgeMargin);
      const columns = clamp(Math.ceil(usable / desiredWidth), 1, maxColumns);
      const columnWidth = usable / columns;
      for (let column = 0; column < columns; column += 1) {
        const s0 = edgeMargin + column * columnWidth;
        const s1 = column === columns - 1
          ? wall.length - edgeMargin
          : edgeMargin + (column + 1) * columnWidth;
        for (let row = 0; row < rows.length; row += 1) {
          const band = rows[row];
          const centerS = (s0 + s1) / 2;
          const centerY = (band.y0 + band.y1) / 2;
          targets.push({
            id: `W${wall.index}-C${column}-R${row}`,
            wallIndex: wall.index,
            column,
            row,
            role: band.role,
            requiredViews: band.requiredViews,
            s0,
            s1,
            y0: band.y0,
            y1: band.y1,
            center: wallPoint(wall, centerS, centerY),
            corners: [
              wallPoint(wall, s0, band.y0),
              wallPoint(wall, s1, band.y0),
              wallPoint(wall, s1, band.y1),
              wallPoint(wall, s0, band.y1),
            ],
            inwardNormal: [...wall.inwardNormal],
            observations: [],
            bestScore: 0,
            status: 'red',
          });
        }
      }
    }
    return targets;
  }

  function polygonArea2D(points) {
    if (!points?.length || points.length < 3) return 0;
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current[0] * next[1] - next[0] * current[1];
    }
    return Math.abs(area) / 2;
  }

  function evaluatePhotoTarget(target, projection, worldToView, cameraPosition, options = {}) {
    if (!target?.center || !projection || !worldToView || !cameraPosition) {
      return { visible: false, acquirable: false, centered: false, good: false, score: 0 };
    }
    const center = projectPoint(projection, worldToView, target.center);
    if (!center) return { visible: false, acquirable: false, centered: false, good: false, score: 0 };
    const corners = (target.corners || []).map(point => projectPoint(projection, worldToView, point));
    const projected = corners.filter(Boolean);
    const polygon = projected.map(point => [point.u, point.v]);
    const rawArea = projected.length === corners.length ? polygonArea2D(polygon) : 0;
    const minU = projected.length ? Math.min(...projected.map(point => point.u)) : center.u;
    const maxU = projected.length ? Math.max(...projected.map(point => point.u)) : center.u;
    const minV = projected.length ? Math.min(...projected.map(point => point.v)) : center.v;
    const maxV = projected.length ? Math.max(...projected.map(point => point.v)) : center.v;
    const clippedWidth = Math.max(0, Math.min(1, maxU) - Math.max(0, minU));
    const clippedHeight = Math.max(0, Math.min(1, maxV) - Math.max(0, minV));
    const clippedArea = clippedWidth * clippedHeight;
    const visibleFraction = rawArea > EPS ? clamp(clippedArea / rawArea) : 0;
    const toCamera2 = [cameraPosition[0] - target.center[0], cameraPosition[2] - target.center[2]];
    const planarLength = len2(toCamera2);
    const facing = planarLength > EPS
      ? dot2(target.inwardNormal || [0, 0], mul2(toCamera2, 1 / planarLength))
      : 1;
    const distance = len3(sub3(cameraPosition, target.center));
    const centerRadius = Math.hypot((center.u - 0.5) * 2, (center.v - 0.5) * 2);
    const centerInside = center.u >= -0.04 && center.u <= 1.04 && center.v >= -0.04 && center.v <= 1.04;
    const visible = center.depthZ > 0 && clippedArea > 0 && maxU >= 0 && minU <= 1 && maxV >= 0 && minV <= 1;
    const worldArea = Math.max(1e-8, Math.abs((target.s1 ?? 0) - (target.s0 ?? 0)) * Math.abs((target.y1 ?? 0) - (target.y0 ?? 0)));
    // A narrow wall return must remain capturable. Scale the normalized-screen
    // threshold down for physically small targets instead of enforcing the
    // old fixed area that could never be reached.
    const minArea = options.minArea ?? Math.min(0.009, Math.max(1e-6, worldArea * 0.0025));
    const acquirable = visible
      && centerInside
      && facing >= (options.minFacing ?? 0.08)
      && distance >= (options.minDistance ?? 0.05)
      && distance <= (options.maxDistance ?? 7.5)
      && clippedArea >= minArea
      && visibleFraction >= (options.minVisibleFraction ?? 0.12);
    const centered = acquirable && centerRadius <= (options.maxCenterRadius ?? 0.72);
    const centerScore = clamp(1 - centerRadius * 0.72);
    const adaptiveReferenceArea = Math.min(0.055, Math.max(2e-5, worldArea * 0.014));
    const areaScore = clamp(Math.sqrt(clippedArea / (options.referenceArea ?? adaptiveReferenceArea)));
    const facingScore = clamp((facing - 0.12) / 0.78);
    const distanceScore = distance <= 4.2 ? 1 : clamp(1 - (distance - 4.2) / 3.3);
    const viewScore = clamp(0.30 * centerScore + 0.28 * areaScore + 0.28 * facingScore + 0.14 * distanceScore);
    const quality = clamp(options.quality ?? 1);
    const score = viewScore * (0.55 + 0.45 * quality);
    return {
      visible,
      acquirable,
      centered,
      good: centered && score >= (options.minimumScore ?? 0.43),
      score,
      viewScore,
      quality,
      facing,
      distance,
      centerRadius,
      visibleFraction,
      clippedArea,
      rawArea,
      center,
      corners,
      bounds: { minU, maxU, minV, maxV },
    };
  }

  function photoTargetViewIds(target) {
    return new Set((target?.observations || []).map(observation => (
      observation.viewCluster ?? `frame:${observation.frameId}`
    )));
  }

  function photoTargetStatus(target) {
    const views = photoTargetViewIds(target).size;
    if (!views) return 'red';
    return views >= Math.max(1, target?.requiredViews || 1) ? 'green' : 'yellow';
  }

  function photoTargetProgress(target) {
    const required = Math.max(1, target?.requiredViews || 1);
    return clamp(photoTargetViewIds(target).size / required);
  }

  function registerPhotoTargetObservation(target, observation) {
    if (!target || !observation) return false;
    if (!Array.isArray(target.observations)) target.observations = [];
    const viewKey = observation.viewCluster ?? `frame:${observation.frameId}`;
    if (target.observations.some(item => (item.viewCluster ?? `frame:${item.frameId}`) === viewKey)) {
      target.status = photoTargetStatus(target);
      return false;
    }
    target.observations.push({
      frameId: observation.frameId,
      viewCluster: observation.viewCluster ?? null,
      score: observation.score ?? 0,
      distance: observation.distance ?? null,
      capturedAt: observation.capturedAt ?? null,
    });
    // Keeping only a few best, spatially distinct views prevents a long scan
    // from growing every target indefinitely while preserving all evidence
    // needed for the red/yellow/green state.
    target.observations.sort((a, b) => (b.score || 0) - (a.score || 0));
    target.observations = target.observations.slice(0, 6);
    target.bestScore = Math.max(target.bestScore || 0, observation.score || 0);
    target.status = photoTargetStatus(target);
    return true;
  }

  function registerFramePhotoTargets(targets, frame, options = {}) {
    if (!targets?.length || !frame?.projection || !frame?.worldToView || !frame?.worldFromView) {
      return { observed: 0, greened: 0 };
    }
    const cameraPosition = [frame.worldFromView[12], frame.worldFromView[13], frame.worldFromView[14]];
    let observed = 0;
    let greened = 0;
    for (const target of targets) {
      const before = photoTargetStatus(target);
      const evaluation = evaluatePhotoTarget(target, frame.projection, frame.worldToView, cameraPosition, {
        ...options,
        quality: frame.quality ?? 1,
      });
      if (!evaluation.good) continue;
      const added = registerPhotoTargetObservation(target, {
        frameId: frame.id,
        viewCluster: frame.viewCluster,
        score: evaluation.score,
        distance: evaluation.distance,
        capturedAt: frame.createdAt,
      });
      if (!added) continue;
      observed += 1;
      if (before !== 'green' && photoTargetStatus(target) === 'green') greened += 1;
    }
    return { observed, greened };
  }

  function photoTargetStats(targets) {
    const stats = { total: 0, red: 0, yellow: 0, green: 0, progress: 0 };
    for (const target of targets || []) {
      const status = photoTargetStatus(target);
      target.status = status;
      stats.total += 1;
      stats[status] += 1;
      stats.progress += photoTargetProgress(target);
    }
    stats.progress = stats.total ? stats.progress / stats.total : 0;
    return stats;
  }

  function viewClusterId(worldFromView, cellSize = 0.38) {
    const x = Math.round(worldFromView[12] / cellSize);
    const y = Math.round(worldFromView[13] / Math.max(0.5, cellSize * 1.8));
    const z = Math.round(worldFromView[14] / cellSize);
    return `${x}:${y}:${z}`;
  }

  function robustLinearRegression(samples, transform) {
    if (samples.length < 7) return null;
    let active = samples
      .map(sample => ({ ...sample, x: transform(sample.relative) }))
      .filter(sample => Number.isFinite(sample.x) && Number.isFinite(sample.metric));
    if (active.length < 7) return null;
    let slope = 1;
    let intercept = 0;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (const sample of active) {
        const weight = Math.max(0.02, sample.weight ?? 1);
        sw += weight;
        sx += weight * sample.x;
        sy += weight * sample.metric;
        sxx += weight * sample.x * sample.x;
        sxy += weight * sample.x * sample.metric;
      }
      const denominator = sw * sxx - sx * sx;
      if (Math.abs(denominator) < 1e-9) return null;
      slope = (sw * sxy - sx * sy) / denominator;
      intercept = (sy - slope * sx) / sw;
      const residuals = active.map(sample => Math.abs(slope * sample.x + intercept - sample.metric));
      const center = median(residuals);
      const robustScale = Math.max(0.02, 1.4826 * (mad(residuals, center) || center || 0.02));
      const cutoff = Math.max(0.07, center + 2.8 * robustScale);
      active = active.filter(sample => Math.abs(slope * sample.x + intercept - sample.metric) <= cutoff);
      if (active.length < 7) return null;
    }
    const residuals = active.map(sample => Math.abs(slope * sample.x + intercept - sample.metric));
    return {
      slope,
      intercept,
      count: active.length,
      medianError: median(residuals),
      p90Error: quantile(residuals, 0.9),
    };
  }

  function fitRelativeDepth(samples) {
    const direct = robustLinearRegression(samples, value => value);
    const inverse = robustLinearRegression(samples, value => 1 / Math.max(Math.abs(value), 1e-6));
    const score = fit => fit
      ? fit.medianError + 0.28 * fit.p90Error + 0.25 / Math.sqrt(Math.max(1, fit.count))
      : Infinity;
    const best = score(inverse) < score(direct)
      ? { ...inverse, mode: 'inverse' }
      : { ...direct, mode: 'direct' };
    return Number.isFinite(best.medianError) ? best : null;
  }

  function metricDepth(fit, relative) {
    if (!fit || !Number.isFinite(relative)) return NaN;
    const x = fit.mode === 'inverse'
      ? 1 / Math.max(Math.abs(relative), 1e-6)
      : relative;
    return fit.slope * x + fit.intercept;
  }

  function voxelKey(point, size) {
    return `${Math.floor(point[0] / size + 1e-7)},${Math.floor(point[1] / size + 1e-7)},${Math.floor(point[2] / size + 1e-7)}`;
  }

  function parseVoxelKey(key) {
    return key.split(',').map(Number);
  }

  function mergeVoxel(map, point, observation, size = 0.06) {
    const key = voxelKey(point, size);
    const weight = Math.max(0.02, observation.weight ?? 1);
    const existing = map.get(key);
    const viewId = observation.viewId ?? observation.frameId;
    if (!existing) {
      const created = {
        key,
        point: [...point],
        color: [...(observation.color || [180, 190, 200])],
        weight,
        xrCount: observation.source === 'XR' ? 1 : 0,
        deepCount: observation.source === 'Deep' ? 1 : 0,
        viewIds: new Set(viewId != null ? [viewId] : []),
        roomIds: new Set(observation.roomId != null ? [observation.roomId] : []),
      };
      map.set(key, created);
      return created;
    }
    const combinedWeight = existing.weight + weight;
    existing.point = [0, 1, 2].map(index => (existing.point[index] * existing.weight + point[index] * weight) / combinedWeight);
    existing.color = [0, 1, 2].map(index => Math.round((existing.color[index] * existing.weight + (observation.color?.[index] ?? existing.color[index]) * weight) / combinedWeight));
    existing.weight = combinedWeight;
    if (observation.source === 'XR') existing.xrCount += 1;
    if (observation.source === 'Deep') existing.deepCount += 1;
    if (viewId != null) existing.viewIds.add(viewId);
    if (observation.roomId != null) existing.roomIds.add(observation.roomId);
    return existing;
  }

  function connectedVoxelComponents(map, size = 0.06, minVoxels = 8) {
    // Neural depth is metric only after a robust fit and two views rarely land
    // in the exact same 6 cm voxel. Requiring evidence in the identical voxel
    // made real furniture disappear. We therefore validate evidence over the
    // local 3 x 3 x 3 neighborhood, while still requiring distinct view IDs or
    // complementary XR + Deep evidence in the same room context.
    const neighborhood = [];
    const neighbors = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          neighborhood.push([dx, dy, dz]);
          if (dx || dy || dz) neighbors.push([dx, dy, dz]);
        }
      }
    }

    const hasRoom = (voxel, roomId) => roomId == null
      || !voxel.roomIds?.size
      || voxel.roomIds.has(roomId);
    const sharesRoom = (a, b) => {
      if (!a.roomIds?.size || !b.roomIds?.size) return true;
      for (const roomId of a.roomIds) if (b.roomIds.has(roomId)) return true;
      return false;
    };
    const hasPersistentEvidence = (key, voxel) => {
      const index = parseVoxelKey(key);
      const roomContexts = voxel.roomIds?.size ? [...voxel.roomIds] : [null];
      for (const roomId of roomContexts) {
        const viewIds = new Set();
        let xrCount = 0;
        let deepCount = 0;
        for (const offset of neighborhood) {
          const neighborKey = `${index[0] + offset[0]},${index[1] + offset[1]},${index[2] + offset[2]}`;
          const neighbor = map.get(neighborKey);
          if (!neighbor || !hasRoom(neighbor, roomId)) continue;
          for (const viewId of neighbor.viewIds || []) viewIds.add(viewId);
          xrCount += neighbor.xrCount || 0;
          deepCount += neighbor.deepCount || 0;
        }
        if (viewIds.size >= 2 || (xrCount > 0 && deepCount > 0)) return true;
      }
      return false;
    };

    const retained = new Map([...map].filter(([key, voxel]) => hasPersistentEvidence(key, voxel)));
    const visited = new Set();
    const components = [];
    for (const [startKey] of retained) {
      if (visited.has(startKey)) continue;
      const queue = [startKey];
      const component = [];
      visited.add(startKey);
      while (queue.length) {
        const key = queue.pop();
        const voxel = retained.get(key);
        component.push(voxel);
        const index = parseVoxelKey(key);
        for (const offset of neighbors) {
          const neighborKey = `${index[0] + offset[0]},${index[1] + offset[1]},${index[2] + offset[2]}`;
          const neighbor = retained.get(neighborKey);
          if (neighbor && sharesRoom(voxel, neighbor) && !visited.has(neighborKey)) {
            visited.add(neighborKey);
            queue.push(neighborKey);
          }
        }
      }
      if (component.length >= minVoxels) components.push(component);
    }
    return components;
  }

  function pcaYaw(points) {
    if (points.length < 2) return 0;
    const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const meanZ = points.reduce((sum, point) => sum + point[2], 0) / points.length;
    let xx = 0;
    let xz = 0;
    let zz = 0;
    for (const point of points) {
      const x = point[0] - meanX;
      const z = point[2] - meanZ;
      xx += x * x;
      xz += x * z;
      zz += z * z;
    }
    return 0.5 * Math.atan2(2 * xz, xx - zz);
  }

  function objectFromVoxels(voxels, id, size = 0.06) {
    const points = voxels.map(voxel => voxel.point);
    const yaw = pcaYaw(points);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const local = points.map(point => [
      cos * point[0] + sin * point[2],
      point[1],
      -sin * point[0] + cos * point[2],
    ]);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of local) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    const localCenter = min.map((value, axis) => (value + max[axis]) / 2);
    const center = [
      cos * localCenter[0] - sin * localCenter[2],
      localCenter[1],
      sin * localCenter[0] + cos * localCenter[2],
    ];
    const extent = max.map((value, axis) => Math.max(size, value - min[axis] + size));
    const confidenceSum = voxels.reduce((sum, voxel) => sum
      + (voxel.xrCount > 0 ? 0.75 : 0)
      + (voxel.deepCount > 0 ? 0.45 : 0)
      + Math.min(0.4, voxel.viewIds.size * 0.12), 0);
    const roomVotes = new Map();
    for (const voxel of voxels) {
      for (const roomId of voxel.roomIds || []) roomVotes.set(roomId, (roomVotes.get(roomId) || 0) + 1);
    }
    const roomId = [...roomVotes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const rgbMean = [0, 1, 2].map(channel => Math.round(voxels.reduce((sum, voxel) => sum + (voxel.color?.[channel] ?? 180), 0) / Math.max(1, voxels.length)));
    const occupiedVolume = voxels.length * size ** 3;
    const obbVolume = extent[0] * extent[1] * extent[2];
    const obb = { center, extent, yaw };
    const mesh = assignMeshAcousticFaces(voxelSurfaceMesh(voxels, size), obb);
    return {
      id,
      roomId,
      name: `Oggetto ${id}`,
      kind: 'scan',
      status: 'active',
      hidden: false,
      confidence: clamp(confidenceSum / Math.max(1, voxels.length * 1.3)),
      obb,
      rgbSummary: { mean: rgbMean, pointCount: voxels.length },
      shape: {
        representation: 'colored-voxel-surface',
        voxelSize: size,
        occupiedVolume,
        obbVolume,
        fillRatio: clamp(occupiedVolume / Math.max(size ** 3, obbVolume)),
      },
      points: voxels.map(voxel => ({
        point: [...voxel.point],
        color: [...voxel.color],
        xrCount: voxel.xrCount,
        deepCount: voxel.deepCount,
      })),
      mesh,
    };
  }

  function voxelSurfaceMesh(voxels, size = 0.06) {
    const set = new Set(voxels.map(voxel => voxel.key));
    const vertices = [];
    const indices = [];
    const colors = [];
    const faces = [
      [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
      [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
      [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
      [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
      [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
      [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
    ];
    for (const voxel of voxels) {
      const index = parseVoxelKey(voxel.key);
      const base = [index[0] * size, index[1] * size, index[2] * size];
      for (const [normal, corners] of faces) {
        const neighborKey = `${index[0] + normal[0]},${index[1] + normal[1]},${index[2] + normal[2]}`;
        if (set.has(neighborKey)) continue;
        const offset = vertices.length;
        for (const corner of corners) {
          vertices.push([
            base[0] + corner[0] * size,
            base[1] + corner[1] * size,
            base[2] + corner[2] * size,
          ]);
          // Keep the observed RGB on the approximate voxel surface. This lets
          // the lightweight viewer and downstream exporters show what occupied
          // the volume instead of displaying an anonymous orange box.
          colors.push([...(voxel.color || [180, 190, 200])]);
        }
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      }
    }
    return { vertices, indices, colors };
  }

  function boxMesh(center, extent, yaw = 0) {
    const half = extent.map(value => value / 2);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localCorners = [
      [-half[0], -half[1], -half[2]], [half[0], -half[1], -half[2]],
      [half[0], half[1], -half[2]], [-half[0], half[1], -half[2]],
      [-half[0], -half[1], half[2]], [half[0], -half[1], half[2]],
      [half[0], half[1], half[2]], [-half[0], half[1], half[2]],
    ];
    const vertices = localCorners.map(point => [
      center[0] + cos * point[0] - sin * point[2],
      center[1] + point[1],
      center[2] + sin * point[0] + cos * point[2],
    ]);
    const indices = [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      3, 2, 6, 3, 6, 7,
      1, 5, 6, 1, 6, 2,
      0, 3, 7, 0, 7, 4,
    ];
    return { vertices, indices };
  }

  function assignMeshAcousticFaces(mesh, obb) {
    if (!mesh?.vertices?.length || !mesh?.indices?.length || !obb?.center) return mesh;
    const cosine = Math.cos(obb.yaw || 0);
    const sine = Math.sin(obb.yaw || 0);
    const keys = [];
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const a = mesh.vertices[mesh.indices[index]];
      const b = mesh.vertices[mesh.indices[index + 1]];
      const c = mesh.vertices[mesh.indices[index + 2]];
      const ab = sub3(b, a);
      const ac = sub3(c, a);
      const normalWorld = norm3([
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ]);
      const normalLocal = [
        cosine * normalWorld[0] + sine * normalWorld[2],
        normalWorld[1],
        -sine * normalWorld[0] + cosine * normalWorld[2],
      ];
      const centroid = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      const centroidLocal = obbPointToLocal(centroid, obb);
      let axis = 0;
      if (Math.abs(normalLocal[1]) > Math.abs(normalLocal[axis])) axis = 1;
      if (Math.abs(normalLocal[2]) > Math.abs(normalLocal[axis])) axis = 2;
      let sign = Math.sign(normalLocal[axis]) || Math.sign(centroidLocal[axis]) || 1;
      // Some imported/box meshes use reversed triangle winding. The centroid
      // sign is a stable fallback for assigning the triangle to an OBB side.
      if (Math.abs(centroidLocal[axis]) > Math.max(1e-6, (obb.extent?.[axis] || 0) * 0.08)) {
        sign = Math.sign(centroidLocal[axis]) || sign;
      }
      keys.push(axis === 1
        ? (sign > 0 ? 'top' : 'bottom')
        : axis === 0
          ? (sign > 0 ? 'right' : 'left')
          : (sign > 0 ? 'back' : 'front'));
    }
    mesh.triangleFaceKeys = keys;
    mesh.acousticPartition = 'obb-six-face-labels';
    return mesh;
  }

  function obbPointToLocal(point, obb) {
    const yaw = obb?.yaw || 0;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const dx = point[0] - obb.center[0];
    const dz = point[2] - obb.center[2];
    return [
      cosine * dx + sine * dz,
      point[1] - obb.center[1],
      -sine * dx + cosine * dz,
    ];
  }

  function obbLocalToPoint(local, obb) {
    const yaw = obb?.yaw || 0;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    return [
      obb.center[0] + cosine * local[0] - sine * local[2],
      obb.center[1] + local[1],
      obb.center[2] + sine * local[0] + cosine * local[2],
    ];
  }

  function transformPointsBetweenObbs(points, fromObb, toObb) {
    if (!Array.isArray(points) || !fromObb?.extent || !toObb?.extent) return [];
    return points.map(item => {
      const local = obbPointToLocal(item.point, fromObb);
      const normalized = local.map((value, axis) => value / Math.max(0.001, fromObb.extent[axis]));
      const transformed = obbLocalToPoint(normalized.map((value, axis) => value * toObb.extent[axis]), toObb);
      return { ...item, point: transformed, color: [...(item.color || [190, 170, 125])] };
    });
  }

  function boxSurfacePoints(center, extent, yaw = 0, spacing = 0.12, color = [196, 166, 118]) {
    const half = extent.map(value => Math.max(0.001, value) / 2);
    const points = [];
    const seen = new Set();
    const add = local => {
      const point = obbLocalToPoint(local, { center, extent, yaw });
      const key = point.map(value => Math.round(value * 1000)).join(',');
      if (seen.has(key)) return;
      seen.add(key);
      points.push({ point, color: [...color], xrCount: 0, deepCount: 0, synthetic: true });
    };
    const steps = length => Math.max(1, Math.min(18, Math.ceil(length / Math.max(0.04, spacing))));
    const sampleFace = (fixedAxis, fixedValue, axisA, axisB) => {
      const countA = steps(extent[axisA]);
      const countB = steps(extent[axisB]);
      for (let a = 0; a <= countA; a += 1) {
        for (let b = 0; b <= countB; b += 1) {
          const local = [0, 0, 0];
          local[fixedAxis] = fixedValue;
          local[axisA] = -half[axisA] + extent[axisA] * a / countA;
          local[axisB] = -half[axisB] + extent[axisB] * b / countB;
          add(local);
        }
      }
    };
    sampleFace(0, -half[0], 1, 2);
    sampleFace(0, half[0], 1, 2);
    sampleFace(1, -half[1], 0, 2);
    sampleFace(1, half[1], 0, 2);
    sampleFace(2, -half[2], 0, 1);
    sampleFace(2, half[2], 0, 1);
    return points;
  }

  function createManualObject(id, name, cornerA, cornerB, floorY = 0, height = 0.8) {
    const minX = Math.min(cornerA[0], cornerB[0]);
    const maxX = Math.max(cornerA[0], cornerB[0]);
    const minZ = Math.min(cornerA[1], cornerB[1]);
    const maxZ = Math.max(cornerA[1], cornerB[1]);
    const extent = [Math.max(0.12, maxX - minX), Math.max(0.12, height), Math.max(0.12, maxZ - minZ)];
    const center = [(minX + maxX) / 2, floorY + extent[1] / 2, (minZ + maxZ) / 2];
    const obb = { center, extent, yaw: 0 };
    const points = boxSurfacePoints(center, extent, 0);
    const mesh = assignMeshAcousticFaces(boxMesh(center, extent, 0), obb);
    return {
      id,
      name: name || `Oggetto ${id}`,
      kind: 'manual',
      status: 'active',
      hidden: false,
      confidence: 1,
      obb,
      rgbSummary: { mean: [196, 166, 118], pointCount: points.length, synthetic: true },
      shape: { representation: 'manual-rgb-cuboid', voxelSize: null, occupiedVolume: extent[0] * extent[1] * extent[2], obbVolume: extent[0] * extent[1] * extent[2], fillRatio: 1 },
      // Manual objects have no measured texture, but still expose a clearly
      // flagged synthetic RGB shell so their occupied volume is visible in
      // the same point-cloud layer as scanned objects.
      points,
      mesh,
    };
  }

  function triangulatePolygon(polygon) {
    if (polygon.length < 3) return [];
    const ccw = signedArea(polygon) > 0;
    const indices = [...polygon.keys()];
    const triangles = [];
    const triangleArea = (a, b, c) => cross2(sub2(b, a), sub2(c, a));
    const insideTriangle = (point, a, b, c) => {
      const x = triangleArea(a, b, point);
      const y = triangleArea(b, c, point);
      const z = triangleArea(c, a, point);
      const hasNegative = x < 0 || y < 0 || z < 0;
      const hasPositive = x > 0 || y > 0 || z > 0;
      return !(hasNegative && hasPositive);
    };
    let guard = 0;
    while (indices.length > 3 && guard < 10000) {
      guard += 1;
      let cut = false;
      for (let cursor = 0; cursor < indices.length; cursor += 1) {
        const ia = indices[(cursor - 1 + indices.length) % indices.length];
        const ib = indices[cursor];
        const ic = indices[(cursor + 1) % indices.length];
        const a = polygon[ia];
        const b = polygon[ib];
        const c = polygon[ic];
        const area = triangleArea(a, b, c);
        if (ccw ? area <= 1e-9 : area >= -1e-9) continue;
        let containsPoint = false;
        for (const index of indices) {
          if (index !== ia && index !== ib && index !== ic && insideTriangle(polygon[index], a, b, c)) {
            containsPoint = true;
            break;
          }
        }
        if (containsPoint) continue;
        triangles.push(ia, ib, ic);
        indices.splice(cursor, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (indices.length === 3) triangles.push(indices[0], indices[1], indices[2]);
    return triangles;
  }

  function addQuad(mesh, a, b, c, d, group) {
    const offset = mesh.vertices.length;
    mesh.vertices.push(a, b, c, d);
    mesh.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    mesh.groups.push(group, group);
  }

  function roomPortalSides(roomId, portals) {
    const sides = [];
    for (const portal of portals) {
      if (portal.status === 'closed') continue;
      for (const side of portal.sides || []) {
        if (side.roomId === roomId) sides.push({ ...side, top: portal.top, portalId: portal.id });
      }
    }
    return sides;
  }

  function roomShellMesh(room, portals = []) {
    const model = room.model;
    const mesh = { vertices: [], indices: [], groups: [] };
    const triangles = triangulatePolygon(model.footprint);
    const floorVertices = model.footprint.map(point => [point[0], model.floorY, point[1]]);
    const ceilingVertices = model.footprint.map(point => [point[0], model.ceilingY, point[1]]);
    for (let index = 0; index < triangles.length; index += 3) {
      const floorOffset = mesh.vertices.length;
      mesh.vertices.push(
        floorVertices[triangles[index + 2]],
        floorVertices[triangles[index + 1]],
        floorVertices[triangles[index]],
      );
      mesh.indices.push(floorOffset, floorOffset + 1, floorOffset + 2);
      mesh.groups.push(`room:${room.id}:floor`);
      const ceilingOffset = mesh.vertices.length;
      mesh.vertices.push(
        ceilingVertices[triangles[index]],
        ceilingVertices[triangles[index + 1]],
        ceilingVertices[triangles[index + 2]],
      );
      mesh.indices.push(ceilingOffset, ceilingOffset + 1, ceilingOffset + 2);
      mesh.groups.push(`room:${room.id}:ceiling`);
    }
    const sides = roomPortalSides(room.id, portals);
    for (const wall of model.walls) {
      const cutouts = sides
        .filter(side => side.wallIndex === wall.index)
        .sort((a, b) => a.s0 - b.s0);
      const pieces = [];
      let cursor = 0;
      for (const cutout of cutouts) {
        if (cutout.s0 > cursor + 1e-6) {
          pieces.push({ s0: cursor, s1: cutout.s0, y0: model.floorY, y1: model.ceilingY });
        }
        const top = clamp(cutout.top ?? model.height, 1.2, model.height) + model.floorY;
        if (top < model.ceilingY - 1e-6) {
          pieces.push({ s0: cutout.s0, s1: cutout.s1, y0: top, y1: model.ceilingY });
        }
        cursor = Math.max(cursor, cutout.s1);
      }
      if (cursor < wall.length - 1e-6) {
        pieces.push({ s0: cursor, s1: wall.length, y0: model.floorY, y1: model.ceilingY });
      }
      for (const piece of pieces) {
        addQuad(
          mesh,
          wallPoint(wall, piece.s0, piece.y0),
          wallPoint(wall, piece.s1, piece.y0),
          wallPoint(wall, piece.s1, piece.y1),
          wallPoint(wall, piece.s0, piece.y1),
          `room:${room.id}:wall:${wall.index}`,
        );
      }
    }
    return mesh;
  }


  /* ---------------------------------------------------------------------
   * Acoustic surface model (V20, adapted from the V10 visual-prior concept)
   * ------------------------------------------------------------------ */

  const ACOUSTIC_BANDS = Object.freeze([125, 250, 500, 1000, 2000, 4000, 8000]);
  const MATERIAL_LIBRARY = Object.freeze({
    painted: Object.freeze({ label: 'Intonaco / pittura', alpha: Object.freeze([0.10, 0.08, 0.06, 0.05, 0.05, 0.05, 0.06]), scattering: 0.08 }),
    wood: Object.freeze({ label: 'Legno', alpha: Object.freeze([0.15, 0.11, 0.10, 0.09, 0.08, 0.08, 0.09]), scattering: 0.18 }),
    glass: Object.freeze({ label: 'Vetro', alpha: Object.freeze([0.05, 0.04, 0.03, 0.03, 0.03, 0.03, 0.04]), scattering: 0.04 }),
    metal: Object.freeze({ label: 'Metallo', alpha: Object.freeze([0.03, 0.03, 0.03, 0.03, 0.03, 0.04, 0.04]), scattering: 0.06 }),
    fabric: Object.freeze({ label: 'Tessuto / imbottito', alpha: Object.freeze([0.20, 0.32, 0.48, 0.60, 0.68, 0.72, 0.72]), scattering: 0.38 }),
    carpet: Object.freeze({ label: 'Moquette / tappeto', alpha: Object.freeze([0.10, 0.24, 0.57, 0.69, 0.71, 0.73, 0.73]), scattering: 0.30 }),
    tile_stone: Object.freeze({ label: 'Piastrella / pietra', alpha: Object.freeze([0.03, 0.03, 0.04, 0.04, 0.05, 0.05, 0.06]), scattering: 0.10 }),
    plastic: Object.freeze({ label: 'Plastica', alpha: Object.freeze([0.05, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10]), scattering: 0.14 }),
    unknown: Object.freeze({ label: 'Materiale non determinato', alpha: Object.freeze([0.18, 0.18, 0.20, 0.22, 0.24, 0.25, 0.26]), scattering: 0.20 }),
  });

  function visualFeaturesFromColors(colors, options = {}) {
    const maximumSamples = Math.max(16, options.maximumSamples || 4096);
    if (!Array.isArray(colors) || !colors.length) {
      return { sampleCount: 0, meanRgb: [128, 128, 128], lumaMean: 0.5, lumaStd: 0, saturation: 0, highlight: 0, edge: 0, warm: 0 };
    }
    const step = Math.max(1, Math.ceil(colors.length / maximumSamples));
    let count = 0;
    let mean = 0;
    let m2 = 0;
    let saturation = 0;
    let highlights = 0;
    let warm = 0;
    const rgb = [0, 0, 0];
    let previousLuma = null;
    let edge = 0;
    for (let index = 0; index < colors.length; index += step) {
      const source = colors[index]?.color || colors[index];
      if (!source || source.length < 3) continue;
      const r = clamp(Number(source[0]) / 255);
      const g = clamp(Number(source[1]) / 255);
      const b = clamp(Number(source[2]) / 255);
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
      const delta = luma - mean;
      mean += delta / count;
      m2 += delta * (luma - mean);
      saturation += maximum > EPS ? (maximum - minimum) / maximum : 0;
      highlights += maximum > 0.86 && maximum - minimum < 0.13 ? 1 : 0;
      warm += Math.max(0, r - 0.55 * b - 0.18 * g);
      rgb[0] += r;
      rgb[1] += g;
      rgb[2] += b;
      if (previousLuma != null) edge += Math.abs(luma - previousLuma);
      previousLuma = luma;
    }
    if (!count) return visualFeaturesFromColors([]);
    return {
      sampleCount: count,
      meanRgb: rgb.map(value => Math.round(255 * value / count)),
      lumaMean: mean,
      lumaStd: Math.sqrt(m2 / Math.max(1, count - 1)),
      saturation: saturation / count,
      highlight: highlights / count,
      edge: edge / Math.max(1, count - 1),
      warm: warm / count,
    };
  }

  function visualFeaturesFromRgba(rgba, width, height, options = {}) {
    if (!rgba?.length || !width || !height) return visualFeaturesFromColors([]);
    const maximumSamples = Math.max(16, options.maximumSamples || 4096);
    const pixels = width * height;
    const step = Math.max(1, Math.ceil(pixels / maximumSamples));
    const colors = [];
    for (let pixel = 0; pixel < pixels; pixel += step) {
      const offset = pixel * 4;
      if ((rgba[offset + 3] ?? 255) < 32) continue;
      colors.push([rgba[offset], rgba[offset + 1], rgba[offset + 2]]);
    }
    const features = visualFeaturesFromColors(colors, { maximumSamples });
    // Adjacent sampled pixels in a raster provide a more useful texture cue
    // than the arbitrary ordering of a point cloud.
    let edgeSum = 0;
    let edgeCount = 0;
    const rasterStep = Math.max(1, Math.round(Math.sqrt(step)));
    const lumaAt = (x, y) => {
      const offset = 4 * (y * width + x);
      return (0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]) / 255;
    };
    for (let y = 0; y < height; y += rasterStep) {
      for (let x = 0; x < width; x += rasterStep) {
        const value = lumaAt(x, y);
        if (x + rasterStep < width) { edgeSum += Math.abs(value - lumaAt(x + rasterStep, y)); edgeCount += 1; }
        if (y + rasterStep < height) { edgeSum += Math.abs(value - lumaAt(x, y + rasterStep)); edgeCount += 1; }
      }
    }
    features.edge = edgeCount ? edgeSum / edgeCount : features.edge;
    return features;
  }

  function roleMaterialPrior(role) {
    const common = { painted: 0.08, wood: 0.08, glass: 0.06, metal: 0.05, fabric: 0.06, carpet: 0.05, tile_stone: 0.08, plastic: 0.06, unknown: 0.10 };
    const roles = {
      wall: { painted: 0.45, wood: 0.10, glass: 0.09, fabric: 0.06, tile_stone: 0.10 },
      floor: { wood: 0.24, carpet: 0.25, tile_stone: 0.30, painted: 0.03 },
      ceiling: { painted: 0.66, wood: 0.04, fabric: 0.04, tile_stone: 0.03 },
      object: { wood: 0.20, fabric: 0.20, plastic: 0.17, metal: 0.11, glass: 0.08, unknown: 0.12 },
    };
    const selected = roles[role] || roles.object;
    const posterior = {};
    for (const key of Object.keys(MATERIAL_LIBRARY)) posterior[key] = Math.max(0.001, selected[key] ?? common[key] ?? 0.05);
    return posterior;
  }

  function normalizePosterior(values) {
    const total = Object.values(values).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Math.max(0, value) / total]));
  }

  function tinyMaterialPosterior(role, features = {}) {
    const posterior = roleMaterialPrior(role);
    const sampleCount = Number(features.sampleCount) || 0;
    if (sampleCount > 0) {
      const luma = clamp(features.lumaMean ?? 0.5);
      const variation = clamp((features.lumaStd ?? 0) / 0.28);
      const saturation = clamp((features.saturation ?? 0) / 0.65);
      const highlight = clamp((features.highlight ?? 0) / 0.22);
      const edge = clamp((features.edge ?? 0) / 0.30);
      const warm = clamp((features.warm ?? 0) / 0.35);
      const multiply = (key, factor) => { posterior[key] *= Math.max(0.10, factor); };
      multiply('painted', 1.35 - 0.45 * variation - 0.28 * saturation + 0.12 * luma);
      multiply('wood', 0.82 + 0.72 * warm + 0.22 * variation - 0.22 * highlight);
      multiply('glass', 0.70 + 1.35 * highlight + 0.42 * edge + 0.20 * luma);
      multiply('metal', 0.65 + 1.05 * highlight + 0.55 * edge - 0.18 * saturation);
      multiply('fabric', 0.72 + 0.70 * variation + 0.65 * saturation - 0.55 * highlight);
      multiply('carpet', 0.62 + 0.78 * variation + 0.34 * saturation - 0.48 * highlight - 0.18 * luma);
      multiply('tile_stone', 0.82 + 0.58 * edge + 0.38 * highlight - 0.20 * saturation);
      multiply('plastic', 0.82 + 0.48 * saturation + 0.30 * highlight - 0.18 * variation);
      multiply('unknown', 0.82 + 0.25 * variation);
    }
    return normalizePosterior(posterior);
  }

  function acousticMaterialPrior(role, features = null) {
    const posterior = tinyMaterialPosterior(role, features || {});
    const ordered = Object.entries(posterior).sort((a, b) => b[1] - a[1]);
    const key = ordered[0]?.[0] || 'unknown';
    const top = ordered[0]?.[1] || 0;
    const second = ordered[1]?.[1] || 0;
    const sampleReliability = clamp(Math.log2(1 + (features?.sampleCount || 0)) / 11);
    // Visual appearance is never presented as a measured acoustic coefficient.
    // Match the conservative V10 philosophy by capping confidence at 0.28.
    const confidence = clamp(0.05 + 0.42 * (top - second) + 0.16 * sampleReliability, 0.04, 0.28);
    const material = MATERIAL_LIBRARY[key] || MATERIAL_LIBRARY.unknown;
    return {
      mode: 'auto',
      key,
      label: material.label,
      alpha: [...material.alpha],
      scattering: material.scattering,
      confidence,
      source: features?.sampleCount ? 'visual-prior-v10' : 'role-prior-v10',
      posterior,
      features: features ? { ...features, meanRgb: [...(features.meanRgb || [128, 128, 128])] } : null,
    };
  }

  function materialDefinition(key) {
    const safeKey = MATERIAL_LIBRARY[key] ? key : 'unknown';
    const material = MATERIAL_LIBRARY[safeKey];
    return { key: safeKey, label: material.label, alpha: [...material.alpha], scattering: material.scattering };
  }

  function applyMaterialToSurface(surface, key, options = {}) {
    const material = materialDefinition(key);
    surface.material = {
      ...(surface.material || {}),
      mode: options.mode || 'manual',
      key: material.key,
      label: material.label,
      alpha: Array.isArray(options.alpha) && options.alpha.length === ACOUSTIC_BANDS.length
        ? options.alpha.map(value => clamp(Number(value), 0, 1))
        : material.alpha,
      scattering: clamp(Number.isFinite(Number(options.scattering)) ? Number(options.scattering) : material.scattering, 0, 1),
      confidence: options.mode === 'auto' ? (surface.material?.confidence || 0.1) : 1,
      source: options.mode === 'auto' ? (surface.material?.source || 'visual-prior-v10') : 'user',
    };
    return surface;
  }

  function surfaceCentroid(vertices) {
    if (!vertices?.length) return [0, 0, 0];
    const sum = vertices.reduce((accumulator, point) => add3(accumulator, point), [0, 0, 0]);
    return mul3(sum, 1 / vertices.length);
  }

  function boxFaces(object) {
    if (!object?.obb) return [];
    const mesh = boxMesh(object.obb.center, object.obb.extent, object.obb.yaw || 0);
    // boxMesh() stores the corners in two z-planes.  Keep the face topology
    // explicit here rather than relying on the triangle order so that every
    // acoustic face has the correct physical area and outward normal.
    const faceSpecs = [
      { key: 'bottom', indices: [0, 1, 5, 4], normalLocal: [0, -1, 0], area: object.obb.extent[0] * object.obb.extent[2] },
      { key: 'top', indices: [3, 7, 6, 2], normalLocal: [0, 1, 0], area: object.obb.extent[0] * object.obb.extent[2] },
      { key: 'front', indices: [0, 3, 2, 1], normalLocal: [0, 0, -1], area: object.obb.extent[0] * object.obb.extent[1] },
      { key: 'back', indices: [4, 5, 6, 7], normalLocal: [0, 0, 1], area: object.obb.extent[0] * object.obb.extent[1] },
      { key: 'right', indices: [1, 2, 6, 5], normalLocal: [1, 0, 0], area: object.obb.extent[2] * object.obb.extent[1] },
      { key: 'left', indices: [0, 4, 7, 3], normalLocal: [-1, 0, 0], area: object.obb.extent[2] * object.obb.extent[1] },
    ];
    const cos = Math.cos(object.obb.yaw || 0);
    const sin = Math.sin(object.obb.yaw || 0);
    return faceSpecs.map(spec => {
      const vertices = spec.indices.map(index => [...mesh.vertices[index]]);
      const normal = [
        cos * spec.normalLocal[0] - sin * spec.normalLocal[2],
        spec.normalLocal[1],
        sin * spec.normalLocal[0] + cos * spec.normalLocal[2],
      ];
      return { ...spec, vertices, normal, centroid: surfaceCentroid(vertices) };
    });
  }

  function surfaceOpeningArea(roomId, wallIndex, portals, height) {
    return roomPortalSides(roomId, portals).filter(side => side.wallIndex === wallIndex).reduce((sum, side) => {
      const width = Math.max(0, (side.s1 || 0) - (side.s0 || 0));
      return sum + width * clamp(side.top ?? height, 0, height);
    }, 0);
  }

  function buildAcousticSurfaceModel(rooms, objects = [], portals = [], visualEvidence = {}, existing = []) {
    const existingById = new Map((existing || []).map(surface => [surface.id, surface]));
    const surfaces = [];
    const addSurface = surface => {
      const previous = existingById.get(surface.id);
      if (previous?.material?.mode === 'manual') {
        surface.material = {
          ...previous.material,
          alpha: [...(previous.material.alpha || MATERIAL_LIBRARY.unknown.alpha)],
          posterior: previous.material.posterior ? { ...previous.material.posterior } : undefined,
        };
      }
      surfaces.push(surface);
    };
    for (const room of rooms || []) {
      const model = room.model || (room.footprint?.length >= 3 ? buildRoomModel(room.footprint, 0, room.height || 2.7) : null);
      if (!model) continue;
      const floorVertices = model.footprint.map(point => [point[0], model.floorY, point[1]]);
      const ceilingVertices = [...model.footprint].reverse().map(point => [point[0], model.ceilingY, point[1]]);
      for (const [role, vertices, normal] of [
        ['floor', floorVertices, [0, 1, 0]],
        ['ceiling', ceilingVertices, [0, -1, 0]],
      ]) {
        const id = `${room.id}:${role}`;
        addSurface({
          id, ownerType: 'room', ownerId: room.id, roomId: room.id, role,
          label: `${room.name || room.id} · ${role === 'floor' ? 'pavimento' : 'soffitto'}`,
          vertices, normal, centroid: surfaceCentroid(vertices), area: model.area,
          openings: [],
          geometryRef: { type: 'room-surface', roomId: room.id, role },
          material: acousticMaterialPrior(role, visualEvidence[id] || null),
        });
      }
      for (const wall of model.walls) {
        const id = `${room.id}:wall:${wall.index}`;
        const vertices = [
          [wall.a[0], model.floorY, wall.a[1]],
          [wall.b[0], model.floorY, wall.b[1]],
          [wall.b[0], model.ceilingY, wall.b[1]],
          [wall.a[0], model.ceilingY, wall.a[1]],
        ];
        const openings = roomPortalSides(room.id, portals).filter(side => side.wallIndex === wall.index).map(side => ({
          s0: side.s0, s1: side.s1, top: side.top, portalId: side.portalId || null,
        }));
        addSurface({
          id, ownerType: 'room', ownerId: room.id, roomId: room.id, role: 'wall', wallIndex: wall.index,
          label: `${room.name || room.id} · parete ${wall.index + 1}`,
          vertices,
          normal: [wall.inwardNormal[0], 0, wall.inwardNormal[1]],
          centroid: surfaceCentroid(vertices),
          area: Math.max(0, wall.length * model.height - surfaceOpeningArea(room.id, wall.index, portals, model.height)),
          grossArea: wall.length * model.height,
          openings,
          geometryRef: { type: 'room-surface', roomId: room.id, role: 'wall', wallIndex: wall.index },
          material: acousticMaterialPrior('wall', visualEvidence[id] || null),
        });
      }
    }
    for (const object of objects || []) {
      if (object.status === 'removed' || !object.obb) continue;
      const evidence = visualEvidence[object.id] || (object.points?.length ? visualFeaturesFromColors(object.points) : null);
      for (const face of boxFaces(object)) {
        const id = `${object.id}:face:${face.key}`;
        addSurface({
          id, ownerType: 'object', ownerId: object.id, roomId: object.roomId || null, role: 'object', face: face.key,
          label: `${object.name || object.id} · ${face.key}`,
          vertices: face.vertices, normal: face.normal, centroid: face.centroid, area: face.area,
          proxy: object.kind === 'scan' ? 'oriented-bounding-box partition over RGB voxel mesh' : 'manual cuboid',
          geometryRef: {
            type: 'object-mesh-triangle-label',
            objectId: object.id,
            meshField: 'mesh',
            triangleFaceKey: face.key,
            fallback: 'obb-face',
          },
          meshTriangleCount: (object.mesh?.triangleFaceKeys || []).filter(key => key === face.key).length,
          material: acousticMaterialPrior('object', evidence),
        });
      }
    }
    return surfaces;
  }

  function acousticSummary(rooms, surfaces) {
    const volume = (rooms || []).reduce((sum, room) => {
      const model = room.model || (room.footprint?.length >= 3 ? buildRoomModel(room.footprint, 0, room.height || 2.7) : null);
      return sum + (model ? model.area * model.height : 0);
    }, 0);
    const equivalentArea = ACOUSTIC_BANDS.map((_, band) => (surfaces || []).reduce((sum, surface) => sum + Math.max(0, surface.area || 0) * clamp(surface.material?.alpha?.[band] ?? 0.2), 0));
    const totalArea = (surfaces || []).reduce((sum, surface) => sum + Math.max(0, surface.area || 0), 0);
    const meanAlpha = equivalentArea.map(value => totalArea > EPS ? value / totalArea : 0);
    const rt60Sabine = equivalentArea.map(value => value > 0.01 ? 0.161 * volume / value : null);
    return { bands: [...ACOUSTIC_BANDS], volume, totalArea, equivalentArea, meanAlpha, rt60Sabine, source: 'visual-prior-not-measured' };
  }

  function acousticColor(alpha) {
    const value = clamp(alpha);
    // Blue -> cyan -> yellow -> red. Returned as RGB so callers can select
    // their own opacity without parsing CSS strings.
    if (value < 0.33) return [Math.round(30 + 20 * value / 0.33), Math.round(105 + 125 * value / 0.33), 235];
    if (value < 0.66) {
      const t = (value - 0.33) / 0.33;
      return [Math.round(50 + 205 * t), Math.round(230 - 25 * t), Math.round(235 - 190 * t)];
    }
    const t = (value - 0.66) / 0.34;
    return [255, Math.round(205 - 145 * t), Math.round(45 - 20 * t)];
  }

  function sceneBounds(rooms, objects = []) {
    const points = [];
    for (const room of rooms) {
      if (!room.model) continue;
      for (const point of room.model.footprint) {
        points.push([point[0], room.model.floorY, point[1]]);
        points.push([point[0], room.model.ceilingY, point[1]]);
      }
    }
    for (const object of objects) {
      if (object.status === 'removed') continue;
      if (object.mesh?.vertices?.length) points.push(...object.mesh.vertices);
      else if (object.obb) {
        const half = object.obb.extent.map(value => value / 2);
        points.push(
          sub3(object.obb.center, half),
          add3(object.obb.center, half),
        );
      }
    }
    if (!points.length) return { min: [-1, 0, -1], max: [1, 2, 1] };
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    return { min, max };
  }

  return {
    EPS,
    clamp,
    add2,
    sub2,
    mul2,
    dot2,
    cross2,
    len2,
    norm2,
    add3,
    sub3,
    mul3,
    dot3,
    len3,
    norm3,
    angleWrap,
    angleDiff,
    median,
    quantile,
    mad,
    mat4Point,
    invert4,
    transformPoint,
    projectPoint,
    rayFromUV,
    worldFromViewDepth,
    viewYaw,
    viewPitch,
    horizontalFov,
    rayPlaneY,
    signedArea,
    polygonCentroid,
    pointInPolygon,
    segmentIntersection,
    closestPointOnSegment,
    validateFootprint,
    buildRoomModel,
    updateRoomHeight,
    wallPoint,
    rayWallHit,
    rayRoomHit,
    nearestWallPoint,
    stablePoint,
    snapFloorCorner,
    pathBoundaryCrossing,
    createPortalFromCrossing,
    portalSideSegment,
    linkPortalToRoom,
    coverageBins,
    markAngularCoverage,
    angularCoverageFraction,
    createWallPhotoTargets,
    evaluatePhotoTarget,
    photoTargetStatus,
    photoTargetProgress,
    registerPhotoTargetObservation,
    registerFramePhotoTargets,
    photoTargetStats,
    viewClusterId,
    fitRelativeDepth,
    metricDepth,
    voxelKey,
    mergeVoxel,
    connectedVoxelComponents,
    objectFromVoxels,
    voxelSurfaceMesh,
    boxMesh,
    assignMeshAcousticFaces,
    obbPointToLocal,
    obbLocalToPoint,
    transformPointsBetweenObbs,
    boxSurfacePoints,
    createManualObject,
    triangulatePolygon,
    roomPortalSides,
    roomShellMesh,
    ACOUSTIC_BANDS,
    MATERIAL_LIBRARY,
    visualFeaturesFromColors,
    visualFeaturesFromRgba,
    tinyMaterialPosterior,
    acousticMaterialPrior,
    materialDefinition,
    applyMaterialToSurface,
    boxFaces,
    buildAcousticSurfaceModel,
    acousticSummary,
    acousticColor,
    sceneBounds,
  };
});
