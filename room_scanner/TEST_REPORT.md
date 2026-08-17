# Test report - Room Scanner V15.0.0

Data build: 2026-08-17
Revisione: `v15-guided-walk-20260817`

## Risultato automatico

Comando:

```sh
./tests/run_all.sh
```

Risultato:

```text
PASS core_geometry
PASS depth_fit
PASS object_voxels
PASS deep_worker_contract
PASS static_contract
PASS bootstrap
PASS workflow_state
PASS http_smoke
PASS manifest_json
ALL TESTS PASSED
```

## Copertura

### Sintassi

`node --check` su:

- `roomscan_core.js`
- `roomscan_app.js`
- `depth_ai_worker.js`
- `sw.js`

### Geometria

- footprint e area;
- shell pavimento/soffitto/pareti;
- assenza di duplicazione delle pareti;
- ritaglio dei passaggi;
- intersezioni raggio/stanza;
- triangolazione e mesh cuboide.

### Scala Deep

- fit robusto lineare;
- fit robusto inverso;
- rigetto outlier;
- conversione depth view-plane in punto mondo.

### Oggetti

- merge voxel;
- supporto da viste distinte;
- tolleranza a voxel adiacenti;
- separazione tra vani;
- componenti e OBB.

### Worker ONNX simulato

- metadata ORT come array;
- modello statico 518 x 518;
- input dinamico con aspect ratio;
- multipli di 14;
- inferenza simulata e buffer trasferibile.

### Contratto statico WebXR

- una sola chiamata `requestSession`;
- un solo callsite `getCameraImage`;
- camera raw letta dal percorso XR rAF;
- feature richieste/opzionali corrette;
- assenza di `getUserMedia` e secondo stack camera;
- Deep worker creato solo dal ramo batch;
- file deploy e DOM ID coerenti;
- root index e service worker coerenti;
- nessuna sovrascrittura della cache canonica dalla root;
- lookup offline che ignora query build.

### Bootstrap e workflow

- inizializzazione DOM con elementi simulati;
- wiring dei controlli principali;
- creazione R1;
- footprint, altezza e coverage;
- uscita dalla parete tramite traiettoria;
- portale sorgente;
- creazione R2 nello stesso frame;
- link automatico del lato target;
- completamento di entrambi i vani senza alert.

### Distribuzione HTTP

Server locale su porta effimera e richieste HTTP 200 per:

- `/`
- `/room_scanner_v12.html`
- core/app JS;
- worker con query build;
- service worker;
- manifest;
- icona.

## Non validato in questo ambiente

Non e' stata eseguita una sessione fisica Chrome Android/ARCore. In particolare restano da verificare su dispositivo:

- disponibilita' effettiva di Raw Camera Access;
- orientamento/lettura della texture camera;
- comportamento del depth CPU del dispositivo;
- stabilita' `local-floor` su piu' vani;
- UX reale degli angoli e del passaggio;
- tempi, RAM e temperatura del batch ONNX;
- qualita' oggetti e texture;
- installazione PWA/offline nel browser target.

Vedere `TEST_ON_PHONE.md`.
