# Changelog V15.0.0

## Guided Walk

- Sostituita la logica di registrazione tra celle con un solo reference space `local-floor` per tutti i vani.
- Aggiunto workflow guidato angoli, altezza, coverage, passaggio e vano successivo.
- Aggiunta traiettoria telefono per rilevare la parete attraversata e creare il portale.
- Aggiunto collegamento automatico del lato porta al nuovo vano.

## Acquisizione

- Una sola `XRSession` e una sola chiamata `getCameraImage` nel frame XR attivo.
- Nessun secondo stream camera.
- Keyframe automatici motion-gated e view-diverse.
- JPEG a lato lungo limitato e depth grid CPU 32 x 18.
- Timeout scatto e gestione recuperabile degli errori sessione.
- Hit test usato per angoli solo se vicino al piano local-floor.

## Deep

- Aggiunto `depth_ai_worker.js`, assente nel pacchetto precedente.
- ONNX Runtime WASM caricato solo dopo la fine di XR.
- Cache modello IndexedDB con local-first e fallback remoto.
- Supporto metadata ORT corrente come array e legacy name-keyed.
- Supporto input statico e dinamico con multipli di 14.
- Fit metrico per foto da depth XR e shell.
- Fallback XR-only se Deep non e' disponibile.

## Oggetti

- Evidenza XR e Deep come residuo davanti alla shell.
- Persistenza multi-vista con tolleranza a voxel adiacenti.
- Separazione per vano.
- Oggetti automatici e manuali modificabili.
- Hide/show, remove/restore, nome, dimensioni e yaw.
- Mesh cuboide editata coerente con preview e OBJ.

## Output e UI

- Planimetria 2D ed editor passaggi/oggetti.
- Viewer isometrico leggero con layer.
- Export RAW JSON, PLY e OBJ.
- PWA shell con root `index.html` e pagina canonica mantenuta.
- Service worker corretto per root, query build e fallback offline.

## Fix

- Eliminata duplicazione delle pareti nella mesh shell.
- Impedita continuazione metrica dopo chiusura/interruzione sessione.
- Impedita fine scansione con vano incompleto o meno di tre foto.
- Corretto cleanup di startup XR fallito.
- Corretto timeout capture e reset stato busy.
- Corretto precache root mancante e sovrascrittura cache canonica.

## Test

- Aggiunti test geometria, fit, voxel, worker VM, contratto statico, bootstrap, workflow a due vani e HTTP smoke.
