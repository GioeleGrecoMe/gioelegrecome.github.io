# Validazione fisica V20.1.0 su smartphone

Queste prove richiedono Chrome Android, HTTPS e un dispositivo ARCore reale. Prima della prima prova cancellare i dati del sito della release precedente.

## 1. Build e cache

Verificare nella landing:

```text
V20.1.0 · METRIC + RIR + RGB SURFELS
```

Aprire `build_info.json` e controllare:

```text
v20.1.0-metric-rir-twin-20260818
```

Ricaricare due volte online, poi verificare che HTML e moduli mostrino sempre la stessa versione.

## 2. Preparazione microfono

1. Selezionare **Telefono: speaker + microfono**.
2. Premere **Prepara microfono e chirp**.
3. Parlare e verificare il meter.
4. Controllare che l'interfaccia mostri 48 kHz o il sample rate effettivo.
5. Controllare l'indicazione relativa a echo cancellation, noise suppression e AGC.
6. Ripetere con cuffie/dispositivo Bluetooth solo come prova di compatibilita, non come misura di riferimento.

Esito atteso: nessun avvio WebXR finche audio e attivo ma non pronto; disattivando RIR la geometria puo partire.

## 3. ESS e clipping

1. In un ambiente silenzioso avviare una breve scansione.
2. Restare stabili e attendere il flash/suono chirp.
3. Verificare che il contatore RIR aumenti dopo la coda.
4. Avvicinare e allontanare il telefono dalla parete senza coprire speaker o microfono.
5. Nel RAW controllare meter, clipping e impostazioni track.

Esito atteso: nessun campione saturato in modo sistematico; almeno una finestra RIR valida.

## 4. Sorgente esterna fissa

1. Collegare un altoparlante con routing noto.
2. Selezionare **Altoparlante esterno fisso**.
3. In AR mirare al centro acustico approssimativo e premere **Segna sorgente**.
4. Camminare in almeno quattro posizioni distinte.

Esito atteso: la sorgente resta fissa nel viewer; ogni manifest usa la stessa posizione sorgente e una posizione ricevitore diversa.

## 5. Tracking e scala

1. Misurare con metro una parete e una porta.
2. Acquisire il vano senza movimenti bruschi.
3. Tornare vicino al punto iniziale prima di chiudere.
4. Confrontare le dimensioni nel viewer/export.
5. Ripetere includendo un corridoio e tornando nel primo vano.

Registrare errore assoluto e percentuale. Esito atteso: nessun reset o riallineamento libero tra vani; il loop non deve creare una seconda copia della stanza.

## 6. Spigoli ravvicinati

1. Inserire una nicchia o un pilastro con lati molto corti.
2. Aggiungere due corner distanti pochi centimetri.
3. Avvicinarsi al primo corner senza chiudere.
4. Premere esplicitamente **Chiudi vano**.

Esito atteso: nessun messaggio di muro troppo corto e nessuna chiusura automatica. Solo due punti numericamente coincidenti possono essere rifiutati.

## 7. Caselle e keyframe

1. Inquadrare una casella rossa.
2. Verificare che diventi gialla dopo una vista valida.
3. Spostarsi lateralmente di circa 0.5 m e riprenderla.
4. Verificare il passaggio a verde.
5. Inquadrare contemporaneamente piu caselle.
6. Lasciarne una occlusa e completare il vano con almeno tre foto e due posizioni.

Esito atteso: le frecce indicano una superficie fisica; una foto puo aggiornare piu target; una casella impossibile non blocca la chiusura.

## 8. Sweep solo da pose distinte

1. Restare fermi dopo una misura.
2. Verificare che non partano sweep continui dalla stessa posa.
3. Traslare di circa 0.45 m oppure ruotare di oltre 35 gradi.
4. Restare stabili.

Esito atteso: parte una nuova misura. Nel RAW le pose devono essere distinte e associate al vano corretto.

## 9. Uscita WebXR durante una misura

