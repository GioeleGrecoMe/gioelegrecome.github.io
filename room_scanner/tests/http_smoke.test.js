'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const relative = decodeURIComponent(requested).replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(response);
});

(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const expectations = new Map([
      ['/', './room_scanner_v12.html'],
      ['/room_scanner_v12.html', 'Room Scanner V15'],
      ['/roomscan_core.js', 'RoomScanCore'],
      ['/roomscan_app.js', '__ROOM_SCANNER_V15__'],
      ['/depth_ai_worker.js?build=test', 'batch-only Depth Anything V2 worker'],
      ['/sw.js', 'CACHE_VERSION'],
      ['/manifest.webmanifest', 'Room Scanner V15 Guided Walk'],
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
  server.close(() => {
    console.error(error);
    process.exitCode = 1;
  });
});
