# Audit V12.2.2

## Regressione acquisizione trovata

`onXRFrame()` invocava `updateGuidedAimAndOverlay(view)` ma V12.2.1 non conteneva più la definizione della funzione.

Conseguenze:

- `ReferenceError` nel loop XR;
- nessun aggiornamento di `guided.currentAim`;
- bottone `guidedPrimary` disabilitato per la condizione `!G.currentAim`;
- impossibilità di aggiungere il primo spigolo.

## Fix

La funzione è stata reintrodotta con responsabilità limitate:

- snapshot delle matrici `XRView`;
- ray/floor intersection;
- aggiornamento reticolo;
- wall-view guidance;
- redraw overlay;
- refresh HUD throttled.

Nessuna inferenza Deep o lavoro strutturale pesante è stato reintrodotto nel loop XR.

## Regressione automatica

Il runtime test usa una camera sintetica a 1.5 m inclinata di 45 gradi verso il pavimento. Richiede:

- `currentAim` valido;
- coordinata Y esattamente sul `local-floor`;
- `guidedPrimary.disabled === false`.

## Object manager

Gli oggetti non strutturali sono componenti voxel persistenti rappresentate da:

- OBB PCA orientato XZ;
- point cloud RGB limitata per il viewer;
- indice completo delle celle voxel per remove/export.

`Stanza nuda` è visual-only; `Rimuovi` è model-level e influenza PLY/OBJ.

## Limiti intenzionali

La V12.2.2 non tenta una mesh dettagliata automatica degli arredi. Gli OBB sono proxy di gestione; la geometria dettagliata resta nella point cloud RGB per evitare costo e solidificazione del rumore monoculare.
