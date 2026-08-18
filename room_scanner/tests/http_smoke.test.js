'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const relative = decodeURIComponent(requested).replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain' }); response.end('not found'); return;
  }
  response.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(filePath).pipe(response);
});

(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const expectations = new Map([
      ['/', 'Room Scanner V20.1.0'],
      ['/room_scanner_v12.html', 'METRIC + RIR + RGB SURFELS'],
      ['/roomscan_core.js', 'buildAcousticSurfaceModel'],
      ['/roomscan_signal.js', 'detectSweepOnsets'],
      ['/roomscan_geometry.js', 'MetricSurfelMap'],
      ['/roomscan_acoustics.js', 'associateEchoPeak'],
      ['/roomscan_audio.js', 'AcousticCaptureController'],
      ['/roomscan_audio_worklet.js', 'roomscan-pcm-capture-v20-1'],
      ['/roomscan_app.js', '__ROOM_SCANNER_V20__'],
      ['/depth_ai_worker.js?build=test', 'Room Scanner V20.1.0'],
      ['/sw.js', 'room-scanner-v20.1.0-metric-rir-twin-diag-20260818'],
      ['/roomscan_app_v20_1_0.js', 'nello stesso documento'],
      ['/manifest.webmanifest', 'Room Scanner V20.1 Metric RIR Twin'],
      ['/build_info.json', 'relative echo delay'],
      ['/icon.svg', '<svg'],
    ]);
    for (const [pathname, marker] of expectations) {
      const response = await fetch(base + pathname, { redirect: 'manual' });
      assert.equal(response.status, 200, `${pathname} did not return HTTP 200`);
      const text = await response.text();
      assert.ok(text.includes(marker), `${pathname} does not contain ${marker}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('PASS http_smoke');
})().catch(error => {
  server.close(() => { console.error(error); process.exitCode = 1; });
});
