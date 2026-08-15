ROOM SCANNER - DIAGNOSTICA CAPILLARE
Build diagnostica: rsdiag-2026-08-15.1

FILE DA CARICARE NELLA CARTELLA room_scanner:
- room_scanner_diag_reset.html
- room_scanner_diag_sw.js
- room_scanner_diagnostics.js

NON sostituire room_scanner_v9.html.
NON sostituire sw.js.

PROCEDURA CONSIGLIATA SUL TELEFONO
1. Carica i 3 file sopra nella stessa cartella di room_scanner_v9.html.
2. Apri:
   https://gioelegrecome.github.io/room_scanner/room_scanner_diag_reset.html
3. La pagina:
   - disinstalla il vecchio Service Worker;
   - elimina le cache Room Scanner/AI;
   - registra il Service Worker diagnostico temporaneo;
   - ricarica il room_scanner_v9.html ATTUALMENTE PUBBLICATO con cache:no-store;
   - inserisce il recorder senza modificare il file HTML sul server.
4. Quando compare il pannello in basso a destra, premi SELF TEST prima della scansione.
5. Esegui poi il flusso reale fino al problema:
   - preview;
   - avvio WebXR;
   - mappa;
   - tap oggetto/parete;
   - segmentazione;
   - misura / geometria;
   - fine misura;
   - Stage 5.
6. Quando il problema e' visibile premi MARK e scrivi un nome utile, per esempio:
   SEGMENTAZIONE_NON_APPARE
   PREVIEW_NERO
   STAGE5_NON_APRE
7. Continua ancora qualche secondo, poi premi ZIP LOG.
8. Carica qui lo ZIP prodotto dal browser.

SELF TEST
Prova, quando disponibili:
- preview getUserMedia;
- MobileSAM preflight;
- vera inferenza MobileSAM encoder/decoder;
- Depth Anything worker/runtime/modello;
- salute WebGL;
- Stage 5 se esiste gia' un finalModel in memoria.

CONTENUTO DELLO ZIP LOG
- diagnostic_manifest.json
- app_internal_state.json
- dom_snapshot.json
- service_worker_cache.json
- webgl_contexts.json
- performance_resources.json
- timeline.jsonl              <-- file principale, cronologia completa
- errors.jsonl
- preview_probe.csv           <-- luma/varianza/readyState del preview ogni secondo
- ui_timeline.jsonl
- images/preview_current.png  <-- se disponibile al momento dell'export
- images/seed_mask.png        <-- se disponibile
- images/freeze_frame.png     <-- se disponibile
- images/xr_canvas.png        <-- se esportabile dal browser
- images/final_canvas.png     <-- se disponibile

NON viene incluso PCM/microfono raw.
Le immagini vengono acquisite solo quando premi ZIP LOG.

COSA REGISTRA LA TIMELINE
- console log/info/warn/error;
- error e Promise rejection;
- fetch/XHR con URL, HTTP status, tempi, cache headers;
- Service Worker fetch di HTML, ONNX, WASM, worker e asset;
- creazione/messaggi/errori Worker;
- getUserMedia, track e impostazioni camera/microfono;
- richiesta/sessione WebXR e reference space;
- contesti WebGL, GPU vendor/renderer, context lost/restored;
- mutazioni DOM e visibilita' di preview/overlay/canvas/Stage 5;
- campionamento video ogni secondo;
- stato interno S/CFG tramite bridge diagnostico;
- camera-access XR: presenza view.camera, cameraBinding, RGB readback;
- map frame / semantic bitmap;
- MobileSAM contract, preflight, encoder, decoder, mask, candidate 3D;
- Depth Anything worker e inferenza;
- preview geometrico/splat;
- processing finale, Gaussian field e Stage 5 renderer.

EXIT
Premi EXIT per disinstallare il Service Worker diagnostico e ricaricare la pagina normale.


V2 IMPORTANT:
- SELF TEST is mutex-protected; do not run concurrent model initializations.
- Use MARK exactly when preview/segmentation/Stage5 fails; V2 saves immediate screenshots.
- Complete a real WebXR scan before ZIP LOG.
- ZIP now includes deployed_room_scanner_v9.html, the exact uninstrumented HTML fetched from the live site.
