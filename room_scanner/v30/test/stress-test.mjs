import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebXRCalibrationManager } from '../src/webxr-calibration-manager.js';
import {
  estimateRigidTransform3D,
  mat4TransformEuclideanPoint,
  projectReferencePointToView,
} from '../src/mat4.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5eedc0de);
function uniform(a, b) { return a + (b - a) * rand(); }
function gaussian() {
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function normalizeQuat(q) {
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
}
function randomQuat() {
  // Uniform random unit quaternion (Shoemake construction).
  const u1 = rand(), u2 = rand(), u3 = rand();
  const qx = Math.sqrt(1-u1) * Math.sin(2*Math.PI*u2);
  const qy = Math.sqrt(1-u1) * Math.cos(2*Math.PI*u2);
  const qz = Math.sqrt(u1) * Math.sin(2*Math.PI*u3);
  const qw = Math.sqrt(u1) * Math.cos(2*Math.PI*u3);
  return normalizeQuat([qw,qx,qy,qz]);
}
function rigidMatrix(qWxyz, t) {
  const [w,x,y,z] = normalizeQuat(qWxyz);
  const r00 = 1 - 2*(y*y+z*z), r01 = 2*(x*y-z*w), r02 = 2*(x*z+y*w);
  const r10 = 2*(x*y+z*w), r11 = 1 - 2*(x*x+z*z), r12 = 2*(y*z-x*w);
  const r20 = 2*(x*z-y*w), r21 = 2*(y*z+x*w), r22 = 1 - 2*(x*x+y*y);
  return [r00,r10,r20,0, r01,r11,r21,0, r02,r12,r22,0, t[0],t[1],t[2],1];
}
function identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function perspective90() {
  return [1,0,0,0, 0,1,0,0, 0,0,-1.002,-1, 0,0,-0.2002,0];
}
function percentile(values, q) {
  const a = [...values].sort((x,y)=>x-y);
  return a[Math.min(a.length-1, Math.max(0, Math.floor(q*(a.length-1))))];
}

const exactErrors = [];
const noisyErrors = [];
const iterations = 2000;
for (let k=0; k<iterations; k++) {
  const n = 3 + Math.floor(rand()*6);
  const src = [];
  for (let i=0; i<n; i++) {
    src.push([uniform(-1.5,1.5), uniform(-1.2,1.2), uniform(-2.5,-0.3)]);
  }
  const expected = rigidMatrix(randomQuat(), [uniform(-0.5,0.5),uniform(-0.5,0.5),uniform(-0.5,0.5)]);
  const exactTarget = src.map((p)=>mat4TransformEuclideanPoint(expected,p));
  const exactFit = estimateRigidTransform3D(src, exactTarget);
  if (!exactFit.ok) { k--; continue; } // random set happened too close to collinear.
  exactErrors.push(exactFit.rmseM);
  assert.ok(Number.isFinite(exactFit.rmseM));
  assert.ok(exactFit.rmseM < 1e-8, `exact fit residual ${exactFit.rmseM}`);

  const sigma = 0.003; // 3 mm per coordinate, intentionally larger than stable AR jitter in many frames.
  const noisyTarget = exactTarget.map((p)=>p.map((v)=>v + sigma*gaussian()));
  const noisyFit = estimateRigidTransform3D(src, noisyTarget);
  assert.equal(noisyFit.ok, true);
  assert.ok(Number.isFinite(noisyFit.rmseM));
  noisyErrors.push(noisyFit.rmseM);
}

// Deliberate outliers must exceed the 25 mm cross-session acceptance threshold.
let outlierRejected = 0;
for (let k=0; k<500; k++) {
  const src = [[-0.4,-0.3,-2],[0.5,-0.25,-2.1],[-0.35,0.45,-1.95],[0.4,0.4,-2.2]];
  const expected = rigidMatrix(randomQuat(), [uniform(-0.2,0.2),uniform(-0.2,0.2),uniform(-0.2,0.2)]);
  const dst = src.map((p)=>mat4TransformEuclideanPoint(expected,p));
  const victim = Math.floor(rand()*dst.length);
  dst[victim] = [dst[victim][0] + uniform(0.08,0.18), dst[victim][1], dst[victim][2]];
  const fit = estimateRigidTransform3D(src,dst);
  if (fit.ok && (fit.rmseM > 0.025 || fit.maxErrorM > 0.04)) outlierRejected++;
}
assert.ok(outlierRejected >= 480, `alignment-only outlier sensitivity unexpectedly low: ${outlierRejected}/500`);

// End-to-end verification also checks pairwise anchor geometry. That second,
// independent check must reject every 8-18 cm single-anchor corruption even in
// the rare cases where a least-squares rigid fit spreads the error below RMSE.
let verificationRejected = 0;
for (let k=0; k<500; k++) {
  const source = {
    a:[-0.4,-0.3,-2], b:[0.5,-0.25,-2.1], c:[-0.35,0.45,-1.95], d:[0.4,0.4,-2.2],
  };
  const expected = rigidMatrix(randomQuat(), [uniform(-0.2,0.2),uniform(-0.2,0.2),uniform(-0.2,0.2)]);
  const current = Object.fromEntries(Object.entries(source).map(([id,p])=>[id,mat4TransformEuclideanPoint(expected,p)]));
  const ids = Object.keys(current);
  const victim = ids[Math.floor(rand()*ids.length)];
  current[victim] = [current[victim][0] + uniform(0.08,0.18), current[victim][1], current[victim][2]];
  const manager = new WebXRCalibrationManager({storage:null});
  manager.calibration = {debug:true};
  manager.referencePinPositions = source;
  manager.referencePinGeometry = [];
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) {
    const pa=source[ids[i]], pb=source[ids[j]];
    manager.referencePinGeometry.push({a:ids[i],b:ids[j],distanceM:Math.hypot(pa[0]-pb[0],pa[1]-pb[1],pa[2]-pb[2])});
  }
  manager.framePinState = new Map(ids.map((id)=>[id,{
    pinId:id,label:id,tracked:true,locatable:true,visible:true,position:current[id],projections:[],
  }]));
  if (!manager.verifyCurrentFrame().ok) verificationRejected++;
}
assert.equal(verificationRejected,500);

