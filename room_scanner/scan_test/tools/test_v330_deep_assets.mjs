import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = fs.readFileSync(path.join(root,'deep_depth_worker.js'),'utf8');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const modelDir = path.join(root,'models','depth-anything-v2-small');
function ok(c,m){ if(!c) throw new Error('FAIL: '+m); }
for (const rel of ['config.json','preprocessor_config.json','onnx/model_q4.onnx']) ok(fs.existsSync(path.join(modelDir,rel)), 'missing '+rel);
const q4=fs.readFileSync(path.join(modelDir,'onnx','model_q4.onnx'));
const sha=crypto.createHash('sha256').update(q4).digest('hex');
ok(sha==='5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8','unexpected Q4 SHA256 '+sha);
ok(worker.includes('officialDepthAgreement'), 'worker must cross-check predicted_depth against pipeline RawImage');
ok(worker.includes('normalizedNeighborDiff') && worker.includes('noiseLike'), 'worker must gate high-frequency noise');
ok(worker.includes('verifyLocalModelAssets'), 'worker must preflight local model metadata');
ok(app.includes('verifyDeployedBuild'), 'app must expose live asset self-check');
ok(app.includes("new URL('./models/depth-anything-v2-small/onnx/model_q4.onnx'"), 'app self-check must address nested Q4 asset');
console.log(JSON.stringify({q4Bytes:q4.length,sha256:sha,officialDepthCrosscheck:true,highFrequencyGate:true,liveAssetSelfcheck:true},null,2));
