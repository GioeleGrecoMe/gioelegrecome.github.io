# Scan Test v3.5.0 - verification

Build: `scan-test-v3.5.0-mobile-alva-two-pass-viewer`

## Regressione mobile Alva

Test browser con Chromium in profilo Android, usando il controller video e il tracker Alva bundled ma separando decoder e SLAM come nella v3.5:

- fixture landscape 640x480 -> raster Alva 960x720;
- decoder continuo a 0.25x: 120 frame decodificati, 0 duplicati;
- primi 48 frame passati ad Alva solo dopo che il decoder si e fermato;
- 22/48 pose valide;
- prima posa al frame 26;
- 0 reset interni;
- 0 frame con zero punti nel replay.

Un secondo test portrait 480x640 -> raster 720x960 con 48 frame densi ha prodotto 21/48 pose, prima posa al frame 27, 0 reset e 0 frame con zero punti.

Questi test non dimostrano che ogni video reale debba produrre pose: dimostrano che il percorso mobile non introduce piu il pattern N -> 0 perche Alva compete con il decoder sul main thread.

## Invarianti v3.5

- nessuna chiamata `findCameraPose()` nel callback di decodifica del file quando il runtime e mobile;
- feature extraction e rendering miniature differiti durante il primo passaggio mobile;
- replay Alva sequenziale a decoder fermo;
- stato interno `lastStatus` del wrapper esposto e loggato;
- raster file 960 px lato lungo, aspect ratio/orientamento preservati;
- camera live mobile 720 px;
- limite mobile all'archivio per evitare pressione eccessiva sulla heap;
- Deep worker v3.4.1 invariato;
- dock diagnostico sempre visibile invariato;
- viewer passo 6 orbit/pan/zoom incluso.

## Test statici

- `node --check app.js`
- `node --check deep_depth_worker.js`
- `node tools/test_v350_mobile_alva.mjs`
- `node tools/test_v341_processor_compat.mjs`
- test del viewer v3.5 incluso nel contratto v350.

