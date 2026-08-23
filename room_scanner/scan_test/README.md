# Scan Test v2.2.0

Banco di prova indipendente da `v30`: non carica né modifica i suoi moduli applicativi. Camera reale, fixture e video locale convergono sullo stesso raster di analisi 640×480 consegnato ad AlvaAR; Deep Anything usa lo stesso frame RGB congelato.

Aprire `scan_test/index.html` tramite HTTPS o `localhost` (non `file://`). Per esempio, dalla cartella che contiene `scan_test`:

```sh
python3 -m http.server 4173
```

Poi aprire `http://localhost:4173/scan_test/`.

## Video locale: frame realmente decodificati

La v2.2.0 non assume più che un file video sia a 30 fps e non usa più `seeked` come prova che il canvas contenga un nuovo fotogramma. Su browser con `requestVideoFrameCallback`, il file viene fatto avanzare **un frame presentato dal decoder alla volta**: il callback fornisce `mediaTime`, il video viene subito messo in pausa, quel raster viene letto dal canvas e processato completamente da AlvaAR prima di far avanzare il decoder. Questo rende il percorso valido anche per 24/25 fps e impedisce di alimentare Alva con copie dello stesso frame.

Su browser senza `requestVideoFrameCallback` resta un fallback a seek temporale, ma ogni seek attende anche la presentazione al canvas e usa una firma RGB per scartare fotogrammi duplicati. I log riportano modalità di decodifica, `mediaTime`, frame realmente consegnati, contenuti consecutivi identici e numero di pose.

Il fixture incluso `fixtures/tum_freiburg1_xyz_debug_replay.mp4` è intenzionalmente statico: serve a verificare decoder/crop/archivio/EOF e **deve produrre zero pose**. Non è un test valido di visual odometry.

Per verificare AlvaAR direttamente su un MP4 reale, senza dipendere dall'interfaccia browser:

```sh
node scan_test/tools/test_alva_video.mjs /percorso/video.mp4 60 300
```

Il test decodifica con `ffmpeg`, applica lo stesso center-cover 640×480 della pagina e invia i raster consecutivi all'istanza AlvaAR. Nei test di regressione della v2.2.0:

- fixture statico incluso: 0/60 pose, come previsto;
- video sample dinamico H.264 ricampionato a 24 fps: 105/144 pose, prima posa al frame 39;
- sequenza di stanza con parallasse controllata: 126/150 pose, prima posa al frame 24.

Questi numeri non sono una soglia di qualità universale: servono a dimostrare che il tracker produce pose quando riceve una sequenza temporale utile e che lo zero-pose del fixture statico non è un errore del binding AlvaAR.

## FOV AlvaAR

Il campo dell'interfaccia è il FOV **orizzontale**. Il wrapper AlvaAR incluso interpreta il parametro in modo dipendente dall'aspect ratio; la pagina converte quindi il valore prima dell'inizializzazione. Con raster 640×480, 60° orizzontali diventano 45° nell'argomento passato al wrapper, che ricostruisce circa 60° orizzontali internamente.

## Deep Anything V2: contratto dati

`models/model_q4.onnx` resta il modello predefinito. La v2.2.0 riallinea il preprocessore al contratto Depth Anything V2:

- input `float32 [1,3,H,W]`;
- RGB, non BGR;
- normalizzazione ImageNet;
- resize aspect-preserving, dimensioni multiple di 14;
- interpolazione bicubica tipo OpenCV `INTER_CUBIC`;
- baseline lato corto 336 px, rescue 392 px e infine 518 px;
- output `predicted_depth [1,H,W]` letto row-major;
- output richiesto esplicitamente in memoria CPU quando supportato da ONNX Runtime.

Il worker rifiuta buffer RGBA con dimensione incoerente, shape ONNX inattese o output con numero di elementi diverso da `H×W`. Il test Deep mostra anche la ricostruzione RGB del tensor NCHW: se quella vista non coincide con il frame di ingresso, l'inferenza viene considerata non affidabile prima ancora di usare la depth.

Questa pagina forza intenzionalmente il provider **WASM** per il test Deep, in modo da eliminare dal debug i percorsi di readback WebGPU/Q4 dipendenti dal driver. È più lento, ma più deterministico. Se `vendor/onnxruntime-web/ort.all.min.mjs` non è presente, il worker usa il runtime ONNX Runtime Web configurato via CDN e richiede rete.

## Test statici ripetibili

```sh
node scan_test/tools/inspect_onnx_contract.mjs \
  scan_test/models/model_q4.onnx \
  scan_test/models/depth_anything_v2_small_q4f16.onnx

node scan_test/tools/test_depth_contract.mjs
```

`test_depth_contract.mjs` verifica anche un round-trip completo 14×14 del raster RGB attraverso `RGBA -> bicubic -> NCHW -> de-normalizzazione`, così regressioni RGB/BGR, NCHW/NHWC o row/column-major vengono intercettate su tutti i pixel del pattern sintetico, non solo su una singola posizione.

## Protocollo consigliato

Per ottenere pose affidabili con un video di stanza: 1–2 secondi iniziali relativamente stabili, poi traslazione lenta con parallasse e una buona quota di elementi in comune fra frame consecutivi. Una rotazione pura, una scena quasi planare senza texture, forte motion blur o un FOV molto errato possono ancora produrre zero pose pur con una pipeline video perfettamente funzionante.

La diagnostica esportata contiene i metadati dei frame, `mediaTime`, firme raster, pose, match, contratto Deep e parametri di preprocessing; le immagini RGB complete restano nella memoria della sessione.
