#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8');
let failures=0;
function ok(cond,msg){if(cond)console.log('PASS',msg);else{console.error('FAIL',msg);failures++}}
ok(html.includes("const VERSION='V12.0.1'"),'versione V12.0.1');
ok(!/cdn\.jsdelivr|unpkg\.com|THREE\.|OrbitControls/.test(html),'viewer senza dipendenze CDN/Three.js');
ok(/view\.camera/.test(html)&&/findCameraView/.test(html),'camera-access verificato per XRView, non inferito dal binding');
ok(/observeNative\(frame,pose\)/.test(html)&&/nativeObserveMs/.test(html),'depth XR campionata indipendentemente dai keyframe RGB');
ok(/d\.move>=CFG\.autoMoveM\|\|d\.turn>=CFG\.autoTurnDeg/.test(html),'keyframe automatici richiedono baseline metrica o angolare');
ok(/function inferAndAlign/.test(html)&&/function revalidateDeepAdmissions/.test(html),'inference/alignment separati dalla fusione Deep');
ok(/scheduleRevalidation\(`Depth frame/.test(html),'nuove viste Deep rivalutano le ammissioni precedenti');
ok(/finiteSurfaceSupport/.test(html)&&/pointInPoly2/.test(html),'supporto strutturale limitato al poligono finito');
ok(/multiBaselineM/.test(html)&&/multiBaselineDeg/.test(html),'verifica multi-vista richiede baseline indipendente');
ok(/confidence:s\.confidence|confidence/.test(html)&&/sources:s\.sources/.test(html)&&/evidence:s\.evidence/.test(html),'RAW conserva confidenza, provenienza ed evidenza');
ok(/xrDepthGrid/.test(html)&&/intrinsics/.test(html)&&/xrCoverage/.test(html)&&/quality/.test(html),'keyframe conserva griglia depth, intrinseche/proiezione, copertura e qualità');
ok(/Escludi dalla fusione/.test(html)&&!/S\.frames\.splice\(/.test(html),'foto non eliminate automaticamente; esclusione è reversibile');
ok(/layNative/.test(html)&&/layDeep/.test(html)&&/layStruct/.test(html)&&/layObjects/.test(html),'viewer separa XR, Deep, struttura e oggetti');
ok(/Deep .*pixel/.test(html)||/framePipeline/.test(html),'review espone la catena Deep → ancore → ammessi');
ok(/room-scanner-v12\.0\.1-raw/.test(html),'schema RAW V12.0.1 esplicito');
if(failures){console.error(`\n${failures} test statici falliti`);process.exit(1)}
console.log('\nTutti i test statici V12.0.1 sono passati.');
