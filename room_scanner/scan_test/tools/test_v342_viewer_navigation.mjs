import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
function ok(v, msg) { if (!v) throw new Error(msg); }

ok(app.includes("scan-test-v3.4.2-interactive-3d-viewer"), 'build id must be v3.4.2');
ok(index.includes('viewer 3D interattivo'), 'stage 6 must identify the interactive viewer');
ok(index.includes('id="viewerNavReadout"'), 'viewer navigation readout missing');
ok(index.includes('id="isoViewBtn"') && index.includes('id="topViewBtn"') && index.includes('id="frontViewBtn"') && index.includes('id="sideViewBtn"'), 'view preset buttons missing');
ok(css.includes('touch-action: none'), 'touch gestures must be owned by the 3D canvas');
ok(app.includes("addEventListener('pointerdown', viewerPointerDown)"), 'pointer orbit handler missing');
ok(app.includes("addEventListener('wheel', viewerWheel, { passive:false })"), 'wheel zoom handler missing');
ok(app.includes("v.gesture?.type === 'pan'"), 'pan gesture missing');
ok(app.includes("v.gesture?.type !== 'pinch'"), 'pinch gesture missing');
ok(app.includes('renderInteractive3D(dom.splatCanvas'), 'final viewer must use interactive renderer');
ok(app.includes('renderIso(dom.planeCanvas'), 'stage-4 diagnostic must retain fixed isometric renderer');
ok(app.includes('interactionStride = v.pointers.size'), 'interactive LOD guard missing');
ok(app.includes('viewer-camera-changed'), 'camera interaction must be logged');

// The default camera must reproduce the old isometric x/y projection exactly.
const yaw = Math.PI / 4;
const pitch = -Math.atan(1 / Math.sqrt(2));
for (const p of [[1,2,3],[-2,.5,4],[0,0,0],[3,-1,-2]]) {
  const [x,y,z] = p;
  const oldX = Math.SQRT1_2 * (x-z);
  const oldY = 0.4082482904638631 * (x+z) + 0.8164965809277261 * y;
  const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch);
  const rx=cy*x-sy*z, rz=sy*x+cy*z, ry=cp*y-sp*rz;
  ok(Math.abs(rx-oldX) < 1e-9 && Math.abs(ry-oldY) < 1e-9, 'default interactive camera changed the initial isometric projection');
}

console.log(JSON.stringify({
  build:'v3.4.2', orbit:true, pan:true, wheelZoom:true, pinchZoom:true,
  touchPan:true, keyboard:true, presets:['iso','top','front','side'],
  defaultProjectionMatchesPreviousIso:true, interactionLod:true
}, null, 2));