// Exact collinear/near-zero-area geometry must fail.
for (let k=0; k<100; k++) {
  const eps = 1e-8;
  const src = [[0,0,-2],[0.5,0,-2],[1,eps*uniform(-1,1),-2]];
  const dst = src.map(([x,y,z])=>[x+0.2,y-0.1,z+0.05]);
  const fit = estimateRigidTransform3D(src,dst,{minTriangleArea2:1e-5});
  assert.equal(fit.ok,false);
  assert.equal(fit.reason,'degenerate-collinear-anchor-geometry');
}

// Frustum property test for the symmetric 90-degree camera used in unit tests.
const view = { transform:{inverse:{matrix:identity()}}, projectionMatrix:perspective90() };
let frustumCases = 0;
for (let k=0; k<20000; k++) {
  const z = -uniform(0.11,8);
  const x = uniform(-1.5,1.5) * (-z);
  const y = uniform(-1.5,1.5) * (-z);
  const expectedXY = Math.abs(x) <= -z && Math.abs(y) <= -z;
  const result = projectReferencePointToView([x,y,z],view,0);
  // All generated z are beyond near and within far for this projection's practical range.
  assert.equal(result.visible, expectedXY, `frustum mismatch at ${x},${y},${z}`);
  if (result.visible) {
    assert.ok(result.u >= 0 && result.u <= 1);
    assert.ok(result.v >= 0 && result.v <= 1);
  }
  frustumCases++;
}

// Public online image sanity check. It is an official TUM Freiburg1 RGB preview
// downloaded from the benchmark site and kept only as a small replay fixture.
const onlineFrame = path.join(__dirname,'online-data','tum_freiburg1_xyz_rgb_preview.png');
const stat = fs.statSync(onlineFrame);
assert.ok(stat.size > 100000, `online TUM frame unexpectedly small: ${stat.size}`);
const signature = fs.readFileSync(onlineFrame).subarray(0,8).toString('hex');
assert.equal(signature,'89504e470d0a1a0a');

const report = {
  seed:'0x5eedc0de',
  rigidFitExactCases: exactErrors.length,
  rigidFitExactMaxRmseM: Math.max(...exactErrors),
  rigidFitNoiseSigmaM:0.003,
  rigidFitNoisyMedianRmseM:percentile(noisyErrors,0.5),
  rigidFitNoisyP95RmseM:percentile(noisyErrors,0.95),
  rigidFitNoisyMaxRmseM:Math.max(...noisyErrors),
  deliberateOutlierCases:500,
  alignmentOnlyOutliersRejected:outlierRejected,
  endToEndOutlierVerificationsRejected:verificationRejected,
  collinearRejectedCases:100,
  frustumPropertyCases:frustumCases,
  onlineTumPreviewBytes:stat.size,
};
fs.writeFileSync(path.join(__dirname,'debug-stress-report.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
