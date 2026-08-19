/**
 * Minimal matrix / geometry helpers for WebXR/WebGL column-major 4x4 matrices.
 *
 * This file intentionally has no third-party dependencies. Besides keeping the
 * calibration patch offline-capable, that makes the numerical behaviour easy
 * to inspect in debugger traces and unit tests.
 */

export function mat4Multiply(a, b) {
  // Returns a * b using the same column-major layout used by WebGL/WebXR.
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4TransformPoint(m, point) {
  const [x, y, z] = point;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

export function mat4TransformEuclideanPoint(m, point) {
  const out = mat4TransformPoint(m, point);
  if (!Number.isFinite(out[3]) || Math.abs(out[3]) < 1e-12) return null;
  if (Math.abs(out[3] - 1) < 1e-12) return out.slice(0, 3);
  return [out[0] / out[3], out[1] / out[3], out[2] / out[3]];
}

export function matrixToArray(matrixLike) {
  if (!matrixLike) return null;
  return Array.from(matrixLike, Number);
}

export function translationFromMatrix(m) {
  return [Number(m[12]), Number(m[13]), Number(m[14])];
}

export function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function quaternionAngularDistanceRad(a, b) {
  // q and -q encode the same rotation, therefore use |dot|.
  const dot = Math.min(
    1,
    Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w),
  );
  return 2 * Math.acos(dot);
}

export function posePosition(poseLike) {
  const p = poseLike?.transform?.position;
  if (p) return [Number(p.x), Number(p.y), Number(p.z)];
  const m = poseLike?.transform?.matrix;
  return m ? translationFromMatrix(m) : null;
}

export function poseOrientation(poseLike) {
  const q = poseLike?.transform?.orientation;
  if (!q) return null;
  return { x: Number(q.x), y: Number(q.y), z: Number(q.z), w: Number(q.w) };
}

function centroid(points) {
  const c = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0]; c[1] += p[1]; c[2] += p[2];
  }
  return c.map((v) => v / points.length);
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function isFinitePoint3(point) {
  return Array.isArray(point) && point.length >= 3 &&
    Number.isFinite(Number(point[0])) &&
    Number.isFinite(Number(point[1])) &&
    Number.isFinite(Number(point[2]));
}

function isFiniteMat4(matrix) {
  if (!matrix || typeof matrix.length !== "number" || matrix.length < 16) return false;
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isFinite(Number(matrix[i]))) return false;
  }
  return true;
}

function maxTriangleDoubleArea(points) {
  let maxArea2 = 0;
  for (let i = 0; i < points.length - 2; i += 1) {
    for (let j = i + 1; j < points.length - 1; j += 1) {
      for (let k = j + 1; k < points.length; k += 1) {
        const a = sub3(points[j], points[i]);
        const b = sub3(points[k], points[i]);
        maxArea2 = Math.max(maxArea2, norm3(cross3(a, b)));
      }
    }
  }
  return maxArea2;
}

function jacobiLargestEigenvector4(symmetricMatrix) {
  // Jacobi rotations are deterministic and robust for this tiny symmetric 4x4
  // matrix. They avoid the failure mode of power iteration selecting the
  // eigenvector with largest magnitude rather than largest algebraic value.
  const a = symmetricMatrix.map((row) => row.slice());
  const v = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 4 }, (_, c) => (r === c ? 1 : 0)));

  for (let iteration = 0; iteration < 64; iteration += 1) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[p][q]);
    for (let r = 0; r < 4; r += 1) {
      for (let c = r + 1; c < 4; c += 1) {
        const value = Math.abs(a[r][c]);
        if (value > max) { max = value; p = r; q = c; }
      }
    }
    if (max < 1e-14) break;

    const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let k = 0; k < 4; k += 1) {
      const apk = a[p][k];
      const aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 4; k += 1) {
      const akp = a[k][p];
      const akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    // Re-symmetrize to suppress roundoff drift from the two-sided update.
    for (let r = 0; r < 4; r += 1) {
      for (let cc = r + 1; cc < 4; cc += 1) {
        const avg = 0.5 * (a[r][cc] + a[cc][r]);
        a[r][cc] = avg;
        a[cc][r] = avg;
      }
    }

    for (let k = 0; k < 4; k += 1) {
      const vkp = v[k][p];
      const vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }

  let best = 0;
  for (let i = 1; i < 4; i += 1) {
    if (a[i][i] > a[best][best]) best = i;
  }
  const out = [v[0][best], v[1][best], v[2][best], v[3][best]];
  const n = Math.hypot(...out);
  return n > 0 ? out.map((x) => x / n) : [1, 0, 0, 0];
}

