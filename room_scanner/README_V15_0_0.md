# Room Scanner V15.0.0 - Guided Walk

Build: `v15-guided-walk-20260817`

Room Scanner V15 e' una web app mobile-first per acquisire vani connessi, passaggi e oggetti usando una sola sessione WebXR. La scelta progettuale e' volutamente semplice: WebXR definisce la geometria metrica; Depth Anything aiuta solo dopo la scansione a distinguere superfici e oggetti nelle fotografie gia' associate a posa, proiezione e profondita' XR.

## Cosa cambia rispetto ai tentativi precedenti

Il problema piu' fragile era riallineare ogni stanza o ricostruire una nuvola densa in tempo reale sul telefono. V15 elimina entrambi i passaggi:

1. Tutti i vani vengono acquisiti nella stessa sessione `immersive-ar` e nello stesso reference space `local-floor`.
2. Il perimetro metrico viene definito con pochi punti pavimento-parete, assistiti da ray casting, hit test e smart snap ortogonale.
3. L'altezza viene ottenuta mirando una volta al raccordo parete-soffitto, oppure inserita manualmente.
4. Le fotografie XR sono automatiche, limitate e sincronizzate con posa, matrice di proiezione e depth grid CPU quando disponibile.
5. Il passaggio tra vani viene ricavato dalla traiettoria del telefono quando attraversa il confine del vano; non esiste una registrazione separata del secondo vano.
6. Depth Anything viene eseguito in batch soltanto dopo la chiusura di WebXR. Il suo depth relativo viene scalato foto per foto usando depth XR e intersezioni con la shell metrica; non puo' spostare le pareti.
7. Gli oggetti sono proposte voxel multi-vista, sempre modificabili. L'utente puo' aggiungere cuboidi, correggere nome e dimensioni, ruotarli, nasconderli, rimuoverli o ripristinarli.

## Requisiti

Per la scansione completa servono:

- smartphone Android compatibile ARCore;
- Chrome Android con `immersive-ar`, `local-floor`, DOM Overlay e Raw Camera Access WebXR;
- pagina servita in HTTPS;
- consenso a tracking spaziale e camera;
- spazio libero sufficiente per camminare in sicurezza.

Depth sensing, hit test, anchors, plane detection e light estimation sono richiesti come feature opzionali: la app li usa quando il browser li espone. La camera XR e' invece necessaria per i keyframe fotografici e per il ramo Deep.

La pagina va aperta come documento top-level. Se viene inserita in un iframe, il contenitore deve consentire almeno `xr-spatial-tracking` e `camera` tramite Permissions Policy/attributo `allow`.

## Deploy su GitHub Pages

Copiare il contenuto di questa cartella nella root pubblicata del repository. Sono disponibili due ingressi:

- `index.html`: rende utilizzabile la root del sito e reindirizza alla pagina canonica;
- `room_scanner_v12.html`: nome canonico mantenuto per non rompere il precedente URL di deploy.

Non rinominare `room_scanner_v12.html` senza aggiornare anche `index.html`, `manifest.webmanifest`, `sw.js` e i test statici.

Dopo il deploy:

1. aprire la root HTTPS dal telefono;
2. cancellare i dati sito se e' installata una build precedente;
3. ricaricare una volta online per installare la nuova shell PWA;
4. avviare WebXR con il pulsante principale.

## Flusso per un utente inesperto

### 1. Avvio

Premere **Avvia scansione WebXR** e concedere i permessi. Restare fermi per qualche secondo finche' il tracking risulta stabile.

### 2. Angoli del vano

Camminare vicino al primo angolo. Puntare il reticolo sul raccordo pavimento-parete e premere **Aggiungi angolo**. Procedere lungo il perimetro, sempre nello stesso verso. Dopo almeno tre punti, usare **Chiudi vano** oppure ripuntare vicino al primo punto.

Suggerimenti:

- non puntare il centro della parete: puntare il punto in cui parete e pavimento si incontrano;
- non cambiare stanza durante questa fase;
- mantenere attivo **Smart snap** per vani prevalentemente ortogonali;
- disattivarlo solo per pareti oblique reali.

### 3. Altezza

Puntare il raccordo parete-soffitto su una parete libera e premere **Conferma altezza**. Se il soffitto non e' visibile, usare il valore manuale.

### 4. Foto e oggetti

Camminare lentamente nel vano e guardare pareti e mobili da posizioni diverse. La app scatta automaticamente quando il telefono e' sufficientemente fermo. Servono almeno tre keyframe, ma 6-8 viste distribuite sono preferibili.

### 5. Vano successivo

Premere **Attraversa passaggio**, camminare normalmente attraverso la porta e poi premere **Sono nel nuovo vano**. Non chiudere WebXR. Acquisire il nuovo perimetro nello stesso modo. Ripetere per tutti i vani collegati.

### 6. Fine e revisione

Nel vano completato premere **Termina scansione**. Scegliere il profilo Deep:

- **Rapido**: meno fotografie, consigliato per telefoni con poca RAM;
- **Bilanciato**: default;
- **Accurato**: piu' fotografie e texture, da usare solo su dispositivi adeguati.

Aprire la planimetria per correggere passaggi e oggetti. Esportare almeno il RAW JSON prima di chiudere la pagina.

## Geometria metrica

Il solo sistema globale e' `local-floor` della sessione WebXR. Ogni vertice di vano, posa camera, portale e oggetto usa coordinate in metri nello stesso frame. La app non applica ICP, TSDF, bundle adjustment globale o rotazioni libere tra stanze.

Il modello del vano contiene:

