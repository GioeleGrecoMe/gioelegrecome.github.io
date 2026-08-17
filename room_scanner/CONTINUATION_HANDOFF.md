# Continuation handoff - Room Scanner V15.0.0

## Baseline

- Versione: `15.0.0`
- Revisione: `v15-guided-walk-20260817`
- Pagina deploy canonica: `room_scanner_v12.html`
- Ingresso root: `index.html`
- Target: Chrome Android + ARCore + HTTPS
- Stato test automatici: PASS
- Stato test fisico ARCore: non eseguito in questo ambiente

## Goal operativo

Acquisire in modo guidato e leggero:

- shell metriche di piu' vani collegati;
- passaggi tra vani;
- fotografie sincronizzate e scalabili metricamente;
- oggetti automatici persistenti multi-vista;
- oggetti manuali/modificabili;
- export RAW, PLY e OBJ.

## Invarianti da non violare

1. Una sola `XRSession` per tutti i vani della scansione.
2. `local-floor` e' il solo frame metrico globale.
3. Una nuova sessione non puo' essere dichiarata allineata alla precedente.
4. Nessun `getUserMedia`, `ImageCapture` o secondo stack camera.
5. `XRWebGLBinding.getCameraImage()` deve restare in un solo callsite raggiunto dentro XR rAF.
6. Il modello neurale non viene caricato o eseguito mentre XR e' attivo.
7. Deep puo' generare evidenza oggetto, ma non spostare la shell metrica.
8. Oggetti automatici richiedono viste spazialmente distinte.
9. La fusione oggetti non deve attraversare `roomId` differenti.
10. Nessun TSDF, ICP o ottimizzatore globale sul telefono.
11. L'HTML completo non va incollato in chat; consegnare un archivio tar.gz.
12. Ogni modifica deve mantenere test e commenti diagnostici.

I test in `tests/static_contract.test.js` proteggono gli invarianti camera/sessione principali. Non indebolirli per far passare una modifica.

## Macchina a stati principale

- `idle`: nessuna scansione attiva.
- `starting`: sessione XR aperta, in attesa di una posa.
- `corners`: acquisizione footprint del vano.
- `height`: stima/conferma altezza.
- `coverage`: auto keyframe e depth XR.
- `room-ready`: vano completato; scegliere passaggio o fine.
- `transition`: traiettoria attraverso porta/apertura.
- `finished`: XR chiuso, dati pronti per revisione/batch.
- `processed`: batch concluso.

## Pipeline metrica

### Footprint

`updateAimSamples()` costruisce un raggio dal centro della view al piano y=0. Un hit test viene usato soltanto se il suo y e' vicino a `local-floor`, per evitare snap su mobili. `addCorner()` usa mediana/jitter e smart snap. `validateFootprint()` rifiuta degenerazioni e auto-intersezioni.

### Altezza

`updateHeightCandidate()` interseca il raggio centrale con le pareti verticali gia' metriche. In fallback usa un piano soffitto rilevato, se disponibile. `confirmHeight()` aggiorna la shell.

### Keyframe

`captureKeyframe()` crea una richiesta asincrona con timeout. `fulfillCaptureRequest()` viene chiamata da `onXRFrame()` e contiene l'unico percorso che legge la camera XR. Ogni frame salva JPEG, posa, proiezione, inverse, depth grid, yaw, pitch, cluster vista e visibilita' pareti.

### Passaggi

`beginTransition()` inizia a campionare la traiettoria telefono. `pathBoundaryCrossing()` cerca l'uscita dal polygon sorgente. `createPortalFromCrossing()` crea il lato sorgente. Alla chiusura del nuovo footprint, `linkPortalToRoom()` cerca una parete parallela e coincidente per il lato target.

## Pipeline oggetti

### XR

Per ogni depth sample, la distanza osservata viene confrontata con la prima intersezione della shell. Residui davanti alla shell e interni al vano alimentano voxel da 6 cm.

### Deep

Il worker esegue Depth Anything V2 Small quantizzato con ONNX Runtime WASM. `fitRelativeDepth()` valuta fit lineare e inverso con robust regression. I campioni XR hanno peso maggiore; la shell fornisce copertura supplementare. Frame con errore p90 eccessivo vengono esclusi.

### Persistenza

`connectedVoxelComponents()` usa supporto locale 3x3x3 e set di view ID. Piccoli scarti tra viste sono tollerati, ma una sola vista non basta. `objectFromVoxels()` assegna un roomId dominante e OBB. Gli oggetti editati vengono sostituiti da `boxMesh()` per preview/OBJ.

## Deep worker

Il file `depth_ai_worker.js` supporta entrambe le forme di `session.inputMetadata`:

- array allineato a `inputNames` nelle versioni ORT correnti;
- oggetto name-keyed in build precedenti.

Un modello con forma statica usa esattamente le dimensioni dichiarate. Un input dinamico preserva aspect ratio e arrotonda a multipli di 14. `tests/deep_worker_contract.test.js` simula entrambi i casi.

## Offline/PWA

`sw.js` pre-cacha solo la shell. Il modello e' separato in IndexedDB. Le navigazioni vengono memorizzate sotto la propria URL: la root non deve sovrascrivere la cache della pagina canonica. I lookup offline ignorano la query build, cosi' il worker pre-cachato resta caricabile.

## Test presenti

- `core_geometry.test.js`
- `depth_fit.test.js`
- `object_voxels.test.js`
- `deep_worker_contract.test.js`
- `static_contract.test.js`
- `bootstrap.test.js`
- `workflow_state.test.js`
- `http_smoke.test.js`
- parse JSON manifest
- `node --check` su app/core/worker/service worker

Comando unico: `./tests/run_all.sh`.

## Prossime priorita'

1. Eseguire `TEST_ON_PHONE.md` su almeno due telefoni ARCore.
2. Raccogliere RAW di casi semplici prima di modificare soglie.
3. Verificare orientamento/copia della texture Raw Camera sui dispositivi target.
4. Misurare tempi e memoria del modello Q4 statico.
5. Valutare soltanto dopo i dati se ridurre grid, frame o texture.
6. Aggiungere autosave IndexedDB della scansione solo se i test mostrano perdita dati reale; non introdurlo senza budget e migrazione schema.
7. Non aggiungere registrazione multi-sessione finche' non esiste un ancoraggio persistente verificabile.

## Informazioni da fornire al prossimo ciclo

- archivio di questa build;
- RAW del test fallito;
- log diagnostico;
- modello dispositivo/Chrome/Android;
- passaggi e momento esatto del guasto;
- misure reali di riferimento;
- indicazione delle capability badge disponibili.
