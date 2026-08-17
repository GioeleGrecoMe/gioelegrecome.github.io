# Room Scanner V12.2.1 — Orthographic Surface Reconstruction

## Obiettivo

V12.2.1 privilegia una rappresentazione compatta e verificabile della stanza:

- pavimento definito dal perimetro WebXR guidato e confermato dall'utente;
- pareti definite dai lati del perimetro, non inferite liberamente da Depth Anything;
- soffitto stimato robustamente da più fotografie e depth XR quando disponibile;
- texture RGB per parete;
- oggetti interni come residuo 3D separato;
- evidenza XR/Deep disponibile come diagnostica, ma non come geometria primaria del modello finale.

Il workflow di acquisizione V12.2.0 resta invariato: nessuna seconda camera, nessun keyframe automatico, nessun Deep live durante WebXR.

## 1. Viewer ortografico/isometrico

Il viewer finale non usa più una proiezione prospettica. La coordinata schermo dipende dalle componenti lungo gli assi `right/up` della camera virtuale e non viene divisa per la profondità.

Default:

- yaw: 45°;
- pitch: -35.264°;
- proiezione ortografica;
- layer shell + texture + oggetti attivi;
- nuvole XR/Deep disattivate di default perché sono evidenza diagnostica.

Il pulsante `Isometrica` ripristina immediatamente la vista standard e riesegue `fitScene()`.

## 2. Guida di posa per fotografare una parete

La parete da acquisire è già nota metricamente dal perimetro confermato. Per ogni frame WebXR vengono calcolati:

- angolo fra direzione di vista orizzontale e normale della parete;
- frazione della parete proiettata nel frame;
- errore di centratura;
- distanza dalla parete;
- visibilità dei quattro estremi stimati;
- visibilità del raccordo parete-soffitto.

Il display AR riceve un overlay semitrasparente:

- **verde**: vista consigliata;
- **giallo**: vista utilizzabile ma migliorabile;
- **rosso**: vista radente, troppo vicina/lontana o scarsamente centrata.

La foto non è bloccata in rosso: il colore è una guida, non un vincolo rigido. Le viste moderatamente oblique restano valide se aggiungono informazione utile.

Ogni fotografia memorizza anche il `wallViewGuide` usato al momento dello scatto.

## 3. Deep vincolato alla shell, non fusione libera

Per una parete confermata, la posizione 3D lungo un pixel è già determinabile dall'intersezione fra il raggio camera e il piano metrico della parete.

La depth relativa Deep viene prima calibrata con:

1. depth XR sincronizzata quando disponibile;
2. profondità analitica della parete confermata;
3. fit robusto relative→metric tramite RANSAC scale+shift.

Successivamente ogni campione viene classificato rispetto alla shell:

- vicino alla parete nota → **wall**, riproiettato esattamente sul piano metrico;
- significativamente davanti → **object/residual**;
- significativamente dietro → **optical/opening evidence**, escluso dalla geometria;
- incompatibile → rejected.

Quindi una fotografia Deep non può introdurre una nuova inclinazione della parete già confermata.

## 4. Occlusioni, finestre e specchi

V12.2.1 non pretende di classificare semanticamente in modo perfetto `specchio` vs `finestra`. Usa una classe conservativa geometrica `superficie ottica / apertura`.

Quando un pixel che dovrebbe appartenere alla parete vede ripetutamente profondità molto dietro la shell:

- non viene usato per modificare la parete;
- non viene trasformato in oggetto davanti;
- viene accumulato come evidenza di apertura/non-Lambertian surface;
- se persiste in più viste, produce una `wallFeature` finita sulla superficie.

La shell resta quindi chiusa anche in presenza di finestre/specchi. L'apertura è una feature della superficie, non un buco incontrollato nella depth.

## 5. Texture per parete

La rappresentazione visiva primaria della parete è un piccolo atlas RGB in coordinate locali della superficie.

Per ogni parete:

