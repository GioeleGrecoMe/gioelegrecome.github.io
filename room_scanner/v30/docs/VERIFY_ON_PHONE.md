# Verifica V30.10 sul telefono

## Build

Deve comparire `V30.10.0`. Nel self-test devono comparire almeno:

- PASS indexeddb
- PASS world-anchor-source
- PASS manual-roi-contract
- PASS measurement-guidance
- PASS unhandled-rejection-regression
- PASS unhandled-rejections
- PASS service-worker-file
- PASS build-info-fresh

Se `unhandled-rejections` fallisce, il messaggio ora contiene il nome/motivo reale della Promise rifiutata. Scaricare il log diagnostico senza ricaricare la pagina.

## Pin WebXR

1. Aprire calibrazione.
2. Toccare una posizione fisica scelta manualmente.
3. Deve comparire il reticolo con profondita in metri, XYZ e `stabilita OK`.
4. Premere `Conferma pin`.
5. Muovere il telefono lateralmente e leggermente in altezza attorno alla zona.
6. Osservare `P1: N/8 viste - S/4 settori` aumentare.
7. Ripetere per almeno 3 pin, ben separati e non allineati.
8. Verificare che i cerchi restino world-locked durante il movimento.
9. Portare almeno 3 pin contemporaneamente in vista e acquisire almeno 3 pose diverse.

## Scelta dei pin

Preferire dettagli fissi con texture/bordi: angoli di quadri, prese, intersezioni geometriche, spigoli di mobili immobili. Evitare superfici lucide, schermi, tende, persone e grandi pareti uniformi.

Distribuire i pin sia orizzontalmente sia verticalmente. Una buona configurazione occupa una porzione ampia del campo visivo e non mette tutti i pin sulla stessa linea.

## Misura

All'ingresso nel bridge devono comparire aree P1/P2/P3... sopra la camera. Partire dalla vista comune finale salvata durante la calibrazione. Portare almeno tre aree nella posizione prevista e poi fare una piccola traslazione, non solo una rotazione sul posto.

Controllare `template`, `inlier` e `RMSE`. La ricostruzione deve proseguire soltanto quando il bridge ha agganciato la metrica.

## GS / mesh

Durante la scansione l'HUD aggiuntivo deve indicare se il Gaussian worker e' stato visto e, quando il payload e' riconosciuto, numero GS, campioni superficie e bbox in metri.

In Review il pulsante `Crea mesh metrica GS` e' abilitato logicamente solo dopo un aggancio metrico valido. La mesh esportata e' una mesh voxel diagnostica: serve a verificare scala, orientamento e copertura prima di introdurre un mesher piu' raffinato.
