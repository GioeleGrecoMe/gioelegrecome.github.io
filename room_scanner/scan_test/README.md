# Scan Test v3.5.0

Build fingerprint: `scan-test-v3.5.0-mobile-alva-two-pass-viewer`

Patch incrementale sopra v3.4.1. Mantiene la correzione Deep/Transformers.js 3.8.1 e aggiunge due interventi separati:

1. tracking AlvaAR robusto per video caricati da smartphone;
2. viewer 3D interattivo nel passo 6.

## Perche il tracking mobile cambiava continuamente N -> 0 punti

Il vecchio percorso eseguiva `AlvaAR.findCameraPose()` sincronicamente dentro la callback `requestVideoFrameCallback` del video. Su un telefono il costo WASM puo impedire al main thread di servire in tempo i frame successivi del decoder. Alva riceve quindi una sequenza discontinua proprio durante il bootstrap e puo tornare allo stato di inizializzazione/reset.

La v3.5.0 usa per i video caricati su smartphone un percorso a due passaggi:

- PASSO 1/2: il video viene decodificato senza chiamare Alva. Viene salvata una sequenza iniziale densa mantenendo raster completo, aspect ratio e orientamento. Feature BRIEF e miniature sono rinviate per non appesantire la callback del decoder.
- PASSO 2/2: il video viene fermato. Una nuova istanza Alva riceve i frame archiviati uno per uno: il frame N+1 non puo essere elaborato finche non e terminato il frame N.

Il raster dei file resta a lato lungo 960 px per non impoverire la griglia di feature. La camera live mobile usa 720 px, dato che non puo essere messa in pausa e rigiocata.

Il primo passaggio parte a 0.25x. Se `presentedFrames` segnala frame persi, rallenta automaticamente a 0.125x. Dopo il bootstrap puo accelerare. Su mobile l'archivio file e limitato anche nel numero di frame per evitare di saturare la memoria prima di Deep.

## Diagnostica Alva

Il wrapper Alva espone ora lo stato interno dell'ultima chiamata. Il log sempre visibile mostra:

- `initializing`, `tracking` o `reset`;
- numero di punti;
- ms/frame;
- reset interni;
- frame del compositor saltati;
- transizioni N -> 0 punti.

Per i video mobile, durante PASSO 1/2 non devono comparire punti Alva: il badge deve indicare che Alva e differito. I punti compaiono soltanto nel PASSO 2/2 a decoder fermo.

## Passo 6 - viewer 3D

Il viewer finale e navigabile:

- trascinamento sinistro / un dito: orbita;
- Shift + trascinamento, tasto destro o centrale: pan;
- rotellina o pinch: zoom;
- due dita: pan + pinch;
- preset Isometrica, Alto, Fronte, Lato;
- Reset / centra;
- tastiera: frecce, Shift+frecce, +/- e R/Home.

Il cloud non viene modificato dai controlli di navigazione. Durante il trascinamento puo essere usato solo un LOD visuale temporaneo.

## Deploy

Lo ZIP e flat. Estrarre direttamente il contenuto in:

`room_scanner/scan_test/`

Dopo il deploy deve essere visibile il fingerprint:

`scan-test-v3.5.0-mobile-alva-two-pass-viewer`

