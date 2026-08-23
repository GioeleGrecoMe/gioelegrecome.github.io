import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'deep_depth_worker.js'), 'utf8');
function ok(v, msg){ if(!v) throw new Error(msg); }
ok(app.includes('@huggingface/transformers@3.8.1'), 'app must pin Transformers.js 3.8.1');
ok(worker.includes('@huggingface/transformers@3.8.1'), 'worker fallback must pin Transformers.js 3.8.1');
ok(!app.includes('@huggingface/transformers@4.2.0'), 'app must not load Transformers.js 4.2.0');
ok(!worker.includes("device: config.device || 'wasm'"), 'v3 pipeline must not receive v4-style explicit wasm device');
ok(worker.includes("processorType !== 'function'"), 'worker must validate callable processor before inference');
ok(worker.includes('this.processor is not a function'), 'diagnostic must name the reproduced regression');
ok(app.includes('scan-test-v3.4.1-deep-processor-compat'), 'build id must be v3.4.1');
console.log(JSON.stringify({build:'v3.4.1', runtime:'@huggingface/transformers@3.8.1', processorContract:'callable-before-inference', explicitWasmDevice:false}, null, 2));
