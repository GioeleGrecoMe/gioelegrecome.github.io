# Scan Test v3.2.1

Build: `scan-test-v3.2.1-continuous-native-depth-pipeline`

Questa build sostituisce i due percorsi che nelle versioni precedenti potevano produrre, rispettivamente, video apparentemente caricato ma non realmente processato da AlvaAR e depth map numericamente finite ma visivamente simili a rumore.

## Correzioni effettive

### 1. Il video entra nello stato di registrazione prima che inizi il decoder

Nel percorso file la v2.x poteva chiamare il ciclo di elaborazione prima di impostare `S.recording=true`. Poiche il ciclo dipendeva da quello stato, era possibile terminare senza elaborare davvero i frame.

In v3.2.1 l'ordine e esplicito e sottoposto a test automatico:

1. inizializzazione della sorgente e di AlvaAR;
2. `startRecording()`;
3. avvio di `processUploadedVideo()`.

### 2. Niente piu play/pause per simulare il frame stepping

`play() -> requestVideoFrameCallback -> pause() -> play()` non garantisce di ricevere ogni frame. Chromium puo avanzare il decoder tra una ripresa e l'altra, e il bootstrap di AlvaAR e particolarmente sensibile ai primi frame mancanti.

Il percorso file adesso usa una singola riproduzione continua a velocita ridotta (`0.25x`):

- il frame gia decodificato a `t=0` viene acquisito esplicitamente;
- `play()` viene chiamato una sola volta;
- una catena continua di `requestVideoFrameCallback` consegna i frame presentati dal decoder;
- `mediaTime` e una firma del raster impediscono duplicati;
- AlvaAR riceve tutti i frame unici; l'archivio fotografico puo invece essere diradato indipendentemente.

Il fallback a seek viene usato solo quando `requestVideoFrameCallback` non esiste.

### 3. AlvaAR conserva orientamento e aspect ratio della sorgente

La vecchia conversione obbligatoria 4:3 poteva tagliare una sorgente widescreen o ruotata/portrait. In v3.2.1 il raster Alva usa l'intero fotogramma e mantiene il rapporto originale, con lato lungo di analisi pari a **960 px**.

Esempi:

- sorgente 640x480 -> Alva 960x720;
- sorgente 480x640 -> Alva 720x960;
- sorgente 480x270 -> Alva 960x540.

`AlvaAR.Initialize(width,height)` riceve esattamente le stesse dimensioni del `ImageData` passato a `findCameraPose()`.

### 4. Replay offline: nessuna posa inventata

Le pose restano di autorita AlvaAR. Se il replay offline non recupera una posa ma il tracking live l'aveva misurata, quella misura reale puo essere mantenuta ed e marcata esplicitamente come rescue live. Il feature matching non crea pose artificiali.

### 5. Depth Anything: eliminato il tensor packing scritto a mano

Il worker non costruisce piu manualmente il tensore ONNX e non interpreta manualmente un output WebGPU. Usa la pipeline ufficiale Transformers.js:

`pipeline('depth-estimation', 'depth-anything-v2-small', { dtype:'q4', device:'wasm' })`

con modello Q4 locale. Il `DPTImageProcessor` ufficiale possiede preprocessing e layout:

- resize target 518;
- aspect ratio preservato;
- dimensioni multiple di 14;
- bicubica;
- RGB + rescale 1/255;
- normalizzazione ImageNet;
- output `predicted_depth` letto dal tensore restituito dalla pipeline.

Il modello locale incluso in `models/depth-anything-v2-small/onnx/model_q4.onnx` e byte-per-byte uguale al Q4 gia presente nel progetto. SHA-256:

`5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`

### 6. Deep e fail-closed

Una depth non entra nella ricostruzione solo perche contiene numeri finiti. Il worker ripete l'inferenza sul frame specchiato orizzontalmente, riporta la seconda depth nell'orientamento originale e verifica la correlazione spaziale.

Per accettare una mappa devono essere contemporaneamente veri:

- backend WASM/Q4;
- valori numericamente validi;
- controllo flip-equivariance superato;
- nessun flag `suspicious`.

Se un singolo frame del batch fallisce, **l'intero batch Deep viene cancellato**, il preview viene disabilitato e nessuna depth parziale puo arrivare alla geometria finale. Anche il test Deep non mostra piu la mappa rifiutata: al suo posto compare il messaggio `DEPTH RIFIUTATA`.

## Regressioni eseguite sulla build consegnata

