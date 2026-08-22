# Scan Test

Banco di prova indipendente da `v30`: non modifica né carica i suoi moduli applicativi.

Aprire `scan_test/index.html` attraverso un server HTTPS o `localhost` (non con `file://`), perché camera, AlvaAR e worker Deep richiedono un'origine sicura. Ad esempio dalla radice `room_scanner`:

```sh
python3 -m http.server 4173
```

Poi aprire `http://localhost:4173/scan_test/`.

La pagina ha due sorgenti senza permesso camera: “Simula con video di test” riproduce `fixtures/tum_freiburg1_xyz_debug_replay.mp4`, mentre “Carica video di test” accetta un filmato locale. Entrambe percorrono esattamente il controller di acquisizione derivato da V30: stesso `coverCrop`, stesso raster RGBA/gray, stesso frame ID e stessa geometria salvata con la posa. Il fixture incluso è intenzionalmente una singola immagine ripetuta: deve verificare decoder, crop, archivio e chiusura della ripresa, **non** produrre pose AlvaAR o una ricostruzione 3D.

Protocollo per il primo test: parete con oggetti, 2–3 secondi iniziali fermi, traslazione laterale lenta, almeno 10% di elementi comuni fra viste e ritorno verso la posizione iniziale. Il campionamento predefinito a 12 fps archivia lo stesso raster RGB consegnato ad AlvaAR per ogni posa. I quattro secondi circa prima di “Registra” sono mantenuti come pre-roll e rieseguiti davanti al resto dell'archivio: senza di essi una nuova istanza Alva offline non può ricreare la mappa che il live tracker aveva già inizializzato.

Nel replay, le pose restano di esclusiva competenza di AlvaAR. Le corrispondenze sono invece verificate sui raster congelati con keypoint Alva + corner RGB, descrittore BRIEF orientato, ZNCC locale, unicità mutua e un controllo diagnostico di coerenza del moto. Il report distingue quindi chiaramente “pose Alva” da “corrispondenze fotografiche”, incluso un candidato di loop quando si torna su una vista precedente.

`models/model_q4.onnx` è il modello Deep predefinito. La pagina tenta prima un eventuale runtime ONNX locale in `vendor/onnxruntime-web/`, poi il runtime ufficiale CDN già usato da V30; quindi il primo test Deep richiede rete finché non viene aggiunto un file `ort.all.min.mjs` compatibile in quella directory. In questo banco di prova Deep gira intenzionalmente con il provider **WASM**, non WebGPU: è più lento, ma evita output Q4 finiti e casuali osservati su alcuni driver Android.

“Prova Deep sul frame corrente” espone tre sole immagini: frame RGBA, tensor NCHW ricostruito in RGB e output ufficiale `H×W` row-major. Le prime due devono ritrarre la stessa scena; se la qualità spaziale non supera il gate, il test e la ricostruzione si fermano invece di usare profondità casuali. Le viste NHWC/column-major non sono diagnostiche valide e non vengono mostrate.

La scala resta quella del mondo AlvaAR finché non si inserisce un fattore noto in “Scala Alva → metri”. I fotogrammi sono conservati in memoria per la riesecuzione e l'elaborazione della sessione corrente; la diagnostica esportata contiene metadati, pose, match e parametri, non le immagini RGB.
