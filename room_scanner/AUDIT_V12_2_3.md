# Audit V12.2.3

## Cambiamento architetturale

V12.2.3 introduce una fase esplicita di **raffinamento WebXR persistente** fra il perimetro utente e l'acquisizione Deep. Il perimetro è un prior topologico; i surfel XR multi-vista propongono correzioni metriche; Deep completa la coverage e gli oggetti senza poter deformare liberamente la shell.

## Correzioni rilevanti

1. Plane/mesh detection WebXR viene nuovamente elaborata nelle fasi `xr-refine` e `wall-capture`; il vecchio gate `guided.enabled` non sopprime più queste evidenze durante il workflow guidato.
2. I surfel XR accumulano varianza e numero osservazioni con aggiornamento incrementale, evitando una seconda cloud gaussiana duplicata.
3. La correzione di una parete deriva da una popolazione multi-vista estesa, non dal singolo punto/click.
4. Gli shift parete sono limitati e gli angoli vengono ricalcolati per intersezione delle linee corrette: il footprint resta chiuso.
5. La correzione WebXR richiede una seconda verifica utente prima della fotografia delle pareti.
6. La coverage per parete è spaziale, non un semplice numero di fotografie.
7. Più foto parziali possono contribuire alla stessa parete e la coverage Deep è calcolata solo sui campioni realmente validati.
8. Il fit Deep usa depth XR same-view, anchor gaussiani persistenti e solo in ultima istanza la shell analitica.
9. I punti Deep attribuiti alla struttura sono proiettati sul piano globale; non possono creare pareti duplicate inclinate.
10. Gli oggetti restano residui interni persistenti, con OBB e cloud RGB, separati dalla ROOM_SHELL.

## Controlli statici

La suite controlla inoltre:

- assenza di `getUserMedia` e `ImageCapture`;
- singola `requestSession()` WebXR;
- nessun keyframe automatico;
- IDs DOM unici e riferimenti validi;
- listener diretti non duplicati;
- assenza di regressioni nei pulsanti guidati e nel viewer ortografico.

## Rischi residui

- La qualità della correzione del footprint dipende dalla disponibilità di depth/mesh XR persistenti. Se il runtime restituisce poca evidenza su una parete uniforme, la correzione deve restare conservativa e l'utente può mantenere/modificare il perimetro manuale.
- Il clustering di una faccia di mobile quasi estesa quanto una parete rimane un caso ambiguo; il ranking usa frontiera, estensione e persistenza, ma la verifica top-down dell'utente resta l'ultimo vincolo.
- La coverage Deep misura evidenza geometrica validata, non riconoscimento semantico perfetto di finestre/specchi.
- Raw Camera/Depth/Plane/Mesh WebXR sono runtime/device-dependent e richiedono test fisici.
