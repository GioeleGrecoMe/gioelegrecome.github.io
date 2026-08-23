# Scan Test v3.4.2

Build fingerprint: `scan-test-v3.4.2-interactive-3d-viewer`

Patch incrementale sopra v3.4.1. AlvaAR e Deep Anything non vengono modificati: la modifica riguarda soltanto il viewer del passo 6 e mantiene il dock diagnostico sempre visibile introdotto in v3.4.x.

## Passo 6 - navigazione 3D

Il vecchio rendering isometrico fisso e sostituito, solo nel passo 6, da una camera ortografica interattiva sullo stesso cloud/splat RGB gia costruito.

Controlli desktop:
- trascinamento sinistro: orbita yaw/pitch;
- Shift + trascinamento, tasto destro o centrale: pan;
- rotellina: zoom;
- doppio click o pulsante `Reset / centra`: ripristino camera;
- frecce: orbita;
- Shift + frecce: pan;
- `+` / `-`: zoom;
- `R` o Home: reset.

Controlli touch:
- un dito: orbita;
- due dita: pinch zoom + pan simultaneo;
- pulsante `Reset / centra` sempre disponibile.

Sono presenti preset Isometrica, Alto, Fronte e Lato. La vista iniziale riproduce matematicamente la stessa proiezione isometrica usata dalla v3.4.1, quindi l'aspetto iniziale non cambia; cambia solo la possibilita di navigarlo.

Durante il trascinamento, se il cloud e molto grande, il renderer usa temporaneamente un LOD visuale fino a circa 90k particelle per mantenere l'interazione fluida; al rilascio viene ridisegnato il cloud completo. Nessuna particella viene cancellata dai dati.

## Deploy

Lo ZIP e flat. Copiare i file direttamente in `room_scanner/scan_test/` sovrascrivendo gli omonimi.

Dopo il deploy deve comparire il fingerprint:
`scan-test-v3.4.2-interactive-3d-viewer`

## Test

`node tools/test_v342_viewer_navigation.mjs`

Il test verifica orbit/pan/zoom/pinch, preset, touch-action, LOD interattivo e che la camera predefinita sia matematicamente equivalente alla precedente vista isometrica.
