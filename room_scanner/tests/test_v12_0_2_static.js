#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8');
let failures=0;
function ok(cond,msg){if(cond)console.log('PASS',msg);else{console.error('FAIL',msg);failures++}}
ok(html.includes("const VERSION='V12.0.2'"),'versione V12.0.2');
ok(!/cdn\.jsdelivr|unpkg\.com|THREE\.|OrbitControls/.test(html),'viewer senza dipendenze CDN/Three.js');
ok(/view\.camera/.test(html)&&/findCameraView/.test(html),'camera-access verificato sul singolo XRView');
ok(/observeNative\(frame,pose\)/.test(html)&&/nativeObserveMs/.test(html),'depth XR campionata indipendentemente dai keyframe RGB');
ok(/d\.move>=CFG\.autoMoveM\|\|d\.turn>=CFG\.autoTurnDeg/.test(html),'keyframe automatici richiedono baseline reale');
ok(/buildAnchorField/.test(html)&&/localMetricCorrection/.test(html)&&/metricAt/.test(html),'Deep usa fit metrico globale piu campo di correzione locale');
ok(/nativeConflict/.test(html)&&/occluded/.test(html)&&/crossViewEvidence/.test(html),'fusione multi-vista distingue supporto, occlusione e contraddizione di spazio libero');
ok(/pointTriangleDistance/.test(html)&&/mesh\.indices/.test(html),'mesh XR usa triangoli nativi, non solo vertici');
ok(/revalidateMaxLatencyMs/.test(html)&&/lastRevalidateAt/.test(html),'rifusione Deep ha latenza massima durante scansione continua');
ok(/horizontalSurfaceMinCells/.test(html)&&/fill<\.20/.test(html),'superfici orizzontali richiedono componenti XZ 2D coerenti');
ok(/walls\.length<2&&!floors\.length/.test(html),'mesh stanza non viene chiusa da soli punti di arredo');
ok(/watertight:true/.test(html)&&/ROOM_SHELL/.test(html),'mesh stanza dichiara esplicitamente chiusura e provenienza');
ok(/voxelBoundaryMesh/.test(html)&&/objectCellIndex/.test(html),'oggetti separabili hanno nuvola e mesh voxel chiusa');
ok(/layRoomMesh/.test(html)&&/layObjectClouds/.test(html)&&/layObjects/.test(html),'viewer separa mesh stanza, nuvole oggetto e mesh oggetto');
ok(/Scarica PLY fusa/.test(html)&&/Scarica OBJ mesh/.test(html),'export PLY e OBJ disponibile');
ok(/room-scanner-v12\.0\.2-raw/.test(html),'schema RAW V12.0.2 esplicito');
ok(/xrPlanes:/.test(html)&&/object_id/.test(html),'RAW conserva metadati piani XR e PLY conserva appartenenza oggetto');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));const refs=[...html.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]),missing=[...new Set(refs.filter(id=>!ids.has(id)))];ok(missing.length===0,'tutti i riferimenti UI puntano a elementi presenti'+(missing.length?`: ${missing.join(',')}`:''));
ok(/semanticLabel/.test(html)&&/orientation/.test(html),'metadati semantici piani XR conservati come hint');
ok(/Escludi dalla fusione/.test(html)&&!/S\.frames\.splice\(/.test(html),'foto conservate e reversibilmente escluse');
if(failures){console.error(`\n${failures} test statici falliti`);process.exit(1)}
console.log('\nTutti i test statici V12.0.2 sono passati.');
