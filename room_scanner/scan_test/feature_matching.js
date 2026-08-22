/*
 * Deterministic photographic correspondence for Scan Test.
 *
 * AlvaAR remains the only pose authority.  This module associates frozen RGB
 * frames so that an offline pass can demonstrate whether the photographs
 * actually overlap, even while a fresh Alva instance is still initializing.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const PAIRS = makePairs(128, 7);

export function detectScanFeatures(gray, width, height, alvaPoints = [], { maxFeatures = 360, cell = 16 } = {}) {
  if (!gray?.length || width < 18 || height < 18) return [];
  const candidates = [];
  const occupied = new Set();
  const add = (x, y, score, source) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 8 || y < 8 || x >= width - 8 || y >= height - 8 || !Number.isFinite(score)) return;
    const key = `${Math.round(x / 5)}:${Math.round(y / 5)}`;
    if (occupied.has(key)) return;
    const angle = patchOrientation(gray, width, height, x, y);
    const brief = orientedBrief(gray, width, height, x, y, angle);
    if (!brief) return;
    occupied.add(key);
    candidates.push({ x, y, score, angle, brief, source });
  };

  // Alva's own current keypoints are first-class proposals, but not assumed to
  // carry stable public IDs.  The BRIEF/ZNCC test below verifies their image
  // identity independently on the archived raster.
  for (const p of (alvaPoints || []).slice(0, Math.min(140, maxFeatures >> 1))) add(p?.x, p?.y, 1e9 + Number(p?.score || 0), 'alva-track');

  // One high-Harris point per regular cell keeps a useful spread on a wall and
  // prevents a single textured object from monopolising all correspondences.
  for (let cy = 8; cy < height - 8; cy += cell) {
    for (let cx = 8; cx < width - 8; cx += cell) {
      let best = null;
      const yEnd = Math.min(height - 8, cy + cell), xEnd = Math.min(width - 8, cx + cell);
      for (let y = cy; y < yEnd; y += 2) {
        for (let x = cx; x < xEnd; x += 2) {
          const score = harrisScore(gray, width, height, x, y);
          if (!best || score > best.score) best = { x, y, score };
        }
      }
      if (best && best.score > 2.5e5) add(best.x, best.y, best.score, 'photo-corner');
    }
  }
  return candidates.sort((a, b) => (b.source === 'alva-track') - (a.source === 'alva-track') || b.score - a.score).slice(0, maxFeatures);
}

export function matchArchivedFrames(reference, current, { maxFeatures = 280, maxMatches = 180, maxHamming = 72, minZncc = -0.25 } = {}) {
  const A = rank(reference?.features, maxFeatures), B = rank(current?.features, maxFeatures);
  if (!A.length || !B.length || !reference?.gray?.length || !current?.gray?.length) return emptyAssociation(A.length, B.length);
  const bestA = new Array(A.length), bestB = new Array(B.length);
  for (let i = 0; i < A.length; i++) {
    let best = null, second = null;
    for (let j = 0; j < B.length; j++) {
      const ham = hamming128(A[i].brief, B[j].brief);
      if (ham > maxHamming) continue;
      const zncc = patchZncc(reference.gray, reference.width, reference.height, A[i].x, A[i].y, current.gray, current.width, current.height, B[j].x, B[j].y, 3);
      if (zncc < minZncc) continue;
      const score = ham / 128 + .22 * (1 - zncc) * .5;
      const item = { i, j, ham, zncc, score };
      if (!best || score < best.score) { second = best; best = item; }
      else if (!second || score < second.score) second = item;
    }
    if (best) { best.ratio = second ? best.score / Math.max(1e-6, second.score) : 0; bestA[i] = best; }
  }
  for (let j = 0; j < B.length; j++) {
    let best = null;
    for (let i = 0; i < A.length; i++) {
      const item = bestA[i];
      if (!item || item.j !== j) continue;
      if (!best || item.score < best.score) best = item;
    }
    if (best) bestB[j] = best;
  }
  const mutual = [];
  for (let i = 0; i < A.length; i++) {
    const item = bestA[i];
    if (!item || bestB[item.j] !== item) continue;
    const uniqueness = clamp((.96 - item.ratio) / .42, 0, 1);
    const descriptor = sigmoid((54 - item.ham) / 8);
    const photo = clamp((item.zncc + .15) / 1.15, 0, 1);
    const probability = Math.pow(Math.max(1e-7, uniqueness * descriptor * photo), 1 / 3);
    if (probability < .025) continue;
    mutual.push({
      ax: A[i].x, ay: A[i].y, bx: B[item.j].x, by: B[item.j].y,
      hamming: item.ham, zncc: item.zncc, ratio: item.ratio, probability,
      distance: item.score, source: `${A[i].source}+${B[item.j].source}`,
    });
  }
  const consensus = translationConsensus(mutual);
  // Do not make the consensus a destructive filter: perspective/parallax can
  // legitimately violate a single image translation.  It is a confidence mark
  // for diagnostics and downstream pair selection only.
  const matches = mutual.map((m, i) => ({ ...m, consistent: consensus.ids.has(i) })).sort((a, b) => b.probability - a.probability).slice(0, maxMatches);
  return { matches, sourceFeatures: A.length, targetFeatures: B.length, mutualMatches: mutual.length, consensusMatches: matches.filter(m => m.consistent).length, dx: consensus.dx, dy: consensus.dy, thresholdPx: consensus.thresholdPx };
}

function emptyAssociation(sourceFeatures = 0, targetFeatures = 0) { return { matches: [], sourceFeatures, targetFeatures, mutualMatches: 0, consensusMatches: 0, dx: NaN, dy: NaN, thresholdPx: NaN }; }
function rank(features, max) { return (features || []).filter(f => f?.brief?.length === 4 && Number.isFinite(f.x) && Number.isFinite(f.y)).sort((a, b) => (b.source === 'alva-track') - (a.source === 'alva-track') || b.score - a.score).slice(0, max); }
function harrisScore(gray, w, h, x, y) {
  let a = 0, b = 0, c = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = (y + dy) * w + x + dx, gx = gray[i + 1] - gray[i - 1], gy = gray[i + w] - gray[i - w];
    a += gx * gx; b += gx * gy; c += gy * gy;
  }
  const trace = a + c;
  return a * c - b * b - .045 * trace * trace;
}
function patchOrientation(gray, w, h, x, y) {
  let mx = 0, my = 0;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    if (dx * dx + dy * dy > 28) continue;
    const v = gray[(y + dy) * w + x + dx]; mx += dx * v; my += dy * v;
  }
  return Math.hypot(mx, my) > 1e-5 ? Math.atan2(my, mx) : 0;
}
function orientedBrief(gray, w, h, x, y, angle) {
  if (x < 8 || y < 8 || x >= w - 8 || y >= h - 8) return null;
  const ca = Math.cos(angle), sa = Math.sin(angle), out = new Uint32Array(4);
  for (let k = 0; k < 128; k++) {
    const p = PAIRS[k], ax = Math.round(x + p[0] * ca - p[1] * sa), ay = Math.round(y + p[0] * sa + p[1] * ca), bx = Math.round(x + p[2] * ca - p[3] * sa), by = Math.round(y + p[2] * sa + p[3] * ca);
    if (gray[ay * w + ax] < gray[by * w + bx]) out[k >>> 5] |= (1 << (k & 31)) >>> 0;
  }
  return out;
}
function patchZncc(a, aw, ah, ax, ay, b, bw, bh, bx, by, radius) {
  ax = Math.round(ax); ay = Math.round(ay); bx = Math.round(bx); by = Math.round(by);
  if (ax - radius < 0 || ay - radius < 0 || ax + radius >= aw || ay + radius >= ah || bx - radius < 0 || by - radius < 0 || bx + radius >= bw || by + radius >= bh) return -1;
  let ma = 0, mb = 0, n = 0;
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) { ma += a[(ay + y) * aw + ax + x]; mb += b[(by + y) * bw + bx + x]; n++; }
  ma /= n; mb /= n; let aa = 0, bb = 0, ab = 0;
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) { const da = a[(ay + y) * aw + ax + x] - ma, db = b[(by + y) * bw + bx + x] - mb; aa += da * da; bb += db * db; ab += da * db; }
  return aa > 1 && bb > 1 ? clamp(ab / Math.sqrt(aa * bb), -1, 1) : -1;
}
function translationConsensus(matches) {
  if (!matches.length) return { ids: new Set(), dx: NaN, dy: NaN, thresholdPx: NaN };
  const dx = median(matches.map(m => m.bx - m.ax)), dy = median(matches.map(m => m.by - m.ay));
  const residuals = matches.map(m => Math.hypot((m.bx - m.ax) - dx, (m.by - m.ay) - dy)), mad = median(residuals.map(r => Math.abs(r - median(residuals))));
  const thresholdPx = clamp(5 + 3 * (Number.isFinite(mad) ? mad : 0), 5, 20), ids = new Set();
  for (let i = 0; i < residuals.length; i++) if (residuals[i] <= thresholdPx) ids.add(i);
  return { ids, dx, dy, thresholdPx };
}
function hamming128(a, b) { let n = 0; for (let i = 0; i < 4; i++) n += popcnt((a[i] ^ b[i]) >>> 0); return n; }
function popcnt(x) { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function median(values) { const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b); if (!sorted.length) return NaN; const i = sorted.length >> 1; return sorted.length & 1 ? sorted[i] : (sorted[i - 1] + sorted[i]) * .5; }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function makePairs(count, radius) { let state = 0x9e3779b9 >>> 0; const random = () => { state = (Math.imul(state ^ state >>> 15, 1 | state) + (state ^ Math.imul(state ^ state >>> 7, 61 | state))) ^ state; state ^= state >>> 14; return (state >>> 0) / 4294967296; }; const out = []; for (let i = 0; i < count; i++) { let ax, ay, bx, by; do { ax = Math.round((random() * 2 - 1) * radius); ay = Math.round((random() * 2 - 1) * radius); bx = Math.round((random() * 2 - 1) * radius); by = Math.round((random() * 2 - 1) * radius); } while (ax === bx && ay === by); out.push([ax, ay, bx, by]); } return out; }
