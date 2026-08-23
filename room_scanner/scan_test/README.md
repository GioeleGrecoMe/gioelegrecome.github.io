# Scan Test

Pagina corrente: **v2.1** (la stessa etichetta è visibile nell'intestazione HTML). Ogni apertura della camera reale richiede prima una conferma esplicita nella pagina e poi il permesso nativo del browser; fixture e video locale non richiedono accesso alla camera.

Banco di prova indipendente da `v30`: non modifica né carica i suoi moduli applicativi.

Aprire `scan_test/index.html` attraverso un server HTTPS o `localhost` (non con `file://`), perché camera, AlvaAR e worker Deep richiedono un'origine sicura. Ad esempio dalla radice `room_scanner`:

```sh
python3 -m http.server 4173
```

Poi aprire `http://localhost:4173/scan_test/`.

La pagina ha due sorgenti senza permesso camera: “Simula con video di test” riproduce `fixtures/tum_freiburg1_xyz_debug_replay.mp4`, mentre “Carica video · replay controllato” accetta un filmato locale. Per il file non esiste playback autonomo: a ogni intervallo regolare la pagina fa seek, attende il frame decodificato, lo consegna ad AlvaAR e solo allora avanza al successivo. Il replay Alva dei file è fissato a **30 fps**, indipendente dal campionamento live 8–15 fps: la verifica sul video stock ha ottenuto 0 pose a 15 fps ma 237 pose su 300 frame consecutivi a 30 fps, con prima posa al frame 63. Alla fine rigioca AlvaAR offline; se esistono almeno due pose, avvia anche Deep sulle viste selezionate. Alva riceve 640×480, mentre Deep ridimensiona internamente il suo input dinamico. Il fixture incluso è intenzionalmente una singola immagine ripetuta: deve verificare decoder, crop, archivio e chiusura della ripresa, **non** produrre pose AlvaAR o una ricostruzione 3D.

Il campo FOV dell'interfaccia è orizzontale. Prima di inizializzare AlvaAR viene convertito nel valore atteso dal suo wrapper quando il raster è orizzontale; quel wrapper moltiplica linearmente il valore ricevuto per l'aspect ratio. Per esempio 60° orizzontali a 320×240 diventano 45° per AlvaAR, che li ricostruisce come 60° orizzontali. Passare 60 direttamente faceva invece calibrare Alva come 80° orizzontali e può impedire sia tracking live sia replay offline.

Protocollo per il primo test: parete con oggetti, 2–3 secondi iniziali fermi, traslazione laterale lenta, almeno 10% di elementi comuni fra viste e ritorno verso la posizione iniziale. Il campionamento predefinito a 12 fps archivia lo stesso raster RGB consegnato ad AlvaAR per ogni posa. I quattro secondi circa prima di “Registra” sono mantenuti come pre-roll e rieseguiti davanti al resto dell'archivio: senza di essi una nuova istanza Alva offline non può ricreare la mappa che il live tracker aveva già inizializzato.

Nel replay, le pose restano di esclusiva competenza di AlvaAR. Le corrispondenze sono invece verificate sui raster congelati con keypoint Alva + corner RGB, descrittore BRIEF orientato, ZNCC locale, unicità mutua e un controllo diagnostico di coerenza del moto. Il report distingue quindi chiaramente “pose Alva” da “corrispondenze fotografiche”, incluso un candidato di loop quando si torna su una vista precedente.

`models/model_q4.onnx` è il modello Deep predefinito. La pagina tenta prima un eventuale runtime ONNX locale in `vendor/onnxruntime-web/`, poi il runtime ufficiale CDN già usato da V30; quindi il primo test Deep richiede rete finché non viene aggiunto un file `ort.all.min.mjs` compatibile in quella directory. In questo banco di prova Deep gira intenzionalmente con il provider **WASM**, non WebGPU: è più lento, ma evita output Q4 finiti e casuali osservati su alcuni driver Android.

“Prova Deep sul frame corrente” espone tre sole immagini: frame RGBA, tensor NCHW ricostruito in RGB e output ufficiale `H×W` row-major. Prima dell'inferenza il worker legge direttamente dal file ONNX il contratto richiesto: `pixel_values float32 [B,3,H,W]` e `predicted_depth float32 [B,H,W]`; un modello o un runtime che dichiari altro viene rifiutato. Il test ripete inoltre il frame specchiato e richiede che, dopo avere rispecchiato di nuovo l'output, la depth concordi con l'originale. Questo controllo vale anche in WASM e intercetta un ordine di pixel accidentalmente rimescolato. Se il contratto o la qualità spaziale non superano il gate, test e ricostruzione si fermano invece di usare profondità casuali. Le viste NHWC/column-major non sono diagnostiche valide e non vengono mostrate.

Il controllo statico ripetibile dei due modelli inclusi è disponibile senza rete o browser:

```sh
node scan_test/tools/inspect_onnx_contract.mjs scan_test/models/model_q4.onnx scan_test/models/depth_anything_v2_small_q4f16.onnx
node scan_test/tools/test_depth_contract.mjs
```

La scala resta quella del mondo AlvaAR finché non si inserisce un fattore noto in “Scala Alva → metri”. I fotogrammi sono conservati in memoria per la riesecuzione e l'elaborazione della sessione corrente; la diagnostica esportata contiene metadati, pose, match e parametri, non le immagini RGB.
