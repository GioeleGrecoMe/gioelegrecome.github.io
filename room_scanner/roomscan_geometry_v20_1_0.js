/*
 * Room Scanner V20.1.0 - metric surfel fusion and constrained room fitting
 * -------------------------------------------------------------------------
 * This module deliberately avoids TSDF, ICP and a global nonlinear solver.
 * WebXR local-floor poses remain the only metric reference. Sparse XR depth,
 * RGB keyframes and post-XR relative depth are fused into a bounded surfel map.
 * User-marked room corners define topology; robust local plane fits may refine
 * each wall only within small, explicitly bounded angle/offset limits.
 *
 * The code has no DOM dependency and is unit-testable under Node.
 */
(function attachRoomScanGeometry(root, factory) {
  const core = root.RoomScanCore || (typeof require === 'function' ? require('./roomscan_core_v20_1_0.js') : null);
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoomScanGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function roomScanGeometryFactory(C) {
  'use strict';

  if (!C) throw new Error('RoomScanCore is required by RoomScanGeometry');

  const EPS = 1e-9;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function finitePoint(point) {
    return Array.isArray(point) && point.length >= 3 && point.every(Number.isFinite);
  }

  function voxelCoordinates(point, voxelSize) {
    return [
      Math.floor(point[0] / voxelSize),
      Math.floor(point[1] / voxelSize),
      Math.floor(point[2] / voxelSize),
    ];
  }

  function voxelKey(point, voxelSize) {
    const coordinates = voxelCoordinates(point, voxelSize);
    return `${coordinates[0]}:${coordinates[1]}:${coordinates[2]}`;
  }

  function parseVoxelKey(key) {
    return String(key).split(':').map(Number);
  }

  function normalizeColor(color) {
    if (!color || color.length < 3) return [128, 128, 128];
    return [
      clamp(Math.round(Number(color[0]) || 0), 0, 255),
      clamp(Math.round(Number(color[1]) || 0), 0, 255),
      clamp(Math.round(Number(color[2]) || 0), 0, 255),
    ];
  }

  function weightedMean(previous, value, previousWeight, newWeight) {
    const total = previousWeight + newWeight;
    if (!(total > 0)) return value;
    return (previous * previousWeight + value * newWeight) / total;
  }

  function mergeHistogram(histogram, key, increment = 1, maximumEntries = 8) {
    const safeKey = key == null ? 'unknown' : String(key);
    histogram[safeKey] = (histogram[safeKey] || 0) + increment;
    const entries = Object.entries(histogram);
    if (entries.length <= maximumEntries) return histogram;
    entries.sort((a, b) => b[1] - a[1]);
    const keep = new Set(entries.slice(0, maximumEntries).map(entry => entry[0]));
    for (const name of Object.keys(histogram)) if (!keep.has(name)) delete histogram[name];
    return histogram;
  }

  function dominantHistogramKey(histogram) {
    let selected = null;
    let selectedCount = -Infinity;
    for (const [key, count] of Object.entries(histogram || {})) {
      if (count > selectedCount) {
        selected = key;
        selectedCount = count;
      }
    }
    return selected;
  }

  function covarianceDirection2(points, weights = null) {
    if (!points?.length) return null;
    let totalWeight = 0;
    let meanX = 0;
    let meanZ = 0;
    for (let index = 0; index < points.length; index += 1) {
      const weight = weights ? Math.max(0, weights[index] || 0) : 1;
      totalWeight += weight;
      meanX += points[index][0] * weight;
      meanZ += points[index][1] * weight;
    }
    if (!(totalWeight > EPS)) return null;
    meanX /= totalWeight;
    meanZ /= totalWeight;
    let xx = 0;
    let xz = 0;
    let zz = 0;
    for (let index = 0; index < points.length; index += 1) {
      const weight = weights ? Math.max(0, weights[index] || 0) : 1;
      const dx = points[index][0] - meanX;
      const dz = points[index][1] - meanZ;
      xx += weight * dx * dx;
      xz += weight * dx * dz;
      zz += weight * dz * dz;
    }
    xx /= totalWeight;
    xz /= totalWeight;
    zz /= totalWeight;
    const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
    const tangent = [Math.cos(angle), Math.sin(angle)];
    const normal = [-tangent[1], tangent[0]];
    const trace = xx + zz;
    const determinant = xx * zz - xz * xz;
    const discriminant = Math.max(0, trace * trace * 0.25 - determinant);
    const lambdaLarge = trace * 0.5 + Math.sqrt(discriminant);
    const lambdaSmall = trace * 0.5 - Math.sqrt(discriminant);
    return {
      centroid: [meanX, meanZ],
      tangent,
      normal,
      lambdaLarge,
      lambdaSmall,
      planarity: lambdaLarge > EPS ? clamp(1 - lambdaSmall / lambdaLarge, 0, 1) : 0,
    };
  }

  function rotate2(vector, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [
      vector[0] * cosine - vector[1] * sine,
      vector[0] * sine + vector[1] * cosine,
    ];
  }

  function angleBetween2(a, b) {
    const aa = Math.atan2(a[1], a[0]);
    const bb = Math.atan2(b[1], b[0]);
    return C.angleDiff(aa, bb);
  }

  function lineIntersection(lineA, lineB) {
    const determinant = C.cross2(lineA.tangent, lineB.tangent);
    if (Math.abs(determinant) < 1e-6) return null;
    const delta = C.sub2(lineB.point, lineA.point);
    const distanceA = C.cross2(delta, lineB.tangent) / determinant;
    return C.add2(lineA.point, C.mul2(lineA.tangent, distanceA));
  }

  function distancePointToLine2(point, line) {
    return Math.abs(C.dot2(C.sub2(point, line.point), line.normal));
  }

  function closestPointOnInfiniteLine2(point, line) {
    const along = C.dot2(C.sub2(point, line.point), line.tangent);
    return C.add2(line.point, C.mul2(line.tangent, along));
  }

  function robustLineFit2(points, initialLine, options = {}) {
    if (!Array.isArray(points) || points.length < (options.minimumPoints || 10)) {
      return {
        ...initialLine,
        support: points?.length || 0,
        confidence: 0,
        residual: Infinity,
        refined: false,
      };
    }
    const maxAngle = options.maxAngleRadians ?? (5 * Math.PI / 180);
    const maxOffset = options.maxOffset ?? 0.28;
    const iterations = options.iterations ?? 4;
    let weights = new Float64Array(points.length).fill(1);
    let fit = null;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      fit = covarianceDirection2(points, weights);
      if (!fit) break;
      // PCA has a 180 degree sign ambiguity. Align it to the initial wall.
      if (C.dot2(fit.tangent, initialLine.tangent) < 0) {
        fit.tangent = C.mul2(fit.tangent, -1);
        fit.normal = C.mul2(fit.normal, -1);
      }
      const rawAngle = angleBetween2(initialLine.tangent, fit.tangent);
      const boundedAngle = clamp(rawAngle, -maxAngle, maxAngle);
      const tangent = C.norm2(rotate2(initialLine.tangent, boundedAngle));
      let normal = [-tangent[1], tangent[0]];
      if (C.dot2(normal, initialLine.normal) < 0) normal = C.mul2(normal, -1);
      const offsets = points.map(point => C.dot2(C.sub2(point, initialLine.point), normal));
      const offsetMedian = C.median(offsets);
      const boundedOffset = clamp(offsetMedian, -maxOffset, maxOffset);
      const line = {
        point: C.add2(initialLine.point, C.mul2(normal, boundedOffset)),
        tangent,
        normal,
      };
      const residuals = points.map(point => distancePointToLine2(point, line));
      const medianResidual = C.median(residuals);
      const scale = Math.max(0.018, 1.4826 * C.mad(residuals, medianResidual));
      for (let index = 0; index < residuals.length; index += 1) {
        const normalized = residuals[index] / (2.5 * scale);
        weights[index] = normalized < 1 ? Math.pow(1 - normalized * normalized, 2) : 0;
      }
      fit = {
        ...line,
        support: weights.reduce((sum, value) => sum + (value > 0.05 ? 1 : 0), 0),
        effectiveWeight: weights.reduce((sum, value) => sum + value, 0),
        residual: medianResidual,
        planarity: fit.planarity,
      };
    }
    if (!fit) return { ...initialLine, support: 0, confidence: 0, residual: Infinity, refined: false };
    const supportScore = clamp((fit.support - 8) / 42, 0, 1);
    const residualScore = clamp(1 - fit.residual / 0.11, 0, 1);
    const confidence = supportScore * residualScore * clamp(fit.planarity || 0, 0, 1);
    // Weak fits are shrunk back toward the user's metric polygon rather than
    // being allowed to drag the room around.
    const blend = confidence < 0.18 ? 0 : clamp((confidence - 0.12) / 0.7, 0, 1);
    const initialOffset = C.dot2(C.sub2(fit.point, initialLine.point), fit.normal);
    const fitAngle = angleBetween2(initialLine.tangent, fit.tangent);
    const tangent = C.norm2(rotate2(initialLine.tangent, fitAngle * blend));
    let normal = [-tangent[1], tangent[0]];
    if (C.dot2(normal, initialLine.normal) < 0) normal = C.mul2(normal, -1);
    return {
      point: C.add2(initialLine.point, C.mul2(normal, initialOffset * blend)),
      tangent,
      normal,
      support: fit.support,
      effectiveWeight: fit.effectiveWeight,
      residual: fit.residual,
      planarity: fit.planarity,
      confidence,
      refined: blend > 0,
      blend,
    };
  }

  function roomForPoint(point, rooms) {
    if (!finitePoint(point)) return null;
    const planar = [point[0], point[2]];
    let best = null;
    for (const room of rooms || []) {
      if (!room?.model) continue;
      const insidePlan = C.pointInPolygon(planar, room.model.footprint);
      const insideHeight = point[1] >= room.model.floorY - 0.22 && point[1] <= room.model.ceilingY + 0.22;
      if (insidePlan && insideHeight) return room;
      const distance = C.len2(C.sub2(planar, room.model.centroid));
      if (!best || distance < best.distance) best = { room, distance };
    }
    return best && best.distance < 1.2 ? best.room : null;
  }

  function nearestSurface(point, rooms, maxDistance = 0.38) {
    if (!finitePoint(point)) return null;
    let best = null;
    for (const room of rooms || []) {
      if (!room?.model) continue;
      const model = room.model;
      const planar = [point[0], point[2]];
      const floorDistance = Math.abs(point[1] - model.floorY);
      if (C.pointInPolygon(planar, model.footprint) && floorDistance <= maxDistance) {
        best = { roomId: room.id, type: 'floor', index: null, distance: floorDistance, normal: [0, 1, 0] };
      }
      const ceilingDistance = Math.abs(point[1] - model.ceilingY);
      if (C.pointInPolygon(planar, model.footprint) && ceilingDistance <= maxDistance && (!best || ceilingDistance < best.distance)) {
        best = { roomId: room.id, type: 'ceiling', index: null, distance: ceilingDistance, normal: [0, -1, 0] };
      }
      for (const wall of model.walls) {
        if (point[1] < model.floorY - 0.18 || point[1] > model.ceilingY + 0.18) continue;
        const nearest = C.closestPointOnSegment(planar, wall.a, wall.b);
        const distance = C.len2(C.sub2(planar, nearest.point));
        if (distance <= maxDistance && (!best || distance < best.distance)) {
          best = {
            roomId: room.id,
            type: 'wall',
            index: wall.index,
            distance,
            normal: [wall.inwardNormal[0], 0, wall.inwardNormal[1]],
            along: nearest.t * wall.length,
          };
        }
      }
    }
    return best;
  }

  function colorSamplerFromRgba(rgba, width, height) {
    if (!rgba || !width || !height) return null;
    return function sampleColor(u, v) {
      const x = clamp(Math.round(u * (width - 1)), 0, width - 1);
      const y = clamp(Math.round(v * (height - 1)), 0, height - 1);
      const offset = (y * width + x) * 4;
      return [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
    };
  }

  function estimateGridNormal(points, width, height, x, y) {
    const center = points[y * width + x];
    if (!center) return null;
    const left = x > 0 ? points[y * width + x - 1] : null;
    const right = x + 1 < width ? points[y * width + x + 1] : null;
    const up = y > 0 ? points[(y - 1) * width + x] : null;
    const down = y + 1 < height ? points[(y + 1) * width + x] : null;
    const horizontal = right && left ? C.sub3(right, left) : right ? C.sub3(right, center) : left ? C.sub3(center, left) : null;
    const vertical = down && up ? C.sub3(down, up) : down ? C.sub3(down, center) : up ? C.sub3(center, up) : null;
    if (!horizontal || !vertical) return null;
    const cross = [
      horizontal[1] * vertical[2] - horizontal[2] * vertical[1],
      horizontal[2] * vertical[0] - horizontal[0] * vertical[2],
      horizontal[0] * vertical[1] - horizontal[1] * vertical[0],
    ];
    const normal = C.norm3(cross);
    return C.len3(normal) > 0.1 ? normal : null;
  }

  class MetricSurfelMap {
    constructor(options = {}) {
      this.voxelSize = options.voxelSize || 0.05;
      this.maxSurfels = options.maxSurfels || 90000;
      this.maxWeight = options.maxWeight || 80;
      this.surfaceAssociationDistance = options.surfaceAssociationDistance || 0.34;
      this.map = new Map();
      this.insertionSequence = 0;
      this.acceptedPoints = 0;
      this.rejectedPoints = 0;
      this.evictions = 0;
      this.sourceCounts = {};
    }

    clear() {
      this.map.clear();
      this.insertionSequence = 0;
      this.acceptedPoints = 0;
      this.rejectedPoints = 0;
      this.evictions = 0;
      this.sourceCounts = {};
    }

    addPoint(point, options = {}) {
      if (!finitePoint(point)) {
        this.rejectedPoints += 1;
        return null;
      }
      const weight = clamp(Number(options.weight) || 1, 0.01, 12);
      const key = voxelKey(point, this.voxelSize);
      const color = normalizeColor(options.color);
      const normal = finitePoint(options.normal) ? C.norm3(options.normal) : null;
      const roomSurface = options.surface || null;
      const source = options.source || 'unknown';
      let surfel = this.map.get(key);
      if (!surfel) {
        surfel = {
          key,
          position: [...point],
          normal: normal || [0, 0, 0],
          color: [...color],
          weight,
          observations: 1,
          firstSequence: this.insertionSequence,
          lastSequence: this.insertionSequence,
          viewIds: {},
          roomIds: {},
          sources: {},
          surfaceVotes: {},
          minRange: Number.isFinite(options.range) ? options.range : null,
          maxRange: Number.isFinite(options.range) ? options.range : null,
        };
        this.map.set(key, surfel);
      } else {
        const previousWeight = surfel.weight;
        const totalWeight = Math.min(this.maxWeight, previousWeight + weight);
        const effectiveNewWeight = Math.min(weight, Math.max(0, totalWeight - previousWeight));
        for (let axis = 0; axis < 3; axis += 1) {
          surfel.position[axis] = weightedMean(surfel.position[axis], point[axis], previousWeight, effectiveNewWeight);
          surfel.color[axis] = weightedMean(surfel.color[axis], color[axis], previousWeight, effectiveNewWeight);
          if (normal) surfel.normal[axis] = weightedMean(surfel.normal[axis], normal[axis], previousWeight, effectiveNewWeight);
        }
        surfel.normal = C.norm3(surfel.normal);
        surfel.weight = totalWeight;
        surfel.observations += 1;
        surfel.lastSequence = this.insertionSequence;
        if (Number.isFinite(options.range)) {
          surfel.minRange = surfel.minRange == null ? options.range : Math.min(surfel.minRange, options.range);
          surfel.maxRange = surfel.maxRange == null ? options.range : Math.max(surfel.maxRange, options.range);
        }
      }
      mergeHistogram(surfel.sources, source, weight);
      mergeHistogram(this.sourceCounts, source, 1, 16);
      if (options.viewId != null) mergeHistogram(surfel.viewIds, options.viewId, 1, 12);
      if (options.roomId != null) mergeHistogram(surfel.roomIds, options.roomId, 1, 8);
      if (roomSurface) {
        const surfaceKey = `${roomSurface.roomId}:${roomSurface.type}:${roomSurface.index == null ? '-' : roomSurface.index}`;
        mergeHistogram(surfel.surfaceVotes, surfaceKey, weight, 8);
      }
      this.insertionSequence += 1;
      this.acceptedPoints += 1;
      if (this.map.size > this.maxSurfels) this.prune();
      return surfel;
    }

    addDepthFrame(frame, options = {}) {
      const projection = frame?.projection || frame?.projectionMatrix;
      const worldFromView = frame?.poseMatrix || frame?.worldFromView;
      const depth = frame?.depthValues || frame?.depth?.values || frame?.xrDepth?.values;
      const width = frame?.depthWidth || frame?.depth?.width || frame?.xrDepth?.width;
      const height = frame?.depthHeight || frame?.depth?.height || frame?.xrDepth?.height;
      if (!projection || !worldFromView || !depth || !width || !height) return { accepted: 0, rejected: 0 };
      const stride = Math.max(1, options.stride || 1);
      const minimumDepth = options.minimumDepth || 0.18;
      const maximumDepth = options.maximumDepth || 9;
      const points = new Array(width * height).fill(null);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const depthValue = Number(depth[y * width + x]);
          if (!(depthValue >= minimumDepth && depthValue <= maximumDepth)) continue;
          const u = (x + 0.5) / width;
          const v = (y + 0.5) / height;
          points[y * width + x] = C.worldFromViewDepth(projection, worldFromView, u, v, depthValue);
        }
      }
      const sampleColor = options.colorSampler || colorSamplerFromRgba(frame.rgba, frame.width, frame.height);
      const cameraPosition = [worldFromView[12], worldFromView[13], worldFromView[14]];
      let accepted = 0;
      let rejected = 0;
      for (let y = 0; y < height; y += stride) {
        for (let x = 0; x < width; x += stride) {
          const point = points[y * width + x];
          if (!point) {
            rejected += 1;
            continue;
          }
          let normal = estimateGridNormal(points, width, height, x, y);
          if (normal) {
            const toCamera = C.sub3(cameraPosition, point);
            if (C.dot3(normal, toCamera) < 0) normal = C.mul3(normal, -1);
          }
          const u = (x + 0.5) / width;
          const v = (y + 0.5) / height;
          const surface = nearestSurface(point, options.rooms || [], this.surfaceAssociationDistance);
          const surfel = this.addPoint(point, {
            normal,
            color: sampleColor ? sampleColor(u, v) : options.defaultColor,
            weight: options.weight || (options.source === 'deep-metric' ? 0.45 : 1),
            source: options.source || 'xr-depth',
            viewId: options.viewId ?? frame.id,
            roomId: options.roomId ?? surface?.roomId,
            range: C.len3(C.sub3(point, cameraPosition)),
            surface,
          });
          if (surfel) accepted += 1; else rejected += 1;
        }
      }
      return { accepted, rejected };
    }

    prune() {
      const target = Math.floor(this.maxSurfels * 0.92);
      if (this.map.size <= target) return 0;
      const ranked = [...this.map.values()].sort((a, b) => {
        const scoreA = Math.log1p(a.weight) + 0.2 * Object.keys(a.viewIds).length + 0.002 * a.lastSequence;
        const scoreB = Math.log1p(b.weight) + 0.2 * Object.keys(b.viewIds).length + 0.002 * b.lastSequence;
        return scoreA - scoreB;
      });
      let removed = 0;
      while (this.map.size > target && removed < ranked.length) {
        this.map.delete(ranked[removed].key);
        removed += 1;
      }
      this.evictions += removed;
      return removed;
    }

    values() {
      return [...this.map.values()];
    }

    pointsForRoom(roomId) {
      const id = String(roomId);
      return this.values().filter(surfel => dominantHistogramKey(surfel.roomIds) === id || surfel.roomIds[id]);
    }

    statistics() {
      const surfels = this.values();
      const viewCounts = surfels.map(surfel => Object.keys(surfel.viewIds).length);
      return {
        voxelSize: this.voxelSize,
        surfels: surfels.length,
        acceptedPoints: this.acceptedPoints,
        rejectedPoints: this.rejectedPoints,
        evictions: this.evictions,
        sourceCounts: { ...this.sourceCounts },
        medianViews: viewCounts.length ? C.median(viewCounts) : 0,
      };
    }

    serialize(maximum = this.maxSurfels) {
      return {
        schema: 'room-scanner-metric-surfel-map-v1',
        voxelSize: this.voxelSize,
        maxSurfels: this.maxSurfels,
        statistics: this.statistics(),
        surfels: this.values().slice(0, maximum).map(surfel => ({
          ...surfel,
          position: surfel.position.map(Number),
          normal: surfel.normal.map(Number),
          color: surfel.color.map(value => Math.round(value)),
        })),
      };
    }

    static deserialize(raw, options = {}) {
      const map = new MetricSurfelMap({
        voxelSize: raw?.voxelSize || options.voxelSize,
        maxSurfels: raw?.maxSurfels || options.maxSurfels,
      });
      for (const item of raw?.surfels || []) {
        if (!finitePoint(item.position)) continue;
        const key = item.key || voxelKey(item.position, map.voxelSize);
        map.map.set(key, {
          key,
          position: [...item.position],
          normal: finitePoint(item.normal) ? C.norm3(item.normal) : [0, 0, 0],
          color: normalizeColor(item.color),
          weight: Number(item.weight) || 1,
          observations: Number(item.observations) || 1,
          firstSequence: Number(item.firstSequence) || 0,
          lastSequence: Number(item.lastSequence) || 0,
          viewIds: { ...(item.viewIds || {}) },
          roomIds: { ...(item.roomIds || {}) },
          sources: { ...(item.sources || {}) },
          surfaceVotes: { ...(item.surfaceVotes || {}) },
          minRange: Number.isFinite(item.minRange) ? item.minRange : null,
          maxRange: Number.isFinite(item.maxRange) ? item.maxRange : null,
        });
      }
      map.acceptedPoints = raw?.statistics?.acceptedPoints || map.map.size;
      map.rejectedPoints = raw?.statistics?.rejectedPoints || 0;
      map.evictions = raw?.statistics?.evictions || 0;
      map.sourceCounts = { ...(raw?.statistics?.sourceCounts || {}) };
      map.insertionSequence = map.map.size;
      return map;
    }
  }

  function wallInitialLine(wall) {
    return {
      point: C.mul2(C.add2(wall.a, wall.b), 0.5),
      tangent: [...wall.tangent],
      normal: [...wall.inwardNormal],
    };
  }

  function selectWallSupport(surfels, wall, model, options = {}) {
    const maximumDistance = options.supportDistance || 0.34;
    const endMargin = options.endMargin || 0.35;
    const minimumY = model.floorY + (options.minimumHeight || 0.12);
    const maximumY = model.ceilingY - (options.ceilingMargin || 0.10);
    const selected = [];
    for (const surfel of surfels || []) {
      const point = surfel.position;
      if (!finitePoint(point) || point[1] < minimumY || point[1] > maximumY) continue;
      const planar = [point[0], point[2]];
      const relative = C.sub2(planar, wall.a);
      const along = C.dot2(relative, wall.tangent);
      if (along < -endMargin || along > wall.length + endMargin) continue;
      const distance = Math.abs(C.dot2(relative, wall.inwardNormal));
      if (distance > maximumDistance) continue;
      const normalAgreement = C.len3(surfel.normal) > 0.2
        ? Math.abs(C.dot3(surfel.normal, [wall.inwardNormal[0], 0, wall.inwardNormal[1]]))
        : 0.5;
      if (normalAgreement < (options.minimumNormalAgreement || 0.32)) continue;
      selected.push(planar);
    }
    return selected;
  }

  function fitCeilingHeight(room, surfels, options = {}) {
    const model = room.model;
    const candidates = [];
    for (const surfel of surfels || []) {
      const point = surfel.position;
      if (!finitePoint(point)) continue;
      if (!C.pointInPolygon([point[0], point[2]], model.footprint)) continue;
      const normalVerticality = Math.abs(surfel.normal?.[1] || 0);
      if (normalVerticality < 0.62) continue;
      const height = point[1] - model.floorY;
      if (height < 1.75 || height > 5.2) continue;
      if (Math.abs(height - model.height) > (options.maximumHeightCorrection || 0.35)) continue;
      candidates.push(height);
    }
    if (candidates.length < (options.minimumCeilingPoints || 12)) {
      return { height: model.height, support: candidates.length, confidence: 0, refined: false };
    }
    const medianHeight = C.median(candidates);
    const spread = 1.4826 * C.mad(candidates, medianHeight);
    const confidence = clamp((candidates.length - 8) / 70, 0, 1) * clamp(1 - spread / 0.12, 0, 1);
    const blend = clamp(confidence * 0.75, 0, 0.75);
    return {
      height: model.height * (1 - blend) + medianHeight * blend,
      support: candidates.length,
      spread,
      confidence,
      refined: blend > 0.08,
    };
  }

  function fitRoomHybrid(room, surfels, options = {}) {
    if (!room?.model) return { ok: false, reason: 'room-model-missing' };
    const model = room.model;
    const lines = [];
    const diagnostics = [];
    for (const wall of model.walls) {
      const initial = wallInitialLine(wall);
      const support = selectWallSupport(surfels, wall, model, options);
      const fitted = robustLineFit2(support, initial, {
        maximumPoints: options.maximumPoints,
        minimumPoints: options.minimumWallPoints || 10,
        maxAngleRadians: (options.maximumAngleDegrees || 4.5) * Math.PI / 180,
        maxOffset: options.maximumOffset || 0.26,
        iterations: options.iterations || 4,
      });
      lines.push(fitted);
      diagnostics.push({
        wallIndex: wall.index,
        support: support.length,
        residual: fitted.residual,
        confidence: fitted.confidence,
        refined: fitted.refined,
        blend: fitted.blend || 0,
      });
    }
    const footprint = [];
    for (let index = 0; index < lines.length; index += 1) {
      const previous = lines[(index - 1 + lines.length) % lines.length];
      const current = lines[index];
      let corner = lineIntersection(previous, current);
      const original = model.footprint[index];
      if (!corner || C.len2(C.sub2(corner, original)) > (options.maximumCornerShift || 0.38)) {
        corner = [...original];
      }
      footprint.push(corner);
    }
    const validation = C.validateFootprint(footprint, {
      minEdge: options.minimumEdge || 1e-5,
      minArea: options.minimumArea || 1e-7,
    });
    if (!validation.ok) {
      return {
        ok: true,
        model,
        footprint: model.footprint.map(point => [...point]),
        diagnostics,
        reverted: true,
        reason: validation.reason,
        ceiling: fitCeilingHeight(room, surfels, options),
      };
    }
    const ceiling = fitCeilingHeight(room, surfels, options);
    const refinedModel = C.buildRoomModel(footprint, model.floorY, ceiling.height);
    return {
      ok: true,
      model: refinedModel,
      footprint,
      diagnostics,
      reverted: false,
      ceiling,
      meanConfidence: diagnostics.length ? diagnostics.reduce((sum, item) => sum + item.confidence, 0) / diagnostics.length : 0,
    };
  }

  function fitSceneHybrid(rooms, surfelMap, options = {}) {
    const surfels = surfelMap instanceof MetricSurfelMap ? surfelMap.values() : (surfelMap?.surfels || surfelMap || []);
    const results = [];
    for (const room of rooms || []) {
      if (!room?.model) continue;
      const roomSurfels = surfels.filter(surfel => {
        if (surfel.roomIds?.[String(room.id)]) return true;
        const assigned = roomForPoint(surfel.position, [room]);
        return assigned?.id === room.id;
      });
      const result = fitRoomHybrid(room, roomSurfels, options);
      if (result.ok && result.model) room.fittedModel = result.model;
      room.geometryFit = {
        algorithm: 'bounded-robust-wall-fit-v1',
        surfels: roomSurfels.length,
        diagnostics: result.diagnostics || [],
        ceiling: result.ceiling || null,
        meanConfidence: result.meanConfidence || 0,
        reverted: Boolean(result.reverted),
      };
      results.push({ roomId: room.id, ...result });
    }
    return results;
  }

  function chooseTangent(normal) {
    const reference = Math.abs(normal[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
    const tangent = C.norm3([
      reference[1] * normal[2] - reference[2] * normal[1],
      reference[2] * normal[0] - reference[0] * normal[2],
      reference[0] * normal[1] - reference[1] * normal[0],
    ]);
    const bitangent = C.norm3([
      normal[1] * tangent[2] - normal[2] * tangent[1],
      normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0],
    ]);
    return { tangent, bitangent };
  }

  function buildGeometryGaussians(surfelMap, rooms, options = {}) {
    const surfels = surfelMap instanceof MetricSurfelMap ? surfelMap.values() : (surfelMap?.surfels || surfelMap || []);
    const cellSize = options.cellSize || 0.18;
    const maximumGaussians = options.maximumGaussians || 12000;
    const groups = new Map();
    for (const surfel of surfels) {
      const key = voxelKey(surfel.position, cellSize);
      let group = groups.get(key);
      if (!group) {
        group = { key, surfels: [], totalWeight: 0 };
        groups.set(key, group);
      }
      group.surfels.push(surfel);
      group.totalWeight += Math.max(0.01, surfel.weight || 1);
    }
    const ranked = [...groups.values()].sort((a, b) => b.totalWeight - a.totalWeight).slice(0, maximumGaussians);
    return ranked.map((group, index) => {
      let center = [0, 0, 0];
      let normal = [0, 0, 0];
      let color = [0, 0, 0];
      let total = 0;
      const views = new Set();
      for (const surfel of group.surfels) {
        const weight = Math.max(0.01, surfel.weight || 1);
        center = C.add3(center, C.mul3(surfel.position, weight));
        normal = C.add3(normal, C.mul3(surfel.normal || [0, 0, 0], weight));
        color = C.add3(color, C.mul3(surfel.color || [128, 128, 128], weight));
        total += weight;
        Object.keys(surfel.viewIds || {}).forEach(view => views.add(view));
      }
      center = C.mul3(center, 1 / Math.max(EPS, total));
      color = C.mul3(color, 1 / Math.max(EPS, total));
      normal = C.norm3(normal);
      if (C.len3(normal) < 0.2) {
        const surface = nearestSurface(center, rooms || [], 0.45);
        normal = surface?.normal || [0, 1, 0];
      }
      const basis = chooseTangent(normal);
      let varianceT = 0;
      let varianceB = 0;
      let varianceN = 0;
      for (const surfel of group.surfels) {
        const delta = C.sub3(surfel.position, center);
        varianceT += Math.pow(C.dot3(delta, basis.tangent), 2);
        varianceB += Math.pow(C.dot3(delta, basis.bitangent), 2);
        varianceN += Math.pow(C.dot3(delta, normal), 2);
      }
      const divisor = Math.max(1, group.surfels.length);
      const surface = nearestSurface(center, rooms || [], 0.48);
      return {
        id: `gaussian-${index + 1}`,
        center,
        normal,
        tangent: basis.tangent,
        bitangent: basis.bitangent,
        sigma: [
          clamp(Math.sqrt(varianceT / divisor) + cellSize * 0.42, 0.035, 0.32),
          clamp(Math.sqrt(varianceB / divisor) + cellSize * 0.42, 0.035, 0.32),
          clamp(Math.sqrt(varianceN / divisor) + 0.012, 0.008, 0.09),
        ],
        color: color.map(value => Math.round(clamp(value, 0, 255))),
        opacity: clamp(0.25 + 0.12 * Math.log1p(total), 0.25, 0.96),
        support: group.surfels.length,
        views: views.size,
        metricWeight: total,
        roomId: surface?.roomId ?? null,
        surfaceType: surface?.type ?? 'unassigned',
        surfaceIndex: surface?.index ?? null,
        geometryConfidence: clamp(0.22 + 0.11 * Math.log1p(group.surfels.length) + 0.08 * views.size, 0, 1),
      };
    });
  }

  function metricScaleRelativeDepth(relativeDepth, anchors, options = {}) {
    const samples = [];
    for (const anchor of anchors || []) {
      const relative = Number(anchor.relativeDepth);
      const metric = Number(anchor.metricDepth);
      if (relative > 0 && metric > 0 && Number.isFinite(relative) && Number.isFinite(metric)) {
        samples.push({ relative, metric, weight: Math.max(0.02, Number(anchor.weight) || 1) });
      }
    }
    if (samples.length < 7) return { ok: false, reason: 'insufficient-anchors', anchors: samples.length };
    // Depth Anything models may expose either affine depth or affine inverse
    // depth depending on the converted head. Reuse the V12-tested dual fit and
    // select the lower robust residual rather than assuming an orientation.
    const fit = C.fitRelativeDepth(samples);
    if (!fit || !Number.isFinite(fit.slope) || !Number.isFinite(fit.intercept)) {
      return { ok: false, reason: 'relative-depth-fit-failed', anchors: samples.length };
    }
    const residuals = samples.map(sample => Math.abs(C.metricDepth(fit, sample.relative) - sample.metric));
    const medianAbsoluteError = C.median(residuals);
    const p90Error = C.quantile(residuals, 0.9);
    const confidence = clamp((fit.count - 5) / 28, 0, 1)
      * clamp(1 - medianAbsoluteError / 0.24, 0, 1)
      * clamp(1 - p90Error / 0.55, 0, 1);
    return {
      ok: true,
      mode: fit.mode,
      slope: fit.slope,
      intercept: fit.intercept,
      // Compatibility aliases used by older RAW readers.
      scale: fit.slope,
      offset: fit.intercept,
      anchors: fit.count,
      anchorsOriginal: samples.length,
      medianAbsoluteError,
      p90Error,
      confidence,
    };
  }

  function fuseRelativeDepthFrame(surfelMap, frame, relativeDepth, depthWidth, depthHeight, rooms, options = {}) {
    if (!(surfelMap instanceof MetricSurfelMap)) throw new Error('MetricSurfelMap required');
    if (!relativeDepth || !frame?.projection || !frame?.poseMatrix) return { accepted: 0, reason: 'missing-input' };
    const anchors = [];
    const xrValues = frame.xrDepth?.values || frame.depth?.values || frame.depthValues;
    const xrWidth = frame.xrDepth?.width || frame.depth?.width || frame.depthWidth;
    const xrHeight = frame.xrDepth?.height || frame.depth?.height || frame.depthHeight;
    if (xrValues && xrWidth && xrHeight) {
      const anchorStride = Math.max(1, options.anchorStride || 2);
      for (let y = 0; y < depthHeight; y += anchorStride) {
        for (let x = 0; x < depthWidth; x += anchorStride) {
          const relative = Number(relativeDepth[y * depthWidth + x]);
          if (!(relative > 0)) continue;
          const xrX = clamp(Math.floor((x + 0.5) * xrWidth / depthWidth), 0, xrWidth - 1);
          const xrY = clamp(Math.floor((y + 0.5) * xrHeight / depthHeight), 0, xrHeight - 1);
          const metric = Number(xrValues[xrY * xrWidth + xrX]);
          if (metric > 0.18 && metric < 10) anchors.push({ relativeDepth: relative, metricDepth: metric, weight: 1, source: 'xr-depth' });
        }
      }
    }
    // Shell intersections provide weaker but still metric anchors where XR
    // depth is unavailable. They are included only for rays that hit the room.
    const room = rooms?.find(candidate => candidate.id === frame.roomId) || roomForPoint([
      frame.poseMatrix[12], frame.poseMatrix[13], frame.poseMatrix[14],
    ], rooms || []);
    if (room?.model) {
      const stride = Math.max(3, options.shellAnchorStride || 6);
      for (let y = 0; y < depthHeight; y += stride) {
        for (let x = 0; x < depthWidth; x += stride) {
          const relative = Number(relativeDepth[y * depthWidth + x]);
          if (!(relative > 0)) continue;
          const u = (x + 0.5) / depthWidth;
          const v = (y + 0.5) / depthHeight;
          const ray = C.rayFromUV(frame.projection, frame.poseMatrix, u, v);
          const hit = C.rayRoomHit(ray, room.fittedModel || room.model);
          if (hit?.distance > 0.2 && hit.distance < 10) anchors.push({ relativeDepth: relative, metricDepth: hit.distance, weight: 0.28, source: 'metric-shell' });
        }
      }
    }
    const fit = metricScaleRelativeDepth(relativeDepth, anchors, options);
    if (!fit.ok) return { accepted: 0, fit, reason: fit.reason };
    const metricValues = new Float32Array(relativeDepth.length);
    for (let index = 0; index < relativeDepth.length; index += 1) {
      const relative = Number(relativeDepth[index]);
      const metric = relative > 0 ? C.metricDepth(fit, relative) : 0;
      metricValues[index] = Number.isFinite(metric) && metric > 0 ? metric : 0;
    }
    const result = surfelMap.addDepthFrame({
      ...frame,
      depthValues: metricValues,
      depthWidth,
      depthHeight,
    }, {
      source: 'deep-metric',
      weight: clamp(0.18 + fit.confidence * 0.48, 0.18, 0.66),
      viewId: frame.id,
      roomId: frame.roomId,
      rooms,
      stride: options.fusionStride || 1,
      minimumDepth: options.minimumDepth || 0.2,
      maximumDepth: options.maximumDepth || 9,
    });
    return { ...result, fit };
  }

  return {
    voxelCoordinates,
    voxelKey,
    parseVoxelKey,
    covarianceDirection2,
    robustLineFit2,
    lineIntersection,
    roomForPoint,
    nearestSurface,
    colorSamplerFromRgba,
    MetricSurfelMap,
    selectWallSupport,
    fitCeilingHeight,
    fitRoomHybrid,
    fitSceneHybrid,
    buildGeometryGaussians,
    metricScaleRelativeDepth,
    fuseRelativeDepthFrame,
  };
});
