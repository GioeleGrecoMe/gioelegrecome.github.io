# V30.10.1 - manual pin ROI + metric measurement pipeline

## 1. Unhandled Promise rejection

`XRMetricCalibrator.pinNearestCandidate()` non usa piu' eccezioni per errori normali di interazione. Il tap imposta solo il reticolo. Errori di hit-test/posizionamento sono convertiti in `pin-rejected` gestiti dalla UI. Il self-test ora riporta anche nome, messaggio e stack delle rejection globali osservate dal bootstrap.

## 2. Posizionamento pin scelto dall'utente

Il vecchio flusso basato sui candidati automatici e' sostituito nell'interfaccia da:

1. tap sulla posizione desiderata;
2. hit-test WebXR live;
3. visualizzazione profondita, coordinate metriche XYZ e RMS di stabilita;
4. conferma esplicita;
5. creazione di una griglia locale fino a 9 hit-test/anchor attorno al punto scelto.

Il pin continua a valere solo quando gli `XRAnchor` sono presenti in `frame.trackedAnchors` e la posa e' letta da `anchor.anchorSpace` nel frame attivo.

## 3. Atlante ROI multi-view

Per ogni pin vengono acquisiti automaticamente:

- fino a 24 viste;
- tre scale della ROI;
- posa camera metrica;
- profondita del pin;
- settore azimut/elevazione;
- patch grayscale e statistiche di dettaglio.

In parallelo i template per ogni anchor passano da 6 a 12 e le viste anchor da 7 a 16, mantenendo compatibilita con il matcher/PnP V30 esistente.

## 4. Schermata misura / bridge

La schermata camera mostra le aree P1, P2, P3... nella posizione normalizzata della vista comune salvata, con profondita e numero di viste ROI. Le istruzioni dipendono da template trovati, inlier e RMSE.

Viene esposto `window.RoomScanMetricContext` con calibrazione, unita in metri, intrinseci normalizzati, common pose e aree pin.

## 5. GS metriche -> dati mesh

`gaussian_metric_tap.js` osserva il Gaussian worker senza alterarne i messaggi. Quando riconosce uno snapshot calcola:

- numero GS;
- bounding box metrico;
- diagonale;
- campioni superficiali filtrati per opacita.

`metric_mesh_worker.js` puo' trasformare i campioni in una mesh voxel diagnostica PLY in metri. La UI rifiuta il meshing se lo stato camera metrica non risulta agganciato.

## Limite noto

L'osservatore Gaussian e' volutamente tollerante perche' in questa sessione `gaussian_worker.js` originale non era scaricabile dal repository. Se il payload reale usa un formato diverso da `gaussians`, `positions`, `points`, `splats`, `snapshot`, `data` o `payload`, la diagnostica mostrera' le chiavi ricevute e il parser andra' adattato al formato reale. Non viene inventata una conversione quando il payload non e' riconosciuto.
