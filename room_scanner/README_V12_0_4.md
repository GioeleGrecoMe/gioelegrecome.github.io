# Room Scanner V12.0.4 - Ultra-wide 0.5x Deep observations

## Obiettivo

V12.0.4 separa definitivamente la camera metrica WebXR dalla camera RGB usata da Depth Anything.
WebXR resta l'autorita per posa, scala, depth, planes e mesh. Depth Anything riceve esclusivamente frame di una camera posteriore verificata come piu ampia della raw-camera XR (target: 0.5x) e produce una mesh locale per keyframe.

La nuova catena e:

`WebXR pose/depth/planes/mesh + MediaStream 0.5x -> sync temporale -> calibrazione 0.5x -> XR reprojection -> Depth Anything -> metric correction -> photo mesh -> multi-view fusion -> structural shell`

Non esiste fallback silenzioso che mandi la raw-camera XR a Depth Anything.

## Uso sul telefono

1. Aprire la pagina in HTTPS.
2. Premere **Prepara camera 0.5x** prima di avviare WebXR.
3. Accettare il permesso camera. La pagina enumera/prova le camere posteriori, applica il minimo zoom se la track lo supporta e conserva la candidata piu larga.
4. Premere **Avvia scansione AR**.
5. WebXR viene avviato come autorita metrica; subito dopo la pagina prova ad aprire in parallelo la camera 0.5x gia selezionata.
6. Se il browser/dispositivo non permette la contemporaneita, WebXR continua normalmente ma i keyframe Deep vengono saltati e compare `UWA_CONCURRENT_FAILED` nei log.
7. Muoversi con baseline reale; i keyframe 0.5x vengono associati alla posa XR temporalmente piu vicina.

## Perche il preflight e separato

La raw-camera WebXR e legata alla XRView e non rappresenta necessariamente l'intero campo visivo fisico della lente. V12.0.4 usa Media Capture come sorgente separata e verifica empiricamente che il flusso selezionato sia significativamente piu largo della camera XR.

Il pulsante di preparazione evita inoltre di trasformare la selezione/probing delle camere in una dipendenza critica del gesto che avvia la sessione immersive-ar.

## Selezione e verifica della 0.5x

La selezione usa due livelli:

- indizi dal label del device (`ultra wide`, `0.5`, `grandangolo`, `rear`, ecc.);
- verifica geometrica durante XR tramite registrazione visuale tra il frame 0.5x e la raw-camera XR.

La registrazione usa gradient NCC con ricerca di scala e traslazione 2D. Una camera con FOV sostanzialmente uguale a XR viene rifiutata. Dopo che la calibrazione globale ha almeno due campioni affidabili, una registrazione visuale temporaneamente debole puo riusare la calibrazione stabile gia verificata; il riuso e sempre loggato come `UWA_REGISTRATION_REUSED`.

## Sincronizzazione temporale

Il MediaStream usa `requestVideoFrameCallback()` quando disponibile e conserva `captureTime`. Parallelamente WebXR mantiene un ring buffer di pose metriche. Ogni frame 0.5x viene associato alla posa XR piu vicina e salva:

- timestamp fotografico;
- sorgente del timestamp;
- timestamp della posa XR;
- errore temporale `poseAgeMs`;
- eta del frame al momento del keyframe.

Frame troppo vecchi vengono rifiutati con `UWA_FRAME_STALE`.

## Modello geometrico della camera 0.5x

Ogni keyframe 0.5x possiede intrinseche e posa proprie. La stima iniziale deriva dalla registrazione visuale rispetto alla XRView. Dopo l'inferenza Depth Anything viene raffinata contro ancore metriche WebXR riproiettate nella foto.

Vengono ottimizzati con limiti stretti:

- `fx`, `fy` normalizzati;
- `cx`, `cy`;
- una piccola traslazione rigida statica `T_XR_from_0.5x` (massimo 5.5 cm per asse).

La posa globale WebXR non viene ottimizzata. La traslazione e regolarizzata e aggiornata globalmente soltanto da fit metrici accettabili. L'eventuale residuo angolare viene assorbito conservativamente dalla calibrazione proiettiva; una calibrazione Camera2 fisica non e disponibile nel browser standard.

## Ancore WebXR nella foto 0.5x

Le misure depth WebXR non vengono confrontate usando le coordinate immagine XR. Ogni punto metrico viene trasformato nel modello camera 0.5x e riproiettato in `(u,v,d)` della fotografia. Le ancore salvate hanno provenienza `paired XR depth`.

Sono usati anche surfel XR gia consolidati, con peso inferiore rispetto alla depth temporalmente accoppiata.

## Depth Anything e mesh per foto

Per ogni keyframe valido:

