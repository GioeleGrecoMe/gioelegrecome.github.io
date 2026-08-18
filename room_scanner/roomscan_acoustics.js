/*
 * Room Scanner V20.1.0 - lightweight RIR-to-surface acoustic inference
 * -------------------------------------------------------------------------
 * Early reflections are associated probabilistically with metric wall/floor/
 * ceiling zones and local geometry Gaussians. Unknown phone/audio latency is
 * removed by direct-path alignment of every deconvolved RIR; only relative
 * echo delays enter the geometry likelihood. Late decay supplies a conservative
 * room-level regularizer. The output is explicitly an inference with posterior
 * confidence, never presented as a laboratory material measurement.
 */
(function attachRoomScanAcoustics(root, factory) {
  const core = root.RoomScanCore || (typeof require === 'function' ? require('./roomscan_core_v20_1_0.js') : null);
  const signal = root.RoomScanSignal || (typeof require === 'function' ? require('./roomscan_signal_v20_1_0.js') : null);
  const geometry = root.RoomScanGeometry || (typeof require === 'function' ? require('./roomscan_geometry_v20_1_0.js') : null);
  const api = factory(core, signal, geometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoomScanAcoustics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function roomScanAcousticsFactory(C, S, G) {
  'use strict';

  if (!C || !S || !G) throw new Error('RoomScanCore, RoomScanSignal and RoomScanGeometry are required');

  const SPEED_OF_SOUND = 343;
  const DEFAULT_BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];
  const EPS = 1e-12;
  const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

  function finitePoint(point) {
    return Array.isArray(point) && point.length >= 3 && point.every(Number.isFinite);
  }

  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  function reflectPointAcrossPlane(point, planePoint, normal) {
    const unit = C.norm3(normal);
    const signedDistance = C.dot3(C.sub3(point, planePoint), unit);
    return C.sub3(point, C.mul3(unit, 2 * signedDistance));
  }

  function linePlaneIntersection(start, end, planePoint, normal) {
    const direction = C.sub3(end, start);
    const denominator = C.dot3(direction, normal);
    if (Math.abs(denominator) < 1e-8) return null;
    const amount = C.dot3(C.sub3(planePoint, start), normal) / denominator;
    if (amount < -0.02 || amount > 1.02) return null;
    return { point: C.add3(start, C.mul3(direction, amount)), amount };
  }

  function pointToZoneCoordinates(point, zone) {
    const relative = C.sub3(point, zone.origin);
    return {
      u: C.dot3(relative, zone.tangent),
      v: C.dot3(relative, zone.bitangent),
      n: C.dot3(relative, zone.normal),
    };
  }

  function zoneContainment(point, zone) {
    if (!point || !zone) return { inside: false, score: 0, missDistance: Infinity };
    if (zone.kind === 'gaussian') {
      const local = pointToZoneCoordinates(point, zone);
      const su = Math.max(0.025, zone.sigma?.[0] || 0.12);
      const sv = Math.max(0.025, zone.sigma?.[1] || 0.12);
      const metric = Math.sqrt((local.u / su) ** 2 + (local.v / sv) ** 2);
      return {
        inside: metric <= 2.8,
        score: Math.exp(-0.5 * metric * metric),
        missDistance: Math.max(0, metric - 1) * Math.max(su, sv),
      };
    }
    if (zone.kind === 'wall-zone' || zone.kind === 'object-face') {
      const local = pointToZoneCoordinates(point, zone);
      const du = local.u < zone.uMin ? zone.uMin - local.u : local.u > zone.uMax ? local.u - zone.uMax : 0;
      const dv = local.v < zone.vMin ? zone.vMin - local.v : local.v > zone.vMax ? local.v - zone.vMax : 0;
      const miss = Math.hypot(du, dv);
      return { inside: miss <= 0.04, score: Math.exp(-0.5 * (miss / 0.18) ** 2), missDistance: miss };
    }
    if (zone.kind === 'floor' || zone.kind === 'ceiling') {
      const planar = [point[0], point[2]];
      const inside = C.pointInPolygon(planar, zone.footprint);
      if (inside) return { inside: true, score: 1, missDistance: 0 };
      let nearest = Infinity;
      for (let index = 0; index < zone.footprint.length; index += 1) {
        const a = zone.footprint[index];
        const b = zone.footprint[(index + 1) % zone.footprint.length];
        const candidate = C.closestPointOnSegment(planar, a, b);
        nearest = Math.min(nearest, C.len2(C.sub2(planar, candidate.point)));
      }
      return { inside: false, score: Math.exp(-0.5 * (nearest / 0.22) ** 2), missDistance: nearest };
    }
    return { inside: true, score: 1, missDistance: 0 };
  }

  function planePathCandidate(source, receiver, zone, speedOfSound = SPEED_OF_SOUND) {
    if (!finitePoint(source) || !finitePoint(receiver) || !finitePoint(zone?.origin) || !finitePoint(zone?.normal)) return null;
    const imageSource = reflectPointAcrossPlane(source, zone.origin, zone.normal);
    const intersection = linePlaneIntersection(imageSource, receiver, zone.origin, zone.normal);
    if (!intersection) return null;
    const reflectionPoint = intersection.point;
    const directLength = Math.max(0.04, C.len3(C.sub3(receiver, source)));
    const sourceLeg = C.len3(C.sub3(reflectionPoint, source));
    const receiverLeg = C.len3(C.sub3(receiver, reflectionPoint));
    const pathLength = sourceLeg + receiverLeg;
    if (!(pathLength > directLength)) return null;
    const containment = zoneContainment(reflectionPoint, zone);
    const incident = C.norm3(C.sub3(source, reflectionPoint));
    const outgoing = C.norm3(C.sub3(receiver, reflectionPoint));
    const reflectedIncident = C.sub3(incident, C.mul3(zone.normal, 2 * C.dot3(incident, zone.normal)));
    const specular = clamp((C.dot3(C.norm3(reflectedIncident), outgoing) + 1) * 0.5, 0, 1);
    return {
      zoneId: zone.id,
      ownerSurfaceId: zone.ownerSurfaceId || zone.id,
      reflectionPoint,
      directLength,
      pathLength,
      relativeDelaySeconds: (pathLength - directLength) / speedOfSound,
      containment,
      specular,
      sourceLeg,
      receiverLeg,
      geometricSpreadingCorrection: Math.pow(pathLength / directLength, 2),
    };
  }

  function gaussianPathCandidate(source, receiver, zone, speedOfSound = SPEED_OF_SOUND) {
    if (!finitePoint(source) || !finitePoint(receiver) || !finitePoint(zone?.origin)) return null;
    // A local Gaussian is not treated as an exact infinite mirror. Its center
    // proposes a finite reflection patch and normal compatibility controls the
    // probability. This remains stable when the reconstructed surface is noisy.
    const reflectionPoint = zone.origin;
    const directLength = Math.max(0.04, C.len3(C.sub3(receiver, source)));
    const sourceLeg = C.len3(C.sub3(reflectionPoint, source));
    const receiverLeg = C.len3(C.sub3(receiver, reflectionPoint));
    const pathLength = sourceLeg + receiverLeg;
    if (!(pathLength > directLength)) return null;
    const incoming = C.norm3(C.sub3(source, reflectionPoint));
    const outgoing = C.norm3(C.sub3(receiver, reflectionPoint));
    const reflectedIncoming = C.sub3(incoming, C.mul3(zone.normal, 2 * C.dot3(incoming, zone.normal)));
    const angularError = Math.acos(clamp(C.dot3(C.norm3(reflectedIncoming), outgoing), -1, 1));
    const specular = Math.exp(-0.5 * (angularError / (22 * Math.PI / 180)) ** 2);
    return {
      zoneId: zone.id,
      ownerSurfaceId: zone.ownerSurfaceId || zone.id,
      reflectionPoint,
      directLength,
      pathLength,
      relativeDelaySeconds: (pathLength - directLength) / speedOfSound,
      containment: { inside: true, score: 1, missDistance: 0 },
      specular,
      sourceLeg,
      receiverLeg,
      geometricSpreadingCorrection: Math.pow(pathLength / directLength, 2),
    };
  }

  function rectangleZoneVertices(origin, tangent, bitangent, uMin, uMax, vMin, vMax) {
    const point = (u, v) => C.add3(origin, C.add3(C.mul3(tangent, u), C.mul3(bitangent, v)));
    return [point(uMin, vMin), point(uMax, vMin), point(uMax, vMax), point(uMin, vMax)];
  }

  function buildWallZones(room, options = {}) {
    const model = room.fittedModel || room.model;
    if (!model) return [];
    const desiredWidth = options.wallZoneWidth || 1.0;
    const desiredHeight = options.wallZoneHeight || 1.15;
    const zones = [];
    for (const wall of model.walls) {
      const columns = Math.max(1, Math.min(options.maximumWallColumns || 8, Math.ceil(wall.length / desiredWidth)));
      const rows = Math.max(1, Math.min(options.maximumWallRows || 3, Math.ceil(model.height / desiredHeight)));
      const columnWidth = wall.length / columns;
      const rowHeight = model.height / rows;
      const tangent = [wall.tangent[0], 0, wall.tangent[1]];
      const bitangent = [0, 1, 0];
      const normal = [wall.inwardNormal[0], 0, wall.inwardNormal[1]];
      const origin = [wall.a[0], model.floorY, wall.a[1]];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const uMin = column * columnWidth;
          const uMax = (column + 1) * columnWidth;
          const vMin = row * rowHeight;
          const vMax = (row + 1) * rowHeight;
          const id = `${room.id}:wall:${wall.index}:zone:${column}:${row}`;
          zones.push({
            id,
            ownerSurfaceId: `${room.id}:wall:${wall.index}`,
            roomId: room.id,
            kind: 'wall-zone',
            surfaceType: 'wall',
            surfaceIndex: wall.index,
            column,
            row,
            origin,
            tangent,
            bitangent,
            normal,
            uMin,
            uMax,
            vMin,
            vMax,
            vertices: rectangleZoneVertices(origin, tangent, bitangent, uMin, uMax, vMin, vMax),
            centroid: C.add3(origin, C.add3(C.mul3(tangent, 0.5 * (uMin + uMax)), C.mul3(bitangent, 0.5 * (vMin + vMax)))),
            area: columnWidth * rowHeight,
            geometryConfidence: room.geometryFit?.diagnostics?.[wall.index]?.confidence ?? 0.55,
            priorAlpha: null,
            source: 'metric-wall-zone',
          });
        }
      }
    }
    return zones;
  }

  function buildHorizontalZones(room) {
    const model = room.fittedModel || room.model;
    if (!model) return [];
    const centroid = model.centroid;
    return [
      {
        id: `${room.id}:floor`,
        ownerSurfaceId: `${room.id}:floor`,
        roomId: room.id,
        kind: 'floor',
        surfaceType: 'floor',
        surfaceIndex: null,
        origin: [centroid[0], model.floorY, centroid[1]],
        normal: [0, 1, 0],
        tangent: [1, 0, 0],
        bitangent: [0, 0, 1],
        footprint: model.footprint.map(point => [...point]),
        centroid: [centroid[0], model.floorY, centroid[1]],
        area: model.area,
        geometryConfidence: 0.92,
        source: 'webxr-local-floor',
      },
      {
        id: `${room.id}:ceiling`,
        ownerSurfaceId: `${room.id}:ceiling`,
        roomId: room.id,
        kind: 'ceiling',
        surfaceType: 'ceiling',
        surfaceIndex: null,
        origin: [centroid[0], model.ceilingY, centroid[1]],
        normal: [0, -1, 0],
        tangent: [1, 0, 0],
        bitangent: [0, 0, 1],
        footprint: model.footprint.map(point => [...point]),
        centroid: [centroid[0], model.ceilingY, centroid[1]],
        area: model.area,
        geometryConfidence: room.geometryFit?.ceiling?.confidence ?? 0.45,
        source: 'bounded-ceiling-fit',
      },
    ];
  }

  function buildObjectFaceZones(acousticSurfaces) {
    const zones = [];
    for (const surface of acousticSurfaces || []) {
      if (surface?.ownerType !== 'object' || !finitePoint(surface.centroid) || !finitePoint(surface.normal)) continue;
      const vertices = (surface.vertices || []).filter(finitePoint);
      if (vertices.length < 3) continue;
      const normal = C.norm3(surface.normal);
      let tangent = null;
      for (let index = 1; index < vertices.length; index += 1) {
        const edge = C.sub3(vertices[index], vertices[0]);
        const planar = C.sub3(edge, C.mul3(normal, C.dot3(edge, normal)));
        if (C.len3(planar) > 1e-5) {
          tangent = C.norm3(planar);
          break;
        }
      }
      if (!tangent) {
        const reference = Math.abs(normal[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
        tangent = C.norm3(cross3(reference, normal));
      }
      let bitangent = C.norm3(cross3(normal, tangent));
      if (C.len3(bitangent) < 1e-5) bitangent = [0, 0, 1];
      const origin = [...surface.centroid];
      const coordinates = vertices.map(vertex => pointToZoneCoordinates(vertex, { origin, tangent, bitangent, normal }));
      const uMin = Math.min(...coordinates.map(value => value.u));
      const uMax = Math.max(...coordinates.map(value => value.u));
      const vMin = Math.min(...coordinates.map(value => value.v));
      const vMax = Math.max(...coordinates.map(value => value.v));
      if (!(uMax - uMin > 1e-5) || !(vMax - vMin > 1e-5)) continue;
      zones.push({
        id: String(surface.id),
        ownerSurfaceId: String(surface.id),
        roomId: surface.roomId ?? null,
        kind: 'object-face',
        surfaceType: 'object',
        surfaceIndex: surface.face || null,
        objectId: surface.ownerId || null,
        face: surface.face || null,
        origin,
        tangent,
        bitangent,
        normal,
        uMin,
        uMax,
        vMin,
        vMax,
        vertices: vertices.map(vertex => [...vertex]),
        centroid: [...surface.centroid],
        area: Math.max(1e-5, Number(surface.area) || (uMax - uMin) * (vMax - vMin)),
        geometryConfidence: surface.meshTriangleCount > 0 ? 0.58 : 0.42,
        source: surface.meshTriangleCount > 0 ? 'rgb-object-mesh-face-proxy' : 'object-obb-face-proxy',
      });
    }
    return zones;
  }

  function buildGaussianZones(gaussians, primaryZones, options = {}) {
    const zones = [];
    const maximum = options.maximumGaussianZones || 5000;
    const primaryByOwner = new Map();
    for (const zone of primaryZones) {
      if (!primaryByOwner.has(zone.ownerSurfaceId)) primaryByOwner.set(zone.ownerSurfaceId, []);
      primaryByOwner.get(zone.ownerSurfaceId).push(zone);
    }
    for (const gaussian of (gaussians || []).slice(0, maximum)) {
      if (!finitePoint(gaussian.center) || !finitePoint(gaussian.normal)) continue;
      let parent = null;
      let bestScore = Infinity;
      for (const zone of primaryZones) {
        if (gaussian.roomId != null && zone.roomId != null && String(zone.roomId) !== String(gaussian.roomId)) continue;
        const alignment = Math.abs(C.dot3(C.norm3(zone.normal), C.norm3(gaussian.normal)));
        if (alignment < 0.15) continue;
        const containment = zoneContainment(gaussian.center, zone);
        const planeDistance = Math.abs(C.dot3(C.sub3(gaussian.center, zone.origin), C.norm3(zone.normal)));
        const score = planeDistance + 1.45 * Math.min(2, containment.missDistance || 0) + 0.24 * (1 - alignment);
        if (score < bestScore) {
          bestScore = score;
          parent = zone;
        }
      }
      zones.push({
        id: `gaussian:${gaussian.id}`,
        ownerSurfaceId: parent?.ownerSurfaceId || `gaussian:${gaussian.id}`,
        parentZoneId: parent?.id || null,
        roomId: gaussian.roomId,
        kind: 'gaussian',
        surfaceType: gaussian.surfaceType || 'unassigned',
        surfaceIndex: gaussian.surfaceIndex ?? null,
        origin: [...gaussian.center],
        centroid: [...gaussian.center],
        normal: C.norm3(gaussian.normal),
        tangent: gaussian.tangent ? C.norm3(gaussian.tangent) : C.norm3(cross3(gaussian.normal, [0, 1, 0])),
        bitangent: gaussian.bitangent ? C.norm3(gaussian.bitangent) : C.norm3(cross3(gaussian.normal, gaussian.tangent || [1, 0, 0])),
        sigma: [...(gaussian.sigma || [0.12, 0.12, 0.03])],
        area: 2 * Math.PI * (gaussian.sigma?.[0] || 0.12) * (gaussian.sigma?.[1] || 0.12),
        geometryConfidence: gaussian.geometryConfidence ?? 0.35,
        support: gaussian.support || 0,
        views: gaussian.views || 0,
        color: gaussian.color || [128, 128, 128],
        source: 'metric-geometry-gaussian',
      });
    }
    return zones;
  }

  function acousticSurfaceLookup(acousticSurfaces) {
    const byId = new Map();
    for (const surface of acousticSurfaces || []) byId.set(String(surface.id), surface);
    return byId;
  }

  function attachVisualPriors(zones, acousticSurfaces) {
    const lookup = acousticSurfaceLookup(acousticSurfaces);
    for (const zone of zones) {
      const surface = lookup.get(String(zone.ownerSurfaceId));
      if (!surface) continue;
      zone.priorAlpha = Array.isArray(surface.material?.alpha) ? [...surface.material.alpha] : null;
      zone.priorScattering = Number.isFinite(surface.material?.scattering) ? surface.material.scattering : null;
      zone.priorMaterial = surface.material?.key || null;
      zone.priorSource = surface.material?.source || 'visual-prior';
    }
    return zones;
  }

  function buildAcousticZones(rooms, gaussians = [], acousticSurfaces = [], options = {}) {
    const primary = [];
    for (const room of rooms || []) {
      if (!room?.model) continue;
      primary.push(...buildHorizontalZones(room), ...buildWallZones(room, options));
    }
    // Objects are not reduced to decorative metadata. Their six OBB-aligned
    // face groups are valid acoustic candidates and are linked back to the
    // corresponding RGB voxel-mesh triangle labels through ownerSurfaceId.
    primary.push(...buildObjectFaceZones(acousticSurfaces));
    attachVisualPriors(primary, acousticSurfaces);
    const gaussianZones = buildGaussianZones(gaussians, primary, options);
    attachVisualPriors(gaussianZones, acousticSurfaces);
    return {
      primary,
      gaussians: gaussianZones,
      all: [...primary, ...gaussianZones],
      generatedAt: new Date().toISOString(),
      schema: 'room-scanner-acoustic-zones-v2',
    };
  }

  function candidateForZone(source, receiver, zone, options = {}) {
    return zone.kind === 'gaussian'
      ? gaussianPathCandidate(source, receiver, zone, options.speedOfSound || SPEED_OF_SOUND)
      : planePathCandidate(source, receiver, zone, options.speedOfSound || SPEED_OF_SOUND);
  }

  function candidateLikelihood(observedDelaySeconds, candidate, zone, options = {}) {
    const baseTimingSigma = options.timingSigmaSeconds || 0.00042;
    const geometrySigma = (1 - clamp(zone.geometryConfidence ?? 0.4)) * (options.geometryTimingPenaltySeconds || 0.0012);
    const timingSigma = Math.max(1 / (options.sampleRate || 48000), baseTimingSigma + geometrySigma);
    const residual = observedDelaySeconds - candidate.relativeDelaySeconds;
    const timing = Math.exp(-0.5 * (residual / timingSigma) ** 2);
    const containment = clamp(candidate.containment?.score ?? 1, 0.001, 1);
    const specular = clamp(candidate.specular ?? 0.5, 0.001, 1);
    const geometryConfidence = clamp(0.10 + 0.90 * (zone.geometryConfidence ?? 0.35), 0.1, 1);
    const pathPenalty = 1 / (1 + 0.035 * candidate.pathLength * candidate.pathLength);
    const gaussianPenalty = zone.kind === 'gaussian' ? (options.gaussianPriorWeight || 0.55) : 1;
    const likelihood = timing * Math.pow(containment, 0.7) * Math.pow(specular, 0.8) * geometryConfidence * pathPenalty * gaussianPenalty;
    return { likelihood, residualSeconds: residual, timingSigma, timing, containment, specular };
  }

  function associateEchoPeak(peak, source, receiver, zones, options = {}) {
    const candidates = [];
    for (const zone of zones || []) {
      if (options.roomId != null && zone.roomId != null && String(zone.roomId) !== String(options.roomId)) continue;
      const path = candidateForZone(source, receiver, zone, options);
      if (!path) continue;
      if (path.relativeDelaySeconds < (options.minimumDelaySeconds || 0.00045)) continue;
      if (path.relativeDelaySeconds > (options.maximumDelaySeconds || 0.095)) continue;
      const score = candidateLikelihood(peak.delaySeconds, path, zone, options);
      if (score.likelihood < (options.minimumLikelihood || 1e-7)) continue;
      candidates.push({
        zoneId: zone.id,
        ownerSurfaceId: path.ownerSurfaceId,
        zoneKind: zone.kind,
        roomId: zone.roomId,
        reflectionPoint: path.reflectionPoint,
        predictedDelaySeconds: path.relativeDelaySeconds,
        observedDelaySeconds: peak.delaySeconds,
        pathLength: path.pathLength,
        directLength: path.directLength,
        spreadingCorrection: path.geometricSpreadingCorrection,
        geometryConfidence: zone.geometryConfidence ?? 0.35,
        ...score,
      });
    }
    candidates.sort((a, b) => b.likelihood - a.likelihood);
    const limited = candidates.slice(0, options.maximumCandidatesPerEcho || 10);
    const unassignedPrior = options.unassignedPrior ?? 0.001;
    // Likelihoods include geometric spreading, containment and timing terms and
    // are therefore naturally small. The unassigned class is expressed in the
    // same likelihood scale; a large probability-like constant would swallow
    // even an exact image-source match. Callers may raise it for deliberately
    // conservative or noisy captures.
    const normalizer = unassignedPrior + limited.reduce((sum, candidate) => sum + candidate.likelihood, 0);
    for (const candidate of limited) candidate.posterior = candidate.likelihood / Math.max(EPS, normalizer);
    return {
      peak,
      candidates: limited,
      unassignedPosterior: unassignedPrior / Math.max(EPS, normalizer),
      entropy: posteriorEntropy([...limited.map(candidate => candidate.posterior), unassignedPrior / Math.max(EPS, normalizer)]),
    };
  }

  function posteriorEntropy(probabilities) {
    let entropy = 0;
    for (const probability of probabilities || []) {
      if (probability > EPS) entropy -= probability * Math.log(probability);
    }
    const maximum = Math.log(Math.max(2, probabilities?.length || 2));
    return maximum > 0 ? entropy / maximum : 0;
  }

  function localEnergy(signal, center, halfWidth) {
    let sum = 0;
    const start = Math.max(0, center - halfWidth);
    const end = Math.min(signal.length, center + halfWidth + 1);
    for (let index = start; index < end; index += 1) sum += signal[index] * signal[index];
    return sum / Math.max(1, end - start);
  }

  function bandPeakEnergyRatios(ir, sampleRate, directIndex, peak, bands = DEFAULT_BANDS, options = {}) {
    const directHalfWidth = Math.max(3, Math.round(sampleRate * (options.directWindowSeconds || 0.00075)));
    const echoHalfWidth = Math.max(3, Math.round(sampleRate * (options.echoWindowSeconds || 0.0011)));
    const output = [];
    for (const centerFrequency of bands) {
      if (centerFrequency >= sampleRate * 0.45) {
        output.push(null);
        continue;
      }
      const filtered = S.octaveFilter(ir, sampleRate, centerFrequency);
      const directEnergy = localEnergy(filtered, directIndex, directHalfWidth);
      const echoEnergy = localEnergy(filtered, peak.sample, echoHalfWidth);
      output.push({
        centerFrequency,
        directEnergy,
        echoEnergy,
        ratio: echoEnergy / Math.max(EPS, directEnergy),
      });
    }
    return output;
  }

  function analyzeRIR(ir, sampleRate, directIndex, options = {}) {
    const bands = options.bands || DEFAULT_BANDS;
    const peaks = S.detectEchoPeaks(ir, sampleRate, directIndex, {
      minimumDelayMs: 1000 * (options.minimumEchoDelaySeconds ?? 0.0012),
      maximumDelayMs: 1000 * (options.maximumEchoDelaySeconds ?? 0.095),
      maximumPeaks: options.maximumPeaks || 18,
      minimumSnrDb: options.minimumPeakSnrDb || 5.5,
      minimumSeparationMs: 1000 * (options.peakSeparationSeconds ?? 0.0018),
      energyWindowMs: options.peakEnergyWindowMs ?? 0.65,
    });
    const decay = bands.map(center => center < sampleRate * 0.45 ? S.decayMetrics(ir, sampleRate, center, directIndex) : null);
    const broadbandDecay = S.decayMetrics(ir, sampleRate, null, directIndex);
    for (const peak of peaks) peak.bandEnergy = bandPeakEnergyRatios(ir, sampleRate, directIndex, peak, bands, options);
    return {
      peaks,
      decay,
      broadbandDecay,
      peakToTailDb: S.peakToTailDb(ir, directIndex),
      bands: [...bands],
    };
  }

  function deconvolveMeasurement(record, options = {}) {
    const recording = record.recording instanceof Float32Array ? record.recording : S.int16ToFloat(record.recording || new Int16Array());
    const sweep = record.sweep instanceof Float32Array ? record.sweep : Float32Array.from(record.sweep || []);
    const sampleRate = record.sampleRate || options.sampleRate || 48000;
    if (!recording.length || !sweep.length) return { ok: false, reason: 'missing-audio' };
    let onset = Number(record.onsetSample);
    let detection = null;
    if (!Number.isFinite(onset)) {
      const expected = Number.isFinite(record.expectedOnsetSample) ? [record.expectedOnsetSample] : [];
      const searchSeconds = options.onsetSearchSeconds || 0.78;
      const detected = S.detectSweepOnsets(recording, sweep, expected, {
        sampleRate,
        minLagSeconds: options.minimumOnsetLagSeconds ?? -0.05,
        maxLagSeconds: options.maximumOnsetLagSeconds ?? searchSeconds,
        minimumScore: options.minimumSweepScore || 0.10,
      });
      detection = detected[0] || null;
      onset = detection?.found ? detection.onsetSample : null;
    }
    if (!Number.isFinite(onset)) return { ok: false, reason: 'sweep-not-detected', detection };
    const extracted = S.extractSweepRIR(recording, sweep, onset, sampleRate, {
      preSeconds: options.preSeconds || 0.045,
      tailSeconds: options.tailSeconds || 2.6,
      fLow: options.fLow || 90,
      fHigh: options.fHigh || Math.min(15000, sampleRate * 0.44),
      noiseSeconds: options.noiseSeconds || 0.24,
      kirkeby: options.kirkeby || { floorDb: -47, maximumBoostDb: 22, noiseFactor: 2.4 },
    });
    const analysis = analyzeRIR(extracted.ir, sampleRate, extracted.directIndex, options);
    return {
      ok: true,
      sampleRate,
      onsetSample: onset,
      detection,
      ...extracted,
      analysis,
      // Unknown output/input latency shifts onset and rawDirectIndex together.
      // The aligned RIR directIndex is zero-reference for all echo geometry.
      latencyInvariant: true,
    };
  }

  function analyzeMeasurement(record, zones, options = {}) {
    const deconvolved = record.ir
      ? {
          ok: true,
          ir: record.ir instanceof Float32Array ? record.ir : Float32Array.from(record.ir),
          directIndex: Number(record.directIndex) || 0,
          sampleRate: record.sampleRate || 48000,
          analysis: analyzeRIR(record.ir instanceof Float32Array ? record.ir : Float32Array.from(record.ir), record.sampleRate || 48000, Number(record.directIndex) || 0, options),
          latencyInvariant: true,
        }
      : deconvolveMeasurement(record, options);
    if (!deconvolved.ok) return { ...deconvolved, id: record.id };
    const source = record.sourcePosition;
    const receiver = record.receiverPosition || record.pose?.p;
    if (!finitePoint(source) || !finitePoint(receiver)) return { ok: false, id: record.id, reason: 'missing-metric-pose', deconvolved };
    const associations = deconvolved.analysis.peaks.map(peak => associateEchoPeak(peak, source, receiver, zones, {
      ...options,
      sampleRate: deconvolved.sampleRate,
      roomId: record.roomId,
    }));
    const expectedOnsetSample = Number(record.expectedOnsetSample);
    const detectedOnsetSample = Number(deconvolved.onsetSample ?? record.onsetSample);
    const onsetLagSeconds = Number.isFinite(expectedOnsetSample) && Number.isFinite(detectedOnsetSample)
      ? (detectedOnsetSample - expectedOnsetSample) / deconvolved.sampleRate
      : null;
    const directPathLength = C.len3(C.sub3(receiver, source));
    const directPropagationSeconds = directPathLength / (options.speedOfSound || SPEED_OF_SOUND);
    const residualElectroacousticLatencySeconds = Number.isFinite(onsetLagSeconds)
      ? onsetLagSeconds - directPropagationSeconds
      : null;
    return {
      ok: true,
      id: record.id,
      roomId: record.roomId,
      sourcePosition: [...source],
      receiverPosition: [...receiver],
      sampleRate: deconvolved.sampleRate,
      ir: deconvolved.ir,
      directIndex: deconvolved.directIndex,
      analysis: deconvolved.analysis,
      associations,
      latency: {
        expectedOnsetSample: Number.isFinite(expectedOnsetSample) ? expectedOnsetSample : null,
        detectedOnsetSample: Number.isFinite(detectedOnsetSample) ? detectedOnsetSample : null,
        onsetLagSeconds,
        directPathLengthMeters: directPathLength,
        directPropagationSeconds,
        residualElectroacousticLatencySeconds,
        correlationSelection: deconvolved.detection?.selection || record.onsetDetection?.selection || null,
        correlationScore: deconvolved.detection?.score ?? record.onsetDetection?.score ?? null,
        directAligned: true,
        outputLatencySeconds: record.outputLatencySeconds ?? null,
        baseLatencySeconds: record.baseLatencySeconds ?? null,
        clockMapResidualMs: record.clockMap?.residualMadMs ?? record.clockMapResidualMs ?? null,
      },
      quality: measurementQuality(deconvolved, associations, record),
      metadata: record.metadata || {},
    };
  }

  function measurementQuality(deconvolved, associations, record = {}) {
    const peakTail = deconvolved.analysis?.peakToTailDb ?? -Infinity;
    const dynamicScore = clamp((peakTail - 12) / 34, 0, 1);
    const associated = associations.filter(item => item.candidates?.[0]?.posterior > 0.35).length;
    const associationScore = clamp(associated / Math.max(3, associations.length), 0, 1);
    const tracking = clamp(record.poseConfidence ?? record.pose?.confidence ?? 0.7, 0, 1);
    const processingDisabled = record.audioSettings?.echoCancellation === false
      && record.audioSettings?.noiseSuppression === false
      && record.audioSettings?.autoGainControl === false;
    const audioScore = processingDisabled ? 1 : 0.58;
    return {
      dynamicScore,
      associationScore,
      tracking,
      audioScore,
      score: 0.35 * dynamicScore + 0.30 * associationScore + 0.22 * tracking + 0.13 * audioScore,
      warnings: [
        ...(dynamicScore < 0.3 ? ['low-rir-dynamic-range'] : []),
        ...(tracking < 0.45 ? ['weak-webxr-pose'] : []),
        ...(!processingDisabled ? ['browser-audio-processing-active-or-unknown'] : []),
      ],
    };
  }

  function weightedMedian(entries) {
    const active = entries.filter(entry => Number.isFinite(entry.value) && entry.weight > 0).sort((a, b) => a.value - b.value);
    if (!active.length) return null;
    const total = active.reduce((sum, entry) => sum + entry.weight, 0);
    let accumulated = 0;
    for (const entry of active) {
      accumulated += entry.weight;
      if (accumulated >= total * 0.5) return entry.value;
    }
    return active[active.length - 1].value;
  }

  function roomAreaVolume(room) {
    const model = room?.fittedModel || room?.model;
    if (!model) return { volume: 0, area: 0 };
    const wallArea = model.walls.reduce((sum, wall) => sum + wall.length * model.height, 0);
    return { volume: model.area * model.height, area: 2 * model.area + wallArea };
  }

  function lateFieldAbsorption(room, analyses, bands = DEFAULT_BANDS) {
    const { volume, area } = roomAreaVolume(room);
    const estimates = bands.map((band, bandIndex) => {
      const rtValues = [];
      for (const measurement of analyses) {
        if (String(measurement.roomId) !== String(room.id)) continue;
        const decay = measurement.analysis?.decay?.[bandIndex];
        const rt = decay?.t30 || decay?.t20 || decay?.edt;
        if (rt > 0.08 && rt < 8) rtValues.push(rt);
      }
      const rt60 = S.median(rtValues);
      const alpha = rt60 > 0 && volume > 0 && area > 0
        ? clamp(1 - Math.exp(-0.161 * volume / (area * rt60)), 0.01, 0.92)
        : null;
      return { band, rt60: Number.isFinite(rt60) ? rt60 : null, alpha, support: rtValues.length };
    });
    return { roomId: room.id, volume, area, bands: estimates };
  }

  function inferZoneAbsorption(measurements, zoneModel, rooms, options = {}) {
    const bands = options.bands || DEFAULT_BANDS;
    const primaryZones = zoneModel?.primary || [];
    const zoneById = new Map((zoneModel?.all || primaryZones).map(zone => [zone.id, zone]));
    const primaryByOwner = new Map();
    for (const zone of primaryZones) {
      if (!primaryByOwner.has(zone.ownerSurfaceId)) primaryByOwner.set(zone.ownerSurfaceId, []);
      primaryByOwner.get(zone.ownerSurfaceId).push(zone);
    }
    const evidence = new Map();
    for (const zone of primaryZones) evidence.set(zone.id, bands.map(() => []));

    for (const measurement of measurements.filter(item => item.ok)) {
      const quality = clamp(measurement.quality?.score ?? 0.5, 0.05, 1);
      for (const association of measurement.associations || []) {
        const peak = association.peak;
        for (const candidate of association.candidates || []) {
          if (candidate.posterior < (options.minimumPosterior || 0.12)) continue;
          let targetZone = zoneById.get(candidate.zoneId);
          if (!targetZone) continue;
          if (targetZone.kind === 'gaussian') {
            targetZone = primaryZones.find(zone => zone.id === targetZone.parentZoneId)
              || primaryByOwner.get(targetZone.ownerSurfaceId)?.[0]
              || null;
          }
          if (!targetZone || !evidence.has(targetZone.id)) continue;
          for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
            const energy = peak.bandEnergy?.[bandIndex];
            if (!energy || !(energy.ratio > 0)) continue;
            // Energy reflection coefficient after a first-order spherical
            // spreading correction. Directivity and residual gain uncertainty
            // are deliberately absorbed by robust aggregation and late-field
            // shrinkage instead of pretending to know them exactly.
            const reflectedEnergy = clamp(energy.ratio * candidate.spreadingCorrection, 0, 1.35);
            const alphaObservation = clamp(1 - reflectedEnergy, 0.01, 0.99);
            const timingScore = Math.exp(-0.5 * (candidate.residualSeconds / candidate.timingSigma) ** 2);
            const weight = quality
              * candidate.posterior
              * timingScore
              * clamp(candidate.geometryConfidence, 0.08, 1)
              * clamp(peak.snrDb / 24, 0.08, 1);
            evidence.get(targetZone.id)[bandIndex].push({
              value: alphaObservation,
              weight,
              measurementId: measurement.id,
              posterior: candidate.posterior,
              timingResidualMs: candidate.residualSeconds * 1000,
              reflectionPoint: candidate.reflectionPoint,
            });
          }
        }
      }
    }

    const lateByRoom = new Map();
    for (const room of rooms || []) lateByRoom.set(String(room.id), lateFieldAbsorption(room, measurements, bands));
    const results = [];
    for (const zone of primaryZones) {
      const perBand = [];
      const roomLate = lateByRoom.get(String(zone.roomId));
      for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
        const observations = evidence.get(zone.id)?.[bandIndex] || [];
        const directEstimate = weightedMedian(observations);
        const totalWeight = observations.reduce((sum, entry) => sum + entry.weight, 0);
        const independentMeasurements = new Set(observations.map(entry => entry.measurementId)).size;
        const apertureConfidence = clamp((independentMeasurements - 1) / 5, 0, 1);
        const supportConfidence = clamp(totalWeight / 2.8, 0, 1);
        const prior = Number(zone.priorAlpha?.[bandIndex]);
        const late = roomLate?.bands?.[bandIndex]?.alpha;
        const directConfidence = supportConfidence * (0.45 + 0.55 * apertureConfidence);
        let alpha;
        let source;
        if (Number.isFinite(directEstimate)) {
          const directWeight = clamp(0.18 + 0.68 * directConfidence, 0.18, 0.86);
          const regularizer = Number.isFinite(late) ? late : Number.isFinite(prior) ? prior : 0.25;
          alpha = directWeight * directEstimate + (1 - directWeight) * regularizer;
          source = 'early-reflection-posterior+late-regularization';
        } else if (Number.isFinite(late)) {
          alpha = 0.72 * late + 0.28 * (Number.isFinite(prior) ? prior : late);
          source = 'late-field+visual-prior';
        } else {
          alpha = Number.isFinite(prior) ? prior : 0.25;
          source = Number.isFinite(prior) ? 'visual-prior-only' : 'default-unmeasured';
        }
        const spread = observations.length
          ? S.median(observations.map(entry => Math.abs(entry.value - (directEstimate ?? alpha))))
          : null;
        const confidence = clamp(
          0.60 * directConfidence
          + 0.22 * clamp(roomLate?.bands?.[bandIndex]?.support / 4, 0, 1)
          + 0.18 * clamp(zone.geometryConfidence ?? 0.35, 0, 1),
          0,
          directEstimate == null ? 0.48 : 0.92,
        );
        perBand.push({
          centerFrequency: bands[bandIndex],
          alpha: clamp(alpha, 0, 1),
          confidence,
          source,
          directEstimate,
          lateEstimate: late ?? null,
          visualPrior: Number.isFinite(prior) ? prior : null,
          observations: observations.length,
          independentMeasurements,
          totalWeight,
          robustSpread: spread,
        });
      }
      results.push({
        zoneId: zone.id,
        ownerSurfaceId: zone.ownerSurfaceId,
        roomId: zone.roomId,
        kind: zone.kind,
        surfaceType: zone.surfaceType,
        surfaceIndex: zone.surfaceIndex,
        centroid: zone.centroid || zone.origin,
        area: zone.area,
        alpha: perBand.map(item => item.alpha),
        confidence: perBand.map(item => item.confidence),
        bands: perBand,
        scattering: Number.isFinite(zone.priorScattering) ? zone.priorScattering : 0.18,
        inferredAt: new Date().toISOString(),
        model: 'probabilistic-image-source-gaussian-v2',
      });
    }
    return {
      schema: 'room-scanner-acoustic-inference-v2',
      bands: [...bands],
      zones: results,
      lateField: [...lateByRoom.values()],
      measurements: measurements.map(measurement => ({
        id: measurement.id,
        roomId: measurement.roomId,
        ok: measurement.ok,
        quality: measurement.quality,
        latency: measurement.latency,
        peakCount: measurement.analysis?.peaks?.length || 0,
        associatedPeaks: (measurement.associations || []).filter(item => item.candidates?.[0]?.posterior > 0.35).length,
      })),
      limitations: [
        'relative-delay-only: absolute hardware latency is not interpreted as propagation time',
        'single-bounce early-reflection model with local Gaussian alternatives',
        'absorption is an effective in-situ estimate regularized by late decay and visual priors',
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  function analyzeMeasurements(records, zoneModel, rooms, options = {}) {
    const zones = options.includeGaussians === false ? zoneModel.primary : zoneModel.all;
    const analyses = [];
    for (const record of records || []) {
      try {
        analyses.push(analyzeMeasurement(record, zones, options));
      } catch (error) {
        analyses.push({ ok: false, id: record?.id, reason: error?.message || String(error) });
      }
    }
    const inference = inferZoneAbsorption(analyses, zoneModel, rooms, options);
    return { analyses, inference };
  }

  function applyInferenceToAcousticSurfaces(acousticSurfaces, inference, options = {}) {
    const byOwner = new Map();
    for (const zone of inference?.zones || []) {
      if (!byOwner.has(zone.ownerSurfaceId)) byOwner.set(zone.ownerSurfaceId, []);
      byOwner.get(zone.ownerSurfaceId).push(zone);
    }
    for (const surface of acousticSurfaces || []) {
      const zones = byOwner.get(surface.id) || [];
      if (!zones.length || surface.material?.mode === 'manual' || surface.material?.source === 'user') continue;
      const weights = zones.map(zone => Math.max(0.01, zone.area || 1));
      const total = weights.reduce((sum, value) => sum + value, 0);
      surface.material = surface.material || {};
      surface.material.alpha = DEFAULT_BANDS.map((band, bandIndex) => zones.reduce((sum, zone, index) => sum + zone.alpha[bandIndex] * weights[index], 0) / total);
      surface.material.bandConfidence = DEFAULT_BANDS.map((band, bandIndex) => zones.reduce((sum, zone, index) => sum + zone.confidence[bandIndex] * weights[index], 0) / total);
      surface.material.confidence = surface.material.bandConfidence.reduce((sum, value) => sum + value, 0) / Math.max(1, surface.material.bandConfidence.length);
      surface.material.mode = 'inferred';
      surface.material.source = 'rir-zone-inference';
      surface.material.label = surface.material.label || 'Stima RIR per zone';
      surface.inferenceModel = inference.schema;
      surface.zoneIds = zones.map(zone => zone.zoneId);
      surface.updatedAt = new Date().toISOString();
    }
    return acousticSurfaces;
  }

  return {
    SPEED_OF_SOUND,
    DEFAULT_BANDS,
    reflectPointAcrossPlane,
    linePlaneIntersection,
    zoneContainment,
    planePathCandidate,
    gaussianPathCandidate,
    buildWallZones,
    buildHorizontalZones,
    buildObjectFaceZones,
    buildGaussianZones,
    buildAcousticZones,
    associateEchoPeak,
    posteriorEntropy,
    bandPeakEnergyRatios,
    analyzeRIR,
    deconvolveMeasurement,
    analyzeMeasurement,
    measurementQuality,
    lateFieldAbsorption,
    inferZoneAbsorption,
    analyzeMeasurements,
    applyInferenceToAcousticSurfaces,
  };
});
