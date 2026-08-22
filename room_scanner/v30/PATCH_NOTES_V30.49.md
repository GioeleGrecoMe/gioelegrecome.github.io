# Room Scanner V30.49 — Sharp RGB archive + visual DeepPrior post-processing

Build: `v30.49.0-20260822-sharp-rgb-visual-postprocess`

## Obiettivo
V30.49 sposta la raccolta dati verso un modello più utile per la ricostruzione finale: durante Scan il telefono conserva quante più fotografie RGB nitide e stabili possibile senza far dipendere Alva/RGB da Deep o MVS; dopo `Fine` mostra una fase di processing esplicita in cui RGB, posa Alva, DeepPrior relativo e posa RGB ottimizzata sono visibili e diagnosticabili prima della fusione.

## Acquisizione foto nitide
- Ogni frame camera Alva-valido viene valutato per dettaglio/blur e velocità traslazionale/angolare.
- Intervallo minimo: 110 ms (alla camera analitica da 8 fps equivale, quando il telefono è fermo, a tentare praticamente ogni frame).
- JPEG in `photo_archive_worker.js` tramite `OffscreenCanvas.convertToBlob()`: compressione fuori dal main thread.
- Backpressure esplicita: massimo 4 compressioni pendenti; eventuali drop sono contati in `photoArchive.backpressureDropped`.
- Budget archivio: fino a 1600 fotografie o ~350 MB compressi.
- I Blob compressi vengono persistiti in IndexedDB `events` e restano referenziati in RAM in forma compressa fino al processing; non viene eseguito un `getAll()` massivo sul normale percorso fine-scansione.
- Il vecchio `StablePhotoBank` raw è disattivato per non sprecare ~100 MB in copie RGBA non compresse.

## Schermata POST-PROCESSING
Nuova screen `processing` con tre viste sincronizzate:
1. RGB esatto archiviato.
2. DeepPrior relativo sullo stesso frame.
3. Vista X-Z: traiettoria/posa Alva, DeepPrior normalizzato proiettato sui raggi camera e posa RGB ottimizzata.

Legenda:
- azzurro: Alva + DeepPrior relativo diagnostico;
- viola: posa RGB ottimizzata;
- arancio: salto Alva sospetto.

La nuvola Deep mostrata non viene dichiarata metrica: la profondità raw viene normalizzata per il solo controllo visivo di orientamento/continuità. La calibrazione metrica resta responsabilità del `ProbabilisticJointOptimizer`.

## Pipeline finale
`Fine` ora esegue:
1. freeze camera + Alva;
2. flush archivio JPEG;
3. selezione fino a 240 fotografie nitide distribuite lungo tutta la scansione;
4. registrazione di quelle esatte foto come `depthPlanned` nel photo/factor graph;
5. solve/reconcile RGB + prior Alva;
6. visualizzazione della posa RGB ottimizzata;
7. completamento dei pochi Deep già pianificati in Scan;
8. Deep sequenziale su tutte le fotografie archiviate selezionate, stesso `frameId` e stesso raster;
9. MVS post-scan su pose finali;
10. fusione/persistenza e REVIEW.

La coda Deep archivio viene alimentata un frame alla volta, evitando di tenere centinaia di RGBA decompressi contemporaneamente.

## Salti Alva
Un frame archiviato con salto rapido eccessivo viene:
- evidenziato in arancio nella schermata di processing;
- loggato;
- mantenuto come evidenza RGB/Deep utile;
- inserito con covarianza Alva inflazionata, quindi non può diventare silenziosamente un prior metrico forte.

## Gaussiane e mesh — include le protezioni V30.48
- Gaussiane a bassa confidenza vengono nascoste dalla visualizzazione, non cancellate dal solver.
- Soglie display: REVIEW 0.40, candidate 0.46, live 0.38 (evidenza forte può ricevere una protezione limitata).
- TSDF usa un filtro più severo e non riceve splat deboli/non verificati.
- MVS legacy-only non può autorizzare una geometria committed.
- Mesh fortemente frammentate vengono respinte e non mostrate come superficie valida.

## Diagnostica nuova/utile
- `sharp-photo-archived`
- `sharp-photo-archive-compress`
- `sharp-photo-archive-store`
- `processing-photo-dataset`
- `processing-rgb-import-complete`
- `processing-rgb-pose-map`
- `processing-deep-start`
- `processing-deep-prior-visible`
- `processing-deep-timeout`
- `processing-deep-complete`
- `mvs-postscan-*`
- `surface-display-filter`

Il context diagnostico espone inoltre `photoArchive` e `processing` con conteggi, byte, drop, foto importate, Deep processati e salti Alva.
