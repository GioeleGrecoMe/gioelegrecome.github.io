# Scan Test v2.4.0

Banco di prova indipendente da `v30`: camera reale, fixture e video locale convergono sullo stesso raster 640x480 consegnato ad AlvaAR; Depth Anything usa lo stesso frame RGB congelato.

Aprire `scan_test/index.html` tramite HTTPS o `localhost` (non `file://`). Per esempio, dalla cartella che contiene `scan_test`:

```sh
python3 -m http.server 4173
```

Poi aprire `http://localhost:4173/scan_test/`.

## Perche la cattura v2.2.0 allegata non poteva funzionare

Il salvataggio MHT della sessione reale mostra contemporaneamente:

- build visualizzata v2.2.0;
- raster Alva 320x240;
- campionamento del tracker accoppiato all'archivio a 8 Hz;
- 107 frame, 0 pose Alva, pur con molte feature e overlap fotografico;
- Deep eseguito con provider `webgpu` e input 294x224 (`dpt-aspect-224`);
- una mappa Deep finita ma visivamente simile a rumore accettata dal vecchio gate come `struttura coerente`.

La v2.4.0 cambia quindi i due percorsi che erano ancora sbagliati, invece di limitarsi ad alzare soglie diagnostiche.

## Correzioni v2.4.0

### 1. Alva live non e piu campionato alla frequenza dell'archivio

Il valore `archiveFps` controlla soltanto quante immagini vengono conservate. Per la camera live, `CameraController` non introduce piu il vecchio throttle 8/12 Hz: quando `requestVideoFrameCallback` e disponibile, Alva riceve ogni frame presentato dalla camera (normalmente fino al frame-rate reale, tipicamente 30 fps).

Il raster SLAM e 640x480. Prima della prima posa viene inoltre conservato un bootstrap piu fitto, cosi il replay offline vede una sequenza utile invece di una sottosequenza troppo rada.

La diagnostica esporta separatamente `trackerSamples`, `trackerPoses`, `archive.frames`, `trackerVsArchiveDecoupled` e la frequenza di archivio.

### 2. Video locale realmente frame-by-frame

Un file caricato non viene simulato con seek periodici. Con `requestVideoFrameCallback`, `CameraController.nextDecodedFrame()` usa i frame realmente presentati e `mediaTime`; ogni frame univoco arriva ad Alva. Il fallback a seek rimane soltanto per browser privi di rVFC e controlla anche la firma del raster per scartare duplicati.

Il codice continua a separare tracking e memoria: Alva vede ogni frame decodificato, mentre l'archivio viene diradato solo dopo il bootstrap per non superare il budget della sessione.

### 3. Replay Alva con rescue della calibrazione FOV

Il campo FOV dell'interfaccia e orizzontale. Il wrapper Alva incluso riceve l'argomento corretto per il raster landscape 640x480. Se il replay produce esattamente zero pose nonostante una sequenza sufficientemente lunga, viene eseguito un piccolo probe di FOV plausibili sul bootstrap. Un FOV alternativo viene accettato solo se produce pose Alva misurate; non vengono mai inventate pose da feature matching.

### 4. Deep Anything: niente piu WebGPU non verificato in questo banco diagnostico

La sessione MHT reale ha prodotto il rumore con `provider=webgpu` e input corto 224 px. In v2.4.0 il banco diagnostico forza WASM e usa un unico contratto 518 px per preflight e inferenza reale:

- input `float32 [1,3,H,W]`;
- RGB, non BGR;
- normalizzazione ImageNet;
- resize aspect-preserving;
- dimensioni multiple di 14;
- interpolazione bicubica compatibile con OpenCV `INTER_CUBIC`;
- layout NCHW planare;
- output `predicted_depth [1,H,W]` row-major;
- output richiesto in memoria CPU;
- controllo rigoroso di shape e lunghezza buffer.

Il preflight esegue anche una seconda inferenza sul frame ribaltato orizzontalmente. Dopo aver ripristinato l'orientamento, le due mappe devono essere fortemente correlate. Se provider, shape, flip-equivariance o qualita falliscono, la depth viene marcata come NON superata e non puo entrare nella ricostruzione.

## Fixture e test Alva inclusi

Il precedente fixture quasi statico non puo validare un visual SLAM. La v2.4.0 include `fixtures/alva_dynamic_regression.mp4`, usato anche dal pulsante `Simula con video di test`.

Test diretto del tracker:

```sh
node scan_test/tools/test_alva_video.mjs scan_test/fixtures/alva_dynamic_regression.mp4 60 120
```

Regressione eseguita sulla build consegnata: 120 frame, 76 pose valide, prima posa al frame 44.

Il test `tools/test_alva_resolution_regression.mjs` riproduce anche il guasto v2.2: sullo stesso fixture il percorso 320x240 produce 0 pose sia a 8 fps sia a 30 fps, mentre il percorso 640x480 produce 76/120 pose. Questo isola la risoluzione SLAM insufficiente come causa concreta del comportamento zero-pose riprodotto, oltre alla separazione necessaria fra tracking e archivio.

```sh
node scan_test/tools/test_alva_resolution_regression.mjs
```

E stato anche eseguito un test browser del percorso camera live usando una `MediaStream` video: 121 callback di tracking, 69 pose Alva, prima posa alla callback 52. Questo verifica specificamente che il tracker non sia piu limitato dalla frequenza di archivio.

## Test del contratto Depth

```sh
node scan_test/tools/test_depth_contract.mjs
```

Il test verifica l'interfaccia ONNX del modello incluso, input NCHW 518x518, output HxW row-major, lunghezza RGBA, round-trip RGB/NCHW su tutto il raster sintetico e gate di flip.

Limite esplicito: nel sandbox usato per questa revisione non era disponibile un ONNX Runtime eseguibile localmente e il runner non poteva scaricare gli artefatti WASM da CDN. Non viene quindi dichiarata una falsa inferenza numerica Depth end-to-end nel sandbox. La sessione reale allegata dimostra invece che il vecchio percorso WebGPU/224 era effettivamente quello eseguito sul telefono; la v2.4.0 lo rimuove dal percorso accettabile e fallisce in modo esplicito se WASM/flip non sono verificati.

## Verifica immediata dopo il deploy

Dopo aver sostituito i file, la pagina deve mostrare **v2.4.0** sia nel titolo sia nel badge superiore. Nel log iniziale deve comparire `build: scan-test-v2.4.0-native-tracker-safe-depth`. Se compare ancora v2.2.0, 320x240, `samplingHz:8` come contratto Alva o `provider:webgpu` per Deep, il browser/GitHub Pages sta ancora servendo file precedenti.
