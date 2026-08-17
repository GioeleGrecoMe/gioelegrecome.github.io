# Room Scanner V12.2.0 — Guided Metric Room

V12.2.0 cambia deliberatamente strategia rispetto alla famiglia V12.1.x. L'obiettivo non è più scoprire automaticamente la struttura della stanza da una fusione densa WebXR + Depth Anything. Su telefoni poco potenti, la struttura viene prima resa osservabile e correggibile dall'utente; Deep lavora soltanto dopo, su una geometria già vincolata.

## Workflow

### 1. Traccia pavimento

- La sessione usa `local-floor`, quindi il piano metrico del pavimento è `y = 0` nel reference space WebXR.
- Il reticolo centrale viene intersecato analiticamente con quel piano.
- `Aggiungi spigolo + foto` salva:
  - posizione metrica `[x,0,z]`;
  - RGB raw della stessa `XRView`;
  - posa WebXR;
  - projection/intrinsics;
  - griglia CPU depth XR sincronizzata, se disponibile.
- Non esistono keyframe RGB automatici.
- Il perimetro può essere concavo, purché sia un poligono semplice e non auto-intersecante.

### 2. Correggi perimetro

Dopo la chiusura:

- il poligono rimane sovrapposto in AR;
- un vertice selezionato può essere spostato sul reticolo metrico;
- il vertice può essere eliminato;
- ogni spostamento può salvare un nuovo keyframe RGB (`corner-refine`);
- la modifica della topologia invalida automaticamente le vecchie foto `wall`, perché gli indici delle pareti non sarebbero più affidabili.

### 3. Verifica pianta

La pianta usa:

- P1 come origine `(0,0)`;
- asse X lungo P1→P2;
- griglia metrica da 0.5 m;
- lunghezza di ogni lato;
- area;
- perimetro;
- bounding box nel sistema locale della stanza.

Solo `Conferma perimetro` rende la pianta autorità strutturale.

### 4. Foto pareti

Per ogni lato viene mostrato in AR il rettangolo verticale temporaneo corrispondente alla parete attiva.

`Foto parete + soffitto` salva un keyframe associato a `wallIndex`. È consigliato includere:

- una quantità visibile di parete libera;
- il raccordo parete-soffitto;
- eventuali mobili davanti alla parete.

Le frecce cambiano parete. È possibile acquisire più foto della stessa parete.

### 5. Processa modello

Il processing è batch e transazionale. Il vecchio modello resta visibile finché il nuovo batch non è terminato.

Per ogni foto:

1. Depth Anything produce profondità relativa.
2. Se la CPU depth WebXR sincronizzata copre abbastanza celle, questa è l'ancora metrica principale.
3. Se la depth XR non è sufficiente, il perimetro confermato viene renderizzato analiticamente dalla posa della foto: per ogni raggio si calcola l'intersezione con la parete nota.
4. Un RANSAC deterministico prova sia `depth` sia `1/depth` e stima scale + shift robusti in presenza di mobili/outlier.
5. La depth Deep metrizzata viene classificata per raggio:
   - compatibile con la parete → **snap esatto sulla parete confermata**;
   - vicina a `y=0` → pavimento;
   - significativamente davanti alla parete → residuo/oggetto;
   - significativamente dietro la parete → rifiuto.
6. Le regioni alte più vicine della parete e l'inviluppo superiore dei wall-inlier di più foto stimano una quota comune di soffitto.
7. I candidati compatibili con quella quota vengono proiettati sul soffitto.
8. Il residuo interno persistente viene voxelizzato e raggruppato in oggetti coarse rimovibili.
9. Il perimetro viene estruso fino alla quota soffitto e produce `ROOM_SHELL`, una mesh chiusa/manifold.

## Perché elimina i "fogli Deep ruotati"

La normale della parete non viene mai ricavata dalla singola foto Deep. Per una parete `i`, posizione, direzione e lunghezza sono già fissate dai due vertici metrici del pavimento.

