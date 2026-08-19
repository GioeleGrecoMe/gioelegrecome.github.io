import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);const read=p=>fs.readFileSync(new URL(p,root),'utf8');
test('minimal boot imports only the versioned core app',()=>{const b=read('js/boot.js');assert.match(b,/import\('\.\/app\.js\?v=30.14.0'\)/);for(const x of ['boot_preflight','V30Database','serviceWorker.register','gaussian_metric_tap'])assert.doesNotMatch(b,new RegExp(x));});
test('HTML handshakes with active service worker and removes stale V30 workers before modules',()=>{const h=read('room_scanner_v30.html');assert.match(h,/GET_VERSION/);assert.match(h,/new MessageChannel\(\)/);assert.match(h,/getRegistrations\(\)/);assert.match(h,/roomscan-v30-sw-clean-attempt/);assert.match(h,/k\.startsWith\('room-scanner-v30'\)/);assert.match(h,/loadModule\(\)/);const s=read('sw.js');assert.match(s,/const VERSION='30.14.0'/);assert.match(s,/event\.data\?\.type==='GET_VERSION'/);});
test('service worker is atomic and cache-first for static runtime assets',()=>{const s=read('sw.js');assert.match(s,/throw new Error\(`V30 shell missing/);assert.match(s,/Cache-first for versioned static assets/);assert.match(s,/caches\.match\(req,\{ignoreSearch:true\}\)/);});

test('AlvaAR CDN fallback is cached after first successful load without gating shell install',()=>{const s=read('sw.js');assert.match(s,/cdn\.jsdelivr\.net/);assert.match(s,/alanross\\\/AlvaAR/);assert.match(s,/cache\.match\(req\)/);assert.doesNotMatch(s,/SHELL=\[[^\]]*cdn\.jsdelivr/s);});