1. Depth Anything produce depth relativa.
2. Le ancore XR stimano il fit relativo->metrico robusto.
3. Un campo metrico locale corregge gli errori residui senza modificare la posa XR.
4. La calibrazione 0.5x viene rifinita contro le stesse ancore.
5. La depth metrica viene triangolata in una mesh locale edge-aware.
6. Triangoli che attraversano forti discontinuita di depth/immagine vengono eliminati.
7. I vertici sono ammessi tramite supporto XR, mesh/plane, seconda vista e controlli di spazio libero.
8. I candidati precedenti vengono rivalutati quando arrivano nuove viste.

## Colore WebXR

V12.0.4 continua a salvare anche i colori della geometria WebXR. La raw-camera XR viene usata per colorare surfel metrici quando la proiezione/visibilita e coerente. Questo uso e separato dall'ingresso di Depth Anything.

## Struttura e mesh chiusa

La parte strutturale V12.0.3 resta attiva:

- floor / ceiling / walls da XR plane, XR mesh, depth e Deep verificato;
- poligoni finiti;
- merge di piani compatibili;
- Manhattan prior morbido;
- angoli come intersezioni tra piani;
- footprint concavo supportato;
- triangolazione ear-clipping;
- `ROOM_SHELL` watertight quando l'evidenza minima e sufficiente;
- parti completate per chiusura marcate come inferite, non misurate.

Gli oggetti restano separabili, ma V12.0.4 non aumenta deliberatamente la complessita del riconoscimento oggetti: la priorita e la camera 0.5x e il guscio stanza.

## Diagnostica

I log sono parte del dato e vengono conservati nel RAW (fino a 600 eventi). Codici principali:

- `UWA_PROBE_START`
- `UWA_PROBE_DEVICE`
- `UWA_SELECTED`
- `UWA_ZOOM_MIN_APPLIED`
- `UWA_ZOOM_MIN_FAILED`
- `UWA_STREAM_STARTED`
- `UWA_CONCURRENT_FAILED`
- `UWA_NO_RVFC`
- `UWA_FRAME_STALE`
- `UWA_REGISTRATION_REJECTED`
- `UWA_REGISTRATION_REUSED`
- `UWA_KEYFRAME_SKIPPED`
- `UWA_CAMERA_REFINED`
- `UWA_GLOBAL_CALIBRATION`
- `XR_COLOR_PAINT`

`UWA_CAMERA_REFINED` espone almeno errore iniziale/finale, numero di ancore/celle, mediana/P90 metrica, extrinsic in mm e coverage XR nella foto.

`UWA_GLOBAL_CALIBRATION` espone numero di campioni, intrinseche normalizzate, extrinsic media e residuo metrico.

## RAW V12.0.4

Schema: `room-scanner-v12.0.4-raw`.

In aggiunta ai campi precedenti salva:

- device/probe 0.5x;
- calibrazione globale ultra-wide;
- history delle registrazioni;
- errore di concorrenza camera, se presente;
- `sourceCamera` per ogni keyframe;
- timestamp foto e sorgente timestamp;
- diagnostica sync con pose XR;
- calibrazione per-keyframe;
- `xrWorldAnchors` riproiettabili;
- depth relativa, fit metrico, mesh fotografica e statistiche di admission.

L'import resta compatibile con RAW V12.0.1, V12.0.2 e V12.0.3.

## Limiti noti da verificare su dispositivo reale

Il punto non simulabile in desktop e la possibilita del browser/telefono di tenere aperti contemporaneamente la camera usata dal runtime immersive-ar e un secondo MediaStream posteriore. V12.0.4 considera questo un capability check, non un'assunzione.

Inoltre Media Capture non fornisce le calibrazioni fisiche Camera2 tra le lenti. Per questo la registrazione viene stimata online e resta accompagnata da confidenza/residui diagnostici.

## Test reali consigliati

### A. Concorrenza camera

- preparare la 0.5x;
- avviare XR;
- verificare `UWA_STREAM_STARTED`;
- verificare assenza di `UWA_CONCURRENT_FAILED`;
- controllare che Deep keyframes abbiano `sourceCamera = ultrawide-0.5x`.

### B. Verifica FOV

Inquadrare un angolo stanza con elementi visibili ai bordi. Nei log controllare:

- registration score;
- registration scale > circa 1.14;
- stabilita di dx/dy;
- eventuali `UWA_REGISTRATION_REJECTED`.

### C. Stabilizzazione metrica

Ruotare/camminare attorno allo stesso angolo con baseline 30-60 cm. Controllare che:

- `UWA_GLOBAL_CALIBRATION.samples` cresca;
- `extrinsicMm` si stabilizzi;
- mediana/P90 non peggiorino;
- coverage delle ancore nella 0.5x cresca;
- Deep multi-view aumenti senza crescita analoga dei `conflicts`.

### D. Chiusura stanza

Scansionare pavimento, soffitto e tutti gli angoli. Verificare che il viewer distingua parti osservate da parti inferite e che l'export produca una `ROOM_SHELL` chiusa soltanto quando l'evidenza minima e sufficiente.
