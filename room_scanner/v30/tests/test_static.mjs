import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname),required=['index.html','room_scanner_v30.html','styles.css','manifest.webmanifest','build_info.json','sw.js','js/app.js','js/config.js','js/logger.js','js/camera.js','js/formats.js','js/self_test.js','js/imu.js','js/storage/db.js','js/slam/math.js','js/slam/wasm_frontend.js','js/slam/slam_engine.js','js/depth/depth_calibration.js','js/gaussian/renderer.js','workers/gaussian_worker.js','workers/depth_worker.js','wasm/slam_core.wasm'];
for(const f of required)if(!fs.existsSync(path.join(root,f)))throw new Error(`missing ${f}`);
const html=fs.readFileSync(path.join(root,'room_scanner_v30.html'),'utf8'),app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');for(const id of ['cameraHeight','startBtn','loadPlyBtn','loadR30Btn','diagDownloadBtn','selfTestBtn','viewer','processDeepBtn'])if(!html.includes(`id="${id}"`))throw new Error(`HTML missing #${id}`);
if(!html.includes('js/app.js'))throw new Error('app module not loaded');
if(!app.includes('deepOnlineDefault')||!app.includes('startDeferredDeep'))throw new Error('deferred Deep controls missing');
const runtime=[];for(const f of required.filter(x=>/\.(html|js|css)$/.test(x))){const s=fs.readFileSync(path.join(root,f),'utf8');if(/(?:src=|href=|import\s|new Worker\(|fetch\()[^\n]*v20|_v20/i.test(s))runtime.push(f);}if(runtime.length)throw new Error(`V20 runtime references: ${runtime.join(', ')}`);
console.log('PASS static_contract');
