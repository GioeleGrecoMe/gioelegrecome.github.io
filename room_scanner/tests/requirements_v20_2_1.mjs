import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const need=(rel,tokens)=>{const text=read(rel);for(const token of tokens)if(!text.includes(token))throw new Error(`${rel} lacks ${token}`);return text;};

need('room_scanner_v20.html',['V20.2.1','grid-overlay','Salva ed esci da XR']);
need('room_scanner_v12.html',['V20.2.1','grid-overlay']);
const xr=need('js/xr_capture_v20_2_0.js',["usagePreference:['cpu-optimized','gpu-optimized']",'frame.getDepthInformation(view)',"this.depthMode==='gpu-optimized'",'plane-detection','frame.detectedPlanes','clearColor(0,0,0,0)','layer.framebuffer','requestSafeExit','CAPTURE_SAVED']);
if(/this\.binding\.getDepthInformation\(view\).*getDepthInMeters/s.test(xr))throw new Error('GPU depth must not be treated as XRCPUDepthInformation');
const css=need('css/app_v20_2_0.css',['html.xr-active,body.xr-active{background:transparent!important}','.xr-active #xr-canvas{visibility:visible;opacity:1}','.xr-active .topbar{display:none}']);
if(css.includes('#xr-canvas{z-index:0;background:#000}'))throw new Error('XR canvas still has opaque black DOM background');
if(css.includes('.xr-active #xr-canvas{opacity:0}'))throw new Error('XR canvas must stay in the AR compositor');
need('js/app_v20_2_0.js',["document.documentElement.classList.add('xr-active')","document.documentElement.classList.remove('xr-active')","setState('Avvio vista WebXR','warn')",'buildRawBundle']);
need('workers/map_worker_v20_2_0.js',['surfaceType','frameRefs','predicted','planeEstimates','planeCells','webxr-plane','floor','ceiling']);
need('js/raw_export_v20_2_0.js',['StoredZipBuilder','manifest.json','diagnostics']);
need('processing.html',['V20.2.1','processing_ui_v20_2_0.js']);
need('sw_v20_2_0.js',['room-scanner-v20.2.1-xr-surface-export-recovery-shell','room_scanner_v20.html','room_scanner_v12.html']);
need('build_info.json',['20.2.1','v20.2.1-20260818-xr-surface-export-recovery-fix','room_scanner_v20.html']);
console.log('PASS requirements_v20_2_1');
