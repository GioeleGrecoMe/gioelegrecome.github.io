# Analisi dei rami V10, V11 e V12

## V10: cosa funzionava

Il ramo V10 aveva gia una buona separazione concettuale tra acquisizione e analisi:

- WebXR forniva traiettoria e scala;
- il microfono veniva registrato in continuita;
- i chirp erano brevi e associati a pose;
- il lag veniva stimato per misura;
- deconvoluzione e fitting avvenivano dopo.

Il principale limite geometrico era l'accumulo di punti non sufficientemente vincolato. Errori di depth, multipath visivo, pixel sul bordo e tracking jitter creavano pareti spesse e cloud difficili da trasformare in superfici affidabili.

## V11: cosa insegnavano i test separati

V11 mostrava che Raw Camera, XR Depth, audio e processing neurale devono essere verificati separatamente. Una pipeline apparentemente unica maschera facilmente:

- incompatibilita di feature WebXR;
- perdita del frame di validita della camera;
- pressione di memoria al passaggio XR -> ONNX;
- elaborazioni microfoniche non disabilitate;
- checkpoint non clonabili.

V20.1 conserva moduli e test separati e fallisce localmente senza buttare il resto della scansione.

## V12: cosa funzionava e cosa si perdeva

V12 introduceva una shell strutturale piu pulita, aperture e vincoli semplici. Il difetto era rendere la shell troppo autoritativa: una stanza pulita ma eccessivamente semplificata non conserva abbastanza informazione su scala, traiettoria, oggetti e superfici locali.

V20.1 usa il poligono V12 come topologia, non come sostituto del sensing:

- WebXR resta autorita metrica;
- XR Depth e Deep calibrato producono surfel;
- il fit puo solo correggere localmente;
- i residui diventano Gaussiane o oggetti, non rumore eliminato indiscriminatamente.

## Errori concreti corretti rispetto alle prime V20

### `DataCloneError` durante l'uscita

La mappa temporale audio conteneva funzioni e il checkpoint provava a clonarle. Ora contiene soltanto numeri e array semplici.

### Corner con metadati trattati come array

I vertici del vano erano record oggetto, ma il serializer usava spread da array. La chiusura XR poteva fallire prima del processing. Ora esistono `serializeCornerRecord` e `restoreCornerRecord`.

### Descrittore ESS incoerente

Il generatore restituisce un record con il vettore in `.samples`; il controller lo trattava come `Float32Array`. Il contratto e ora unico e testato dopo salvataggio/ripristino.

### Picco piu forte scambiato per diretto

In una stanza il riflesso puo essere piu forte del diretto. Ora si cerca il primo picco locale significativo nella finestra compatibile con la distanza geometrica, non il massimo assoluto.

### Classe non assegnata numericamente dominante

Il prior `unassigned` era su una scala diversa dalle likelihood geometriche e poteva vincere sempre. Ora condivide la stessa scala e resta una vera alternativa, non un veto.

### Reload post-XR

Il reload forzato aumentava il rischio di cache miste e perdita di stato. V20.1 rilascia XR, persiste i record e apre la revisione nello stesso documento.

## Criterio finale

La V20.1 non sceglie tra la nuvola rumorosa V10 e la scatola pulita V12. Usa tre livelli:

1. topologia esplicita e comprensibile all'utente;
2. metrica WebXR + surfel bounded per il dettaglio osservato;
3. inferenza probabilistica che conserva l'incertezza invece di forzare ogni punto o eco nel modello.