1. vengono ordinate le fotografie candidate in base a qualità, angolo di vista, centratura, copertura e occlusione;
2. viene costruito un atlas con risoluzione proporzionale alle dimensioni metriche della parete;
3. per ogni texel la superficie viene riproiettata nelle fotografie candidate;
4. i pixel classificati come oggetto davanti vengono esclusi;
5. i pixel di finestra/specchio/apertura possono contribuire al colore, ma non alla geometria;
6. viene selezionato il colore della vista migliore per quel texel.

Una foto esplicitamente acquisita per una parete può essere usata come **texture-only evidence** anche se il fit Deep fallisce. In quel caso non modifica la geometria; XR depth, se disponibile, può ancora mascherare foreground.

Qualità batch e texture:

- Alta: atlas completo, fino a 3 viste migliori;
- Bilanciata: circa 80% della risoluzione massima;
- Rapida: circa 60%, massimo 2 viste.

Le texture vengono salvate JPEG nel RAW; i buffer RGBA possono quindi essere rilasciati dopo la costruzione dell'atlas.

## 6. Oggetti interni

La shell viene costruita prima. Il residuo 3D significativamente davanti alle pareti/pavimento/soffitto confermati viene raggruppato come oggetto soltanto quando possiede sufficiente persistenza/supporto.

Gli oggetti rimangono entità separate:

- point cloud/voxel evidence;
- bounding volume/mesh compatta;
- provenienza e confidence;
- hide/remove/add indipendente;
- export separabile.

Non possono spostare il perimetro della stanza.

## 7. Modello finale leggero

La geometria primaria non contiene migliaia di punti per parete. Una stanza semplice è rappresentata principalmente da:

- footprint metrico;
- pavimento triangolato;
- soffitto triangolato;
- quadrilateri delle pareti;
- atlas JPEG per superficie;
- mesh/cluster degli oggetti.

Le nuvole XR e Deep rimangono disponibili come evidenza/debug ed export, ma non sono la rappresentazione necessaria per visualizzare la stanza.

## 8. Pipeline completa

```text
WebXR guided floor perimeter
        ↓
manual correction + metric plan verification
        ↓
confirmed wall planes
        ↓
wall-view guidance (red/yellow/green)
        ↓
RGB + pose + intrinsics + optional XR depth
        ↓
Depth Anything batch
        ↓
robust relative→metric fit against XR + analytic shell depth
        ↓
wall / object / optical-opening classification
        ↓
ceiling aggregation
        ↓
compact ROOM_SHELL
        ↓
per-wall texture atlases
        ↓
persistent internal objects
```

## 9. Automated tests

Run from this directory:

```bash
node tests/test_v12_2_1_static.js
node tests/test_v12_2_1_runtime.js
node tests/test_v12_2_1_package.js
```

The test suite checks, among other things:

- unique DOM IDs and valid UI references;
- one WebXR `requestSession()`;
- no second-camera APIs;
- no automatic RGB keyframes;
- orthographic projection invariant to depth along the view axis;
- wall-view guidance;
- robust Deep scale/shift fitting;
- wall/object/optical classification;
- wall points snapped to the confirmed plane;
- persistent optical/opening features;
- rectangular and concave watertight shells;
- service-worker/build identity.

## 10. Device test recommended

Use a simple four-wall room first.

1. Trace and confirm the floor perimeter.
2. Intentionally correct at least one corner.
3. Capture one wall from a red pose, then move until yellow/green and capture again.
4. Include one wall partly hidden by furniture.
5. If possible include a window or mirror.
6. Process in `Bilanciata` first.
7. Verify that the final viewer shows one clean wall plane, not multiple Deep sheets.
8. Toggle XR/Deep diagnostic layers only after inspecting the clean shell.
9. Inspect wall texture coverage and detected optical/opening features in Review.

## Known limits

- Mirror/window detection is geometric and conservative; it does not claim semantic material recognition.
- Texture atlases are lightweight per-wall mosaics, not a full photogrammetric global texture optimization.
- Openings are recorded as wall features but the main acoustic shell remains closed in this revision.
- Ceiling geometry remains intentionally low-DOF; complex vaulted/sloped ceilings require a later dedicated surface model.
- Physical WebXR camera/depth behavior remains device/browser dependent and must be validated on Android/ARCore hardware.