### Contratto app

```sh
node tools/test_app_contract.mjs
```

Verifica fra le altre cose: recording prima del decoder, playback rVFC continuo da t=0, singola `play()`, raster 960, assegnazione Deep solo dopo il gate e cancellazione del batch parziale su errore.

### AlvaAR - fixture landscape

```sh
python3 tools/test_alva_browser_path.py fixtures/alva_dynamic_regression.mp4 20 .25
```

Ultima esecuzione sulla build consegnata:

- sorgente: 640x480;
- raster Alva: 960x720;
- frame consegnati: **120**;
- duplicati: **0**;
- pose Alva valide: **94/120 (78.3%)**;
- prima posa: frame 26;
- timestamp iniziali: `0, 0.033333, 0.066667, 0.1, ...`.

### AlvaAR - fixture portrait

```sh
python3 tools/test_alva_browser_path.py fixtures/alva_dynamic_portrait_regression.mp4 20 .25
```

Ultima esecuzione:

- sorgente: 480x640;
- raster Alva: 720x960;
- frame consegnati: **118**;
- duplicati: **0**;
- pose Alva valide: **94/118 (79.7%)**;
- prima posa: frame 24.

### AlvaAR - video esterno di corridoio

```sh
python3 tools/test_alva_browser_path.py fixtures/external_hallway_validation.mp4 1 .25
```

Ultima esecuzione:

- sorgente: 480x270;
- raster Alva: 960x540;
- frame consegnati: **50/50**;
- duplicati: **0**;
- pose Alva valide: **45/50 (90%)**;
- prima posa: frame 5;
- timestamp: `0, 0.16, 0.32, ... 7.84`.

Il video esterno non e usato come misura di accuratezza geometrica: serve a verificare che il risultato non dipenda dal fixture sintetico.

### Contratto Depth Anything

```sh
node tools/test_depth_contract.mjs
```

Il test controlla il modello ONNX locale, SHA-256, nomi/shape input-output, `preprocessor_config.json`, uso della pipeline ufficiale, WASM/Q4, assenza del vecchio `InferenceSession.create` manuale, gate flip e comportamento fail-closed dell'app.

## Limite della verifica Deep in questo ambiente

Il sandbox usato per preparare questa patch blocca la navigazione localhost di Chromium e non consente al runtime browser di raggiungere il CDN di Transformers.js/ONNX Runtime. Per questo **non dichiaro eseguita qui una inferenza numerica Deep WASM end-to-end**.

Quello che e stato verificato localmente e il modello Q4, il suo contratto ONNX, il processor ufficiale, il routing del worker e soprattutto il fatto che una mappa che non supera la verifica indipendente non possa piu essere mostrata/assegnata/usata come geometria. Sul sito HTTPS il test `Test Deep` e quindi il controllo runtime definitivo: deve indicare `transformers.js-wasm-q4` e flip verificato prima di abilitare la depth.

## Deploy

Sovrascrivere i file del pacchetto nella cartella `scan_test/`, mantenendo le sottocartelle. Dopo il deploy fare un hard refresh/cancellazione cache.

La pagina corretta deve mostrare **v3.2.1**. Nel log iniziale deve comparire:

`scan-test-v3.2.1-continuous-native-depth-pipeline`

Se compare una versione v2.x, un raster fisso 320x240/640x480 o `provider:webgpu`, e ancora in esecuzione almeno un file precedente.

## v3.3.0 - bootstrap guard + depth cross-check

Questa patch va copiata **direttamente** dentro `room_scanner/scan_test/` (non dentro una seconda cartella `scan_test`).
La pagina deve mostrare in alto il fingerprint `scan-test-v3.3.0-bootstrap-guard-depth-crosscheck` e il conteggio degli asset. Se il fingerprint non compare, il browser/GitHub Pages sta ancora servendo un'altra build.

Correzioni principali:
- video file: bootstrap rVFC a 0.0625x, poi 0.25x dopo lock/2 s media, per evitare frame saltati sui telefoni lenti;
- replay Alva: prova automaticamente più valori del parametro FOV interno di AlvaAR se il default non inizializza; il FOV orizzontale UI resta separato e serve alla proiezione;
- Deep: `predicted_depth` deve concordare con la `depth` RawImage post-processata dalla pipeline ufficiale e superare un gate ad alta frequenza, oltre al controllo flip;
- preflight del modello locale e self-check degli asset serviti dal deploy.