1. Attendere l'inizio di un chirp.
2. Premere **Salva e chiudi** o usare Indietro durante la coda.
3. Verificare che nuovi sweep siano bloccati.
4. Verificare che la pagina non si ricarichi.
5. Attendere la revisione nello stesso documento.
6. Controllare che vani, foto, pose e manifest RIR siano presenti.
7. Premere processing.

Esito atteso: nessuna pagina bianca, nessun crash tab, nessun `DataCloneError`, nessun modello ONNX avviato prima dell'evento XR `end`.

## 10. Stress handoff e memoria

1. Acquisire 3 vani, 20-30 keyframe e 20-30 RIR.
2. Chiudere WebXR.
3. Attendere 10 secondi nella revisione senza processing.
4. Aprire diagnostica e controllare il conteggio record.
5. Avviare il profilo processing piu leggero.
6. Monitorare temperatura e riavvii del tab.

Esito atteso: JPEG e PCM vengono letti a piccoli gruppi; il browser non chiude la pagina. Un errore Deep lascia esportabili geometria e RIR.

## 11. Delay ignoto

1. Ripetere la stessa geometria con speaker del telefono e con sorgente esterna.
2. Confrontare `hardwareLatencyResidual` e il delay dei picchi relativi al diretto.
3. Se possibile introdurre una catena Bluetooth come stress test.

Esito atteso: il lag assoluto puo cambiare molto, ma i delay degli echi rispetto al diretto devono restare coerenti. Misure con jitter elevato devono avere confidenza inferiore.

## 12. Parete nota

1. Scegliere un vano rettangolare semplice.
2. Posizionare sorgente e ricevitore in punti misurabili.
3. Calcolare a mano la lunghezza del primo cammino speculare di una parete.
4. Confrontare il delay relativo previsto con un picco RIR.
5. Aprire la mappa alpha/RIR e verificare la zona associata.

Esito atteso: il posterior della parete fisicamente compatibile supera alternative lontane; un picco non compatibile puo restare `unassigned`.

## 13. Materiali contrastanti

1. Acquisire una parete riflettente e una zona coperta da tenda/pannello.
2. Ottenere misure da almeno quattro pose.
3. Processare e confrontare supporto e alpha per banda.
4. Ripetere cambiando posizione della sorgente.

Esito atteso: la zona assorbente tende ad avere alpha maggiore nelle bande supportate, ma la UI deve mostrare confidenza e non una classificazione certa. Registrare differenze, non solo il valore assoluto.

## 14. Oggetti RGB

1. Fotografare un mobile da almeno due lati.
2. Attivare punti RGB, forma voxel, OBB e Gaussiane.
3. Controllare riconoscibilita e ingombro.
4. Modificare OBB, nascondere, eliminare e ripristinare.
5. Esportare PLY e OBJ.

Esito atteso: punti e mesh seguono l'editing; nessun punto fantasma; le sei facce acustiche riferiscono i triangoli corretti.

## 15. Override acustici

1. Selezionare una superficie inferita.
2. Applicare coefficienti manuali, incluso `0.00`.
3. Applicare a singola zona, gruppo o superfici simili.
4. Salvare checkpoint, ricaricare e importare RAW.
5. Ripetere il processing.

Esito atteso: il valore manuale resta autorevole e non viene sovrascritto dall'inferenza.

## 16. Offline

1. Caricare la shell online una volta.
2. Chiudere il browser e attivare modalita aereo.
3. Riaprire la PWA e verificare editing, RIR processing ed export.
4. Senza runtime/modello locale, Deep puo fallire senza perdita dati.
5. Installare i file locali documentati e ripetere Deep offline.

## Dati da allegare a un bug

- modello telefono, Android, Chrome e ARCore;
- build/revisione;
- modalita sorgente e routing audio;
- track settings effettivi;
- numero di vani, keyframe, surfel e RIR;
- fase esatta e ultimo evento diagnostico;
- disponibilita Raw Camera/XR Depth;
- memoria/temperatura percepita;
- RAW JSON e Acoustic JSON, senza PCM se i dati sono sensibili;
- screenshot della mappa e ID della zona errata.
