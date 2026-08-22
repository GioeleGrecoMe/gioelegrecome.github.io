# TEST SU TELEFONO — V30.49

## 1. Deploy
Applica la patch sopra V30.47 e pubblica. Esegui una sola volta `Reset cache`/ricarica atomica e verifica che il badge sia `V30.49.0`.

## 2. Durante Scan
Muovi il telefono normalmente, fermandoti brevemente sulle zone importanti e mantenendo overlap.

Atteso:
- Alva continua senza aspettare Deep;
- `deepInferenceDuringScan=false`;
- `deepLiveState` mostra `FOTO NITIDE N · X MB compressi · Deep dopo Fine`;
- il numero N cresce rapidamente quando il telefono è fermo;
- in diagnostica `photoArchive.accepted` cresce;
- `photoArchive.backpressureDropped` dovrebbe essere piccolo rispetto ad `accepted`.

## 3. Premi Fine
Deve aprirsi la nuova schermata `RGB + AlvaAR + DeepPrior`, non saltare direttamente a REVIEW.

### Fase RGB
Vedi scorrere le fotografie archiviate. Controlla:
- foto nitide;
- nessun frame palesemente mosso;
- percorso Alva continuo nella vista X-Z;
- eventuale marker arancio solo quando esiste un salto realmente sospetto.

### Fase DeepPrior
Per ogni foto selezionata vedi:
- RGB originale;
- mappa Depth Anything dello stesso frame;
- punti azzurri del DeepPrior relativo proiettati dai raggi della camera Alva;
- marker viola della posa RGB ottimizzata, quando disponibile.

La nuvola Deep è deliberatamente relativa/normalizzata: serve a vedere inversioni, frame sbagliati, rotazioni errate e salti di posa, non a giudicare ancora la scala metrica.

Segnala se osservi:
- una Depth appartenente chiaramente a una foto diversa;
- inversione davanti/dietro;
- improvviso salto del prior mentre l'RGB è continuo;
- marker Alva arancio ripetuti in una zona in cui il telefono era stabile;
- marker viola sistematicamente molto lontano da Alva.

### Fase MVS
La stessa schermata mostra il frame di riferimento MVS mentre la geometria viene rivalutata sulle pose finali.

## 4. REVIEW
Le Gaussiane poco affidabili devono essere molto meno visibili. Non confrontare il numero visualizzato con il numero totale: il solver conserva anche l'evidenza nascosta.

Una mesh con molte isole/componenti non deve essere promossa solo perché contiene molte facce.

## 5. Diagnostica da inviarmi
Esporta il JSON dopo REVIEW. I campi/eventi più utili sono:
- `photoArchive.accepted/rejected/backpressureDropped/bytes`
- `processing.photos/rgbImported/deepAccepted/poseJumps`
- `processing-photo-dataset`
- `processing-rgb-import-complete`
- `postscan-rgb-scaffold`
- `processing-deep-prior-visible`
- `processing-deep-complete`
- `mvs-postscan-drain-complete`
- `surface.display`
- `surface.geometryPolicy`
- `surface.mvsValidation`