- footprint 2D metrico sul piano pavimento;
- altezza e shell pavimento/soffitto/pareti;
- porte come intervalli lungo le pareti;
- keyframe con pose e proiezioni sincronizzate.

Una sessione WebXR interrotta non puo' essere ripresa come se la nuova sessione fosse metricamente allineata. I dati parziali restano esportabili e processabili, ma per continuare l'acquisizione metrica occorre una nuova scansione.

## Oggetti

Gli oggetti automatici derivano dai punti osservati davanti alla shell strutturale. Un punto acquista credibilita' solo se supportato da viste spazialmente distinte; punti della stessa posizione camera non sostituiscono la multi-vista. La fusione non collega voxel appartenenti a vani diversi.

La planimetria permette di:

- aggiungere un oggetto manuale con due tocchi e una altezza;
- rinominare un oggetto;
- correggere lunghezza, profondita', altezza e yaw;
- nascondere o mostrare un oggetto;
- rimuovere o ripristinare un oggetto;
- modificare larghezza e altezza superiore dei passaggi.

Dopo una correzione manuale, il cuboide editato diventa la geometria autorevole per anteprima ed export OBJ. I punti originali restano nel RAW e nel PLY per diagnostica.

## Deep batch e scala per fotografia

Il worker carica ONNX Runtime Web 1.23.2 e tenta, in ordine:

1. runtime locale in `vendor/onnxruntime-web/`;
2. runtime remoto da jsDelivr;
3. modello locale `models/depth_anything_v2_small_q4.onnx`;
4. modello Q4 remoto Depth Anything V2 Small;
5. modello uint8 remoto come fallback.

Il modello Q4 remoto e' circa 27.4 MB. Il worker salva i byte del modello in IndexedDB. Il modello non viene caricato mentre WebXR e' attivo.

Il depth monoculare e' relativo. Per ogni keyframe V15 prova sia una trasformazione lineare sia una inversa e sceglie il fit robusto migliore rispetto a:

- campioni depth CPU WebXR con peso maggiore;
- profondita' della shell metrica proiettata nel keyframe.

Un keyframe con fit debole viene marcato come tale e non viene forzato nella fusione. Se runtime o modello non sono disponibili, la app continua in modalita' XR-only con oggetti manuali e texture fotografiche.

## Modalita' completamente locale

Per evitare dipendenze di rete durante il batch Deep:

1. copiare `ort.min.js` e tutti i file `.wasm`/`.mjs` richiesti dalla stessa release ONNX Runtime Web in `vendor/onnxruntime-web/`;
2. copiare il modello in `models/depth_anything_v2_small_q4.onnx`;
3. verificare il checksum del modello;
4. ricaricare la pagina online una volta per aggiornare la shell, oppure installarla come PWA.

Checksum atteso del modello remoto `model_q4.onnx`:

`5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`

Il pacchetto consegnato non include runtime o modello binario, per mantenere il deploy leggero.

## Export

- **RAW JSON**: dati completi riapribili dalla app, fotografie JPEG, pose, matrici, depth grid, fit, oggetti, texture e log.
- **PLY**: punti degli oggetti attivi con colore e identificatore oggetto.
- **OBJ**: shell metriche con aperture e mesh/cuboidi degli oggetti attivi.

Il RAW e' l'export da conservare per continuare il debug o riprocessare con algoritmi futuri.

## Privacy

La app non contiene codice per caricare fotografie su un server applicativo. I keyframe restano nella memoria del browser e nel file RAW esportato dall'utente. Al primo batch Deep possono avvenire richieste verso jsDelivr e Hugging Face per runtime e modello; le immagini non vengono inviate a tali servizi. Usare la camera soltanto in ambienti in cui le persone presenti abbiano accettato la ripresa.

## Limiti dichiarati

- Raw Camera Access e alcune feature WebXR restano dipendenti dall'implementazione del browser e dal dispositivo.
- La metrica dipende dal tracking ARCore e dalla precisione con cui vengono puntati gli angoli.
- Vani su piani diversi, scale e superfici curve non sono modellati automaticamente.
- Oggetti sottili, riflettenti, trasparenti o privi di viste distinte possono essere omessi o fusi.
- Il batch Deep puo' essere lento su telefoni con poca RAM; il profilo Rapido e la modalita' XR-only restano disponibili.
- Questa build e' stata validata in ambiente automatico ma non su un dispositivo ARCore fisico in questo ambiente di sviluppo. Seguire `TEST_ON_PHONE.md` prima di considerarla validata sul campo.

## File principali

- `index.html`: ingresso root GitHub Pages.
- `room_scanner_v12.html`: UI e pagina canonica.
- `roomscan_core.js`: geometria, fitting, voxel, mesh ed export helpers.
- `roomscan_app.js`: stato, WebXR, acquisizione, Deep batch, editor ed export.
- `depth_ai_worker.js`: ONNX Runtime, cache modello, preprocessing e inferenza.
- `sw.js`: cache della shell e fallback offline.
- `manifest.webmanifest`, `icon.svg`: PWA.
- `tests/`: test Node e smoke HTTP.
- `TEST_ON_PHONE.md`: protocollo di validazione fisica.
- `CONTINUATION_HANDOFF.md`: vincoli e punti di continuazione.

## Test automatici

Dalla cartella del progetto:

```sh
./tests/run_all.sh
```

La suite controlla sintassi JavaScript, geometria, fitting di scala, persistenza voxel, contratto worker ONNX simulato, invarianti WebXR/camera, bootstrap DOM, workflow a due vani, distribuzione HTTP e validita' del manifest.