function quaternionWxyzToRotationMatrix3(q) {
  let [w, x, y, z] = q;
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function rotationApply(r, p) {
  return [
    r[0][0] * p[0] + r[0][1] * p[1] + r[0][2] * p[2],
    r[1][0] * p[0] + r[1][1] * p[1] + r[1][2] * p[2],
    r[2][0] * p[0] + r[2][1] * p[1] + r[2][2] * p[2],
  ];
}

function rotationTranslationToMat4(r, t) {
  return new Float64Array([
    r[0][0], r[1][0], r[2][0], 0,
    r[0][1], r[1][1], r[2][1], 0,
    r[0][2], r[1][2], r[2][2], 0,
    t[0], t[1], t[2], 1,
  ]);
}

/**
 * Fits a rigid transform target ~= R * source + t using Horn's quaternion
 * absolute-orientation formulation. Scale is deliberately fixed to one because
 * WebXR reference-space changes are rigid, not similarity, transforms.
 */
export function estimateRigidTransform3D(sourcePoints, targetPoints, options = {}) {
  const minTriangleArea2 = options.minTriangleArea2 ?? 1e-5;
  if (!Array.isArray(sourcePoints) || !Array.isArray(targetPoints) ||
      sourcePoints.length !== targetPoints.length || sourcePoints.length < 3) {
    return { ok: false, reason: "need-at-least-3-corresponding-points" };
  }
  if (!sourcePoints.every(isFinitePoint3) || !targetPoints.every(isFinitePoint3)) {
    return { ok: false, reason: "non-finite-correspondence" };
  }

  const sourceArea2 = maxTriangleDoubleArea(sourcePoints);
  const targetArea2 = maxTriangleDoubleArea(targetPoints);
  if (sourceArea2 < minTriangleArea2 || targetArea2 < minTriangleArea2) {
    return {
      ok: false,
      reason: "degenerate-collinear-anchor-geometry",
      sourceMaxTriangleDoubleAreaM2: sourceArea2,
      targetMaxTriangleDoubleAreaM2: targetArea2,
      minTriangleArea2,
    };
  }

  const cs = centroid(sourcePoints);
  const ct = centroid(targetPoints);
  const s = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let i = 0; i < sourcePoints.length; i += 1) {
    const a = sub3(sourcePoints[i], cs);
    const b = sub3(targetPoints[i], ct);
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) s[r][c] += a[r] * b[c];
    }
  }

  const [sxx, sxy, sxz] = s[0];
  const [syx, syy, syz] = s[1];
  const [szx, szy, szz] = s[2];
  const trace = sxx + syy + szz;
  const n = [
    [trace, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];

  const quaternionWxyz = jacobiLargestEigenvector4(n);
  const rotation = quaternionWxyzToRotationMatrix3(quaternionWxyz);
  const rotatedCentroid = rotationApply(rotation, cs);
  const translation = [
    ct[0] - rotatedCentroid[0],
    ct[1] - rotatedCentroid[1],
    ct[2] - rotatedCentroid[2],
  ];
  const matrix = rotationTranslationToMat4(rotation, translation);

  const errorsM = sourcePoints.map((p, i) => {
    const mapped = mat4TransformEuclideanPoint(matrix, p);
    return distance3(mapped, targetPoints[i]);
  });
  const rmseM = Math.sqrt(errorsM.reduce((sum, e) => sum + e * e, 0) / errorsM.length);

  return {
    ok: true,
    matrix: matrixToArray(matrix),
    quaternionWxyz,
    translation,
    rmseM,
    maxErrorM: Math.max(...errorsM),
    errorsM,
    pointCount: sourcePoints.length,
    sourceMaxTriangleDoubleAreaM2: sourceArea2,
    targetMaxTriangleDoubleAreaM2: targetArea2,
  };
}

/**
 * Projects a point expressed in the current XR reference space into an XRView.
 * Returned u/v are normalized viewport coordinates: (0,0)=top-left,
 * (1,1)=bottom-right.
 */
export function projectReferencePointToView(point, view, margin = 0) {
  if (!view?.transform?.inverse?.matrix || !view?.projectionMatrix) {
    return { visible: false, reason: "missing-view-matrices" };
  }
  if (!isFinitePoint3(point)) {
    return { visible: false, reason: "invalid-reference-point" };
  }

  const viewMatrix = view.transform.inverse.matrix;
  const projection = view.projectionMatrix;
  if (!isFiniteMat4(viewMatrix) || !isFiniteMat4(projection)) {
    return { visible: false, reason: "invalid-view-matrices" };
  }
  const viewPoint = mat4TransformPoint(viewMatrix, point);
  const clip = mat4TransformPoint(projection, viewPoint.slice(0, 3));
  const w = clip[3];

  // For the standard WebXR/OpenGL camera, points in front have positive clip W.
  if (!Number.isFinite(w) || w <= 0) {
    return { visible: false, reason: "behind-camera", clipW: w };
  }

  const x = clip[0] / w;
  const y = clip[1] / w;
  const z = clip[2] / w;
  const visible =
    x >= -1 - margin && x <= 1 + margin &&
    y >= -1 - margin && y <= 1 + margin &&
    z >= -1 && z <= 1;

  return {
    visible,
    reason: visible ? "inside-frustum" : "outside-frustum",
    ndc: { x, y, z },
    u: (x + 1) * 0.5,
    v: (1 - y) * 0.5,
    clipW: w,
  };
}