Una foto può soltanto:

- aderire a quella parete;
- mostrare qualcosa davanti a quella parete;
- fornire informazione sulla quota del soffitto;
- essere incompatibile.

Un wall point ammesso viene sostituito dalla sua intersezione con il piano della parete. Tre fotografie dello stesso angolo non possono quindi produrre tre muri leggermente ruotati.

## Strategia per telefoni poco potenti

Durante WebXR sono disabilitati volutamente:

- inferenza Depth Anything;
- TSDF carving;
- clustering strutturale automatico di XRPlane/XRMesh;
- fusione Deep live;
- keyframe RGB automatici.

Durante XR rimangono:

- pose;
- CPU depth campionata;
- surfel metrici XR RGB;
- foto esplicitamente richieste;
- overlay 2D del perimetro/parete.

Il worker ONNX viene aperto soltanto nel batch finale, dopo la chiusura della sessione XR, e viene rilasciato al termine.

## Preview Deep in AR

Non è abilitata in V12.2.0. È una scelta intenzionale: tenere contemporaneamente WebXR/ARCore + raw camera + ONNX Runtime + mesh Deep aumenta molto RAM/GPU e ha già mostrato instabilità nelle revisioni precedenti.

Durante l'acquisizione il preview utile è invece la geometria che conta realmente:

- perimetro metrico;
- vertice selezionato;
- parete attiva.

Le mappe Deep vengono mostrate in Revisione dopo il batch.

## Qualità batch

- **Alta**: 392 px, più campioni.
- **Bilanciata**: 336 px.
- **Rapida**: 280 px e campionamento più sparso.

`Riduci qualità e riavvia` interrompe il batch dopo lo step corrente e ricomincia con il profilo inferiore senza sostituire il precedente modello valido.

## Export

- RAW V12.2.0 conserva perimetro guidato, ruoli dei keyframe, RGB, posa, depth XR, mappe Deep quantizzate, modello finale e oggetti.
- PLY conserva point evidence compatta con RGB/confidence/source/object_id.
- OBJ contiene la `ROOM_SHELL` chiusa e gli oggetti attivi.
- PLY e OBJ possono essere ricaricati nel viewer.

## File di deploy

Sostituire nel repository:

- `room_scanner_v12.html`
- `sw.js`
- `build_info.json`

Mantenere invariati:

- `depth_ai_worker.js`
- `models/depth_anything_v2_small_q4.onnx`
- `vendor/depthai-123/`

## Test

```bash
node --check extracted_module.js
node --check sw.js
node tests/test_v12_2_0_static.js
node tests/test_v12_2_0_runtime.js
node tests/test_v12_2_0_package.js
```

I test verificano, tra le altre cose:

- nessuna seconda camera;
- una sola richiesta `immersive-ar`;
- niente keyframe automatici;
- poligono semplice e concavo;
- rifiuto del bow-tie auto-intersecante;
- RANSAC scale/shift con outlier;
- wall ray intersection analitica;
- snap Deep sulla parete metrica;
- oggetto più vicino della parete;
- stima soffitto multi-foto;
- ROOM_SHELL chiusa, inclusa stanza a L;
- coerenza service worker/build info.

## Test fisico raccomandato

Primo test reale semplice:

1. stanza rettangolare con 4 spigoli chiaramente visibili;
2. traccia P1→P4;
3. percorri il perimetro e correggi i punti in AR;
4. verifica le quattro quote in pianta;
5. conferma;
6. fai almeno 1–2 foto per parete includendo il soffitto, con un mobile davanti a una parete;
7. processa in Bilanciata;
8. controlla che la parete dietro il mobile resti una sola superficie e che il mobile compaia come residuo/oggetto;
9. esporta OBJ e ricaricalo nel viewer.

Il test browser/Node non può emulare ARCore, `XRView.camera` o CPU Depth del telefono: la validazione di questi tre componenti resta necessariamente device-only.
