# Continuation handoff — V20.0.0

## Baseline

Build: `v20.0.0-rgb-acoustic-safe-handoff-20260818`

Entry point: `room_scanner_v12.html`

## Invarianti da non rompere

- Una sola sessione WebXR per tutti i vani collegati.
- `local-floor` è l’unico riferimento metrico globale.
- `getCameraImage()` resta dentro il callback XR rAF.
- Nessun `getUserMedia` o secondo stream camera.
- Nessun Deep/ONNX mentre WebXR o l’handoff sono attivi.
- Nessuna chiusura automatica del perimetro per prossimità al primo punto.
- Oggetti automatici richiedono evidenza da viste spazialmente distinte e non fondono vani diversi.
- Le pareti non vengono spostate da Deep.
- I valori acustici automatici restano marcati come prior non misurati.
- Le modifiche manuali alle superfici acustiche hanno precedenza.

## Handoff post-XR

`saveAndCloseXR()` sospende gli scatti e chiama `session.end()` senza avviare structured clone o IndexedDB. L’evento `end` azzera subito il riferimento alla sessione, chiama `cleanupXRResources()` e solo dopo esegue `completePostXRHandoff()`: i JPEG vengono salvati come record IndexedDB separati, il checkpoint principale conserva i riferimenti, viene scritto il marker `room-scanner-v20-post-xr-handoff`, la pagina si ricarica e `initialize()` richiama `recoverPostXRHandoff()`.

Il processing deve restare bloccato quando:

```text
state.session
state.navigationExitPending
state.handoffPending
!state.postXrReady
state.process.running
```

## Modello oggetti

Oggetto automatico:

```text
points[]          centri voxel con RGB
mesh              facce voxel esterne con colors[] e triangleFaceKeys[]
obb               proxy orientata editabile
shape             voxelSize, occupiedVolume, obbVolume, fillRatio
rgbSummary        mean, pointCount
```

Oggetto manuale: punti di superficie sintetici marcati `synthetic: true`.

Quando cambia l’OBB, usare `transformPointsBetweenObbs()`; non lasciare i punti nella posa precedente. Dopo import o modifica, chiamare `assignMeshAcousticFaces()` per garantire una etichetta acustica per ogni triangolo.

## Modello acustico

Core in `roomscan_core_v20_0_0.js`:

- `ACOUSTIC_BANDS`;
- `MATERIAL_LIBRARY`;
- `visualFeaturesFromColors/Rgba`;
- `tinyMaterialPosterior`;
- `buildAcousticSurfaceModel`;
- `applyMaterialToSurface`;
- `acousticSummary`.

ID stabili:

```text
R1:floor
R1:ceiling
R1:wall:0
O1:face:front
```

`buildAcousticSurfaceModel()` preserva una superficie precedente quando `material.mode === 'manual'`. Le superfici oggetto espongono `geometryRef.type === 'object-mesh-triangle-label'`: il valore `triangleFaceKey` seleziona i triangoli corrispondenti in `objects[].mesh.triangleFaceKeys`.

## Test

Eseguire sempre:

```sh
./tests/run_all.sh
```

Prima di distribuire, rigenerare `SHA256SUMS.txt`, estrarre l’archivio in una directory pulita, verificare i checksum e rieseguire la suite da quella copia.
