# Scan Test v3.4.0

Build fingerprint: `scan-test-v3.4.0-watchdog-live-log`

Questa patch corregge due blocchi osservati nella v3.3.0 senza cambiare la pipeline Alva gia validata.

## Correzioni principali

### Self-check iniziale bounded

La verifica iniziale non effettua piu una richiesta `HEAD` al modello Q4 da 27 MB e non esegue fetch sequenziali senza limite. Controlla in parallelo solo:

- `deep_depth_worker.js`
- `models/depth-anything-v2-small/config.json`
- `models/depth-anything-v2-small/preprocessor_config.json`

Ogni richiesta ha un watchdog di 5 s. Il banner deve quindi uscire sempre da `verifica asset in corso`, anche se la rete del telefono non risponde.

Il modello Q4 viene toccato solo al passo 5 dalla pipeline Deep che lo usa realmente.

### Log sempre visibile

In fondo allo schermo e presente un dock fisso che mostra:

- fase corrente;
- tempo trascorso nella fase;
- descrizione dell'operazione;
- ultimi eventi diagnostici.

Il log resta visibile durante decoder video, bootstrap/replay Alva, caricamento Deep, creazione della pipeline, inferenza primaria, controllo specchiato e validazione della depth.

### Deep osservabile e con watchdog

Il worker emette `deep-stage` e `deep-heartbeat`. Le fasi sono separate in:

1. metadata locali;
2. import Transformers.js;
3. caricamento `model_q4.onnx` / creazione pipeline WASM;
4. inferenza primaria;
5. controllo `predicted_depth` vs depth post-processata ufficiale;
6. inferenza specchiata, quando richiesta;
7. gate finale.

Il main thread applica inoltre un timeout di 180 s alla singola richiesta Deep e termina il worker se il job non rientra. Questo watchdog resta efficace anche quando il thread del worker e occupato sincronicamente da WASM.

### Profilo browser 336

`DPTImageProcessor` resta responsabile di resize, aspect ratio, normalizzazione e layout, ma il `preprocessor_config.json` locale usa 336x336 come target browser. 336 e multiplo di 14 e riduce l'area di inferenza a circa il 42% del profilo 518, importante sui telefoni.

Il modello Q4 non e stato modificato.

### Copia pixel evitata

Il buffer RGBA creato per una richiesta Deep viene trasferito al worker con `postMessage(..., [buffer])` invece di essere duplicato tramite structured clone.

## Deploy

Lo ZIP della patch e flat. Estrarre il suo contenuto direttamente in:

`room_scanner/scan_test/`

sovrascrivendo i file omonimi. Non creare `scan_test/scan_test/`.

Dopo il deploy la pagina deve mostrare:

`scan-test-v3.4.0-watchdog-live-log`

Il banner iniziale deve terminare entro pochi secondi con `asset piccoli 3/3 OK` oppure con un warning bounded; non deve poter restare indefinitamente `in corso`.

## Test inclusi

- `node tools/test_app_contract.mjs`
- `node tools/test_v340_watchdog.mjs`
- `node tools/test_depth_noise_gate.mjs`
- `node tools/test_v330_deep_assets.mjs`
- `python3 tools/test_alva_browser_path.py fixtures/external_hallway_validation.mp4 1 1.0`

Il test Deep numerico completo richiede un browser in grado di caricare Transformers.js/ONNX Runtime WASM; l'ambiente di packaging non consente di certificare quell'inferenza end-to-end dalla rete esterna. Il nuovo log e i watchdog sono stati aggiunti proprio per rendere distinguibili import runtime, model load e inferenza sul dispositivo target.
