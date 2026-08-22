# Scan Test

Banco di prova indipendente da `v30`: non modifica né carica i suoi moduli applicativi.

Aprire `scan_test/index.html` attraverso un server HTTPS o `localhost` (non con `file://`), perché camera, AlvaAR e worker Deep richiedono un'origine sicura. Ad esempio dalla radice `room_scanner`:

```sh
python3 -m http.server 4173
```

Poi aprire `http://localhost:4173/scan_test/`.

Protocollo per il primo test: parete con oggetti, 2–3 secondi iniziali fermi, traslazione laterale lenta, almeno 10% di elementi comuni fra viste e ritorno verso la posizione iniziale. Il campionamento predefinito a 8 fps archivia lo stesso raster RGB consegnato ad AlvaAR per ogni posa.

`models/model_q4.onnx` è il modello Deep predefinito. La pagina tenta prima un eventuale runtime ONNX locale in `vendor/onnxruntime-web/`, poi il runtime ufficiale CDN già usato da V30; quindi il primo test Deep richiede rete finché non viene aggiunto un file `ort.all.min.mjs` compatibile in quella directory.

La scala resta quella del mondo AlvaAR finché non si inserisce un fattore noto in “Scala Alva → metri”. I fotogrammi sono conservati in memoria per la riesecuzione e l'elaborazione della sessione corrente; la diagnostica esportata contiene metadati, pose, match e parametri, non le immagini RGB.
