import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const requireText = (rel, needles) => {
  const text = read(rel);
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${rel} lacks required contract token: ${needle}`);
  }
  return text;
};

const html = requireText('room_scanner_v12.html', [
  'V20.2.4',
  'Salva ed esci da XR',
  'Scarica pacchetto RAW',
  'markpoint',
]);
if (/Completa vano|mark wall|segna parete/i.test(html)) {
  throw new Error('The default V20.2 capture UI must not require wall-by-wall completion.');
}

const appTextForRecovery = read('js/app_v20_2_0.js');
if (!/(listSessions|recover|restore|resume)/i.test(appTextForRecovery)) {
  throw new Error('The start page must be able to enumerate and recover persisted captures.');
}

const app = requireText('js/app_v20_2_0.js', [
  'requestSafeExit',
  'exportRaw',
]);
const capture = requireText('js/xr_capture_v20_2_0.js', [
  'requestSession',
  'requestAnimationFrame',
  'requestSafeExit',
  'xrSession?.end',
  'activeTasks',
  'CAPTURE_SAVED',
]);
if (/toDataURL\s*\(/.test(capture) || /btoa\s*\(/.test(capture)) {
  throw new Error('XR capture must not base64-encode frame payloads.');
}
if (/processing\.html/.test(capture)) {
  throw new Error('XR lifecycle code must not navigate to processing.');
}

const db = requireText('js/db_v20_2_0.js', [
  'sessions', 'records', 'blobs', 'events', 'models', 'enqueueBlob', 'drain',
]);
if (/JSON\.stringify\([^\n]*blob/i.test(db)) {
  throw new Error('Binary blobs must not be serialized into the session JSON snapshot.');
}

const grid = requireText('js/grid_v20_2_0.js', [
  'red', 'yellow', 'green', 'needDeep', 'parallax',
]);
const mapWorker = requireText('workers/map_worker_v20_2_0.js', [
  'predicted', 'surfaceType', 'frameRefs', 'views',
]);
if (!/(floor|pavimento)/i.test(mapWorker) || !/(ceiling|soffitto)/i.test(mapWorker)) {
  throw new Error('Adaptive map must model floor and ceiling targets.');
}

requireText('js/markpoints_v20_2_0.js', [
  'hue', 'saturation', 'contrast', 'edge', 'quality',
]);
requireText('js/registration_v20_2_0.js', [
  'yaw', 'translation', 'scale', 'pairs',
]);
requireText('js/audio_v20_2_0.js', [
  'chirp', 'sampleRate', 'expectedMicFrame',
]);
requireText('workers/audio_worklet_v20_2_0.js', [
  'Int16Array', 'totalFrames', 'flush',
]);
requireText('js/raw_export_v20_2_0.js', [
  'StoredZipBuilder', 'manifest.json', 'diagnostics',
]);
requireText('workers/processing_worker_v20_2_0.js', [
  'fitStructuralPlanes', 'clusterResidualObjects', 'frameRefs',
]);
requireText('js/acoustics_v20_2_0.js', [
  'direct', 'relative', 'peak', 'robust',
]);
requireText('workers/acoustic_worker_v20_2_0.js', [
  'chirp', 'PCM', 'RIR',
]);
requireText('processing.html', ['V20.2.4', 'processing_ui_v20_2_0.js']);

const sw = requireText('sw_v20_2_0.js', [
  'room_scanner_v12.html', 'processing.html', 'network',
]);
if (/catch\s*\([^)]*\)\s*\{?\s*return\s+caches[^\n]*room_scanner_v12\.html/i.test(sw)) {
  throw new Error('The service worker must not return HTML as a generic missing-script fallback.');
}

requireText('tools/process_rscan.py', [
  'RSPT', 'markpoint', 'trajectory', 'write_ply', 'diagnostic',
]);
requireText('README_V20_2_0.md', [
  'append-only', 'Safe handoff', 'adaptive metric', 'Acoustic',
]);
requireText('RAW_FORMAT.md', ['RSPT v1', 'PCM16', 'Manifest']);
requireText('TEST_ON_PHONE.md', ['Critical XR exit test', 'RAW transfer', 'Markpoints']);

console.log('PASS requirements_v20_2_0');
