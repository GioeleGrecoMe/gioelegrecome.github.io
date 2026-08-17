# Room Scanner V12.2.4 — Multi-view Corner Anchors + Closed Structural Shell

V12.2.4 mantiene l'acquisizione guidata della V12.2.3 e risolve il limite principale rimasto: **gli spigoli del footprint non vengono più sovrascritti dall'ultimo click WebXR**. Ogni spigolo diventa un'entità persistente osservabile da più viste e viene stimato per triangolazione robusta dei raggi.

## Obiettivo

La rappresentazione finale resta volutamente semplice:

- `ROOM_SHELL`: pavimento + soffitto + pareti, chiusa e manifold;
- pareti texturizzate;
- WebXR strutturale RGB schiacciato sulle superfici parametriche;
- oggetti interni come cloud RGB XR+Deep + OBB orientato;
- raw evidence conservabile in RAW per diagnosi/ricalcolo.

Deep Anything non è mai autorizzato a creare liberamente una seconda parete inclinata: la struttura è definita dal footprint verificato e raffinato, dagli anchor WebXR multi-vista e dai piani/surfel persistenti.

## Workflow utente

### 1. Traccia il pavimento

L'utente punta il reticolo sul pavimento e aggiunge gli spigoli. Ogni click salva anche un keyframe RGB/pose/depth quando disponibile.

Il primo giro definisce soprattutto la **topologia** della stanza; non viene assunto come misura finale.

### 2. Ancora gli spigoli da più viste

Per ogni P1, P2, ...:

1. seleziona lo spigolo;
2. puntalo da una prima posizione;
3. spostati lateralmente;
4. puntalo di nuovo;
5. idealmente aggiungi una terza vista.

Il puntatore può mirare allo stesso spigolo verticale sia nella zona parete-pavimento sia nella zona parete-soffitto. Il solver usa il raggio completo della camera e stima la posizione XZ dello spigolo mediante robust least squares/IRLS.

La pianta mostra:

- rosso: anchor insufficiente;
- giallo: almeno due viste ma geometria ancora debole;
- verde: baseline/residuo/confidenza sufficienti;
- `P3 · 3v`: numero di viste che sostengono lo spigolo.

L'ultimo click **non sostituisce** il vertice: aggiorna la stima condivisa.

### 3. Quota del soffitto dagli spigoli superiori

Quando l'utente punta il raccordo parete-soffitto dello stesso spigolo verticale, il solver ricava anche la quota Y compatibile con il corner XZ stimato. Più spigoli superiori forniscono una stima robusta del soffitto.

Questo permette di ottenere l'altezza anche quando il raccordo parete-pavimento è coperto da mobili.

### 4. Raffina con WebXR

Dopo la prima verifica della pianta, una passata WebXR raccoglie:

- CPU depth;
- XRPlane;
- XRMesh;
- RGB raw-camera;
- surfel persistenti con media, normale, varianza e confidence.

Le pareti del prior vengono corrette tramite popolazioni XR persistenti e longitudinalmente estese. Una faccia interna di mobile parallela ma corta viene penalizzata rispetto alla frontiera della stanza.

Gli angoli corretti vengono sempre ricalcolati come intersezioni delle linee parete, quindi il footprint resta chiuso.

### 5. Verifica nuovamente la pianta

La correzione XR non diventa invisibilmente autoritativa. La pianta metrica viene mostrata di nuovo prima delle fotografie parete.

### 6. Foto pareti multi-vista

Ogni parete possiede tre coverage map indipendenti:

- XR;
- foto;
- Deep validato.

Una singola foto non deve contenere tutta la parete. In un corridoio stretto più fotografie parziali possono coprire progressivamente la stessa superficie.

Il workflow impedisce di terminare la fase foto se una parete ha una coverage fotografica troppo bassa (`wallPhotoFinishMin`).

### 7. Deep batch

Depth Anything viene eseguito solo dopo la sessione XR. Il fit metrico usa:

1. depth XR sincronizzata;
2. anchor gaussiani/surfel XR persistenti riproiettati nella foto;
3. shell analitica come fallback più debole.

I campioni classificati come parete vengono proiettati esattamente sul piano confermato. I campioni davanti diventano residui-oggetto. I campioni incompatibili dietro la shell non possono gonfiare la stanza.

## Closed shell

`buildGuidedRoomShell()` produce esplicitamente:

- pavimento;
- soffitto;
- pareti laterali;
- triangolazione del footprint anche concavo.

Nel viewer `drawRoomCaps()` evidenzia pavimento e soffitto, così la chiusura non è soltanto topologica ma anche visivamente verificabile.

## WebXR RGB strutturale

`buildSnappedXrModel()` conserva separatamente due concetti:

- **raw XR evidence**: utile per riconoscere oggetti/volumi interni;
- **structural XR model**: solo i surfel compatibili con pareti/floor/ceiling e proiettati esattamente sulle superfici parametriche.

Questo evita che l'oscillazione WebXR renda le pareti spesse o sdoppiate.

## Oggetti interni

Gli oggetti sono costruiti dal residuo combinato:

- WebXR RGB persistente non strutturale;
- Deep foreground multi-vista.

La rappresentazione primaria resta:

- point cloud RGB voxelizzata;
- OBB orientato sul pavimento;
- confidence/persistenza;
- stato visible/hidden/removed.

I box sono strumenti di gestione, non la geometria principale dell'oggetto.

Il PLY V12.2.4 esporta esplicitamente quattro sorgenti:

- `1 = XR_structural`;
- `2 = Deep_structural`;
- `3 = Deep_residual`;
- `4 = XR+Deep_object`.

Quindi lo snapping delle pareti non elimina la geometria interna degli oggetti.

## Prestazioni

- nessun Deep live durante WebXR;
- nessun vero 3D Gaussian Splatting;
- statistiche gaussiane riusano i voxel XR;
- point cloud strutturale finale compattata;
- object cloud limitata/voxelizzata;
- ONNX worker liberato fuori dal batch;
- coverage per superficie anziché densificazione globale.

## Test

```bash
node tests/test_v12_2_4_static.js
node tests/test_v12_2_4_runtime.js
node tests/test_v12_2_4_package.js
```

La suite copre, fra gli altri casi:

- reticolo pavimento e pulsante spigolo;
- triangolazione multi-vista di un corner con prior volutamente errato ~30 cm;
- baseline angolare minima;
- stima soffitto dai corner superiori;
- wall refinement XR persistente dietro una faccia di mobile;
- coverage multi-foto;
- snapping WebXR strutturale;
- floor/ceiling caps;
- parete/object/optical Deep;
- ROOM_SHELL manifold;
- OBB oggetti;
- export PLY con cloud oggetti XR+Deep;
- service worker/build V12.2.4.

## Validazione device-only

Node/Chromium desktop non possono validare il runtime ARCore. Sul dispositivo reale verificare almeno:

1. stesso corner puntato da 3 posizioni;
2. corner inferiore coperto ma raccordo parete-soffitto visibile;
3. corridoio stretto con più foto per la stessa parete;
4. mobile davanti a parete;
5. preview con floor e ceiling visibili;
6. export PLY/OBJ e re-import.
