import fs from 'node:fs';
const required=['js/slam/alva_runtime_loader.js','vendor/README.md','vendor/ALVAAR_GPL-3.0.txt'];
for(const p of required)if(!fs.existsSync(p))throw new Error(`missing ${p}`);
const loader=fs.readFileSync('js/slam/alva_runtime_loader.js','utf8');
for(const token of ['ALVA_EXPECTED_MIN_BYTES','findCameraPose','getFramePoints','CacheStorage']){
  if(!loader.includes(token))throw new Error(`Alva loader contract missing ${token}`);
}
const config=fs.readFileSync('js/config.js','utf8');
for(const token of ['raw.githubusercontent.com/alanross/AlvaAR','alanross.github.io/AlvaAR','cdn.jsdelivr.net/gh/alanross/AlvaAR'])if(!config.includes(token))throw new Error(`official Alva source missing ${token}`);

const frontend=fs.readFileSync('js/slam/wasm_frontend.js','utf8');
if(!/AlvaAR\.Initialize\(width,height(?:,this\.fovDeg)?\)/.test(frontend))throw new Error('frontend is not using official Initialize(width,height[,fov]) API');
console.log('PASS alvaar-runtime-contract');
