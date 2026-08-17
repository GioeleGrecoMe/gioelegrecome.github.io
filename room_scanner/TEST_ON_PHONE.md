# Protocollo di validazione su smartphone

Questo protocollo separa i problemi di tracking, UX, camera/depth, Deep e export. Non cambiare piu' variabili nello stesso test.

## Preparazione

- Usare Chrome Android aggiornato su telefono ARCore.
- Pubblicare la cartella in HTTPS.
- Aprire la pagina top-level, non dentro un iframe durante il primo test.
- Cancellare dati sito e cache della vecchia build.
- Misurare con metro almeno due pareti, altezza e larghezza porta.
- Liberare il percorso; non camminare all'indietro guardando lo schermo.
- Per il primo test scegliere due vani rettangolari collegati da una porta.

Annotare:

- modello telefono;
- versione Android e Chrome;
- presenza badge `DEPTH XR`, `HIT TEST`, `ANCHOR`, `PLANES`;
- memoria libera approssimativa;
- luce, superfici riflettenti e movimento di persone.

## Test A - avvio e lifetime camera XR

1. Premere Avvia scansione.
2. Accettare i permessi.
3. Verificare che compaiano `TRACKING OK` e `RGB XR`.
4. Lasciare attiva la sessione per almeno due minuti.
5. Bloccare e sbloccare brevemente lo schermo solo in un test separato.

Passa se:

- viene richiesta una sola sessione;
- non compare un secondo prompt camera;
- non viene aperta una preview `getUserMedia`;
- la UI resta responsiva;
- una interruzione non permette di continuare falsamente la metrica in una nuova sessione.

## Test B - vano metrico singolo

1. Acquisire quattro angoli in ordine.
2. Chiudere il vano.
3. Misurare il soffitto con il reticolo, poi confermare.
4. Camminare lentamente fino ad almeno sei keyframe.
5. Terminare la scansione senza Deep.
6. Aprire planimetria e scena.
7. Esportare RAW e OBJ.

Registrare per ogni parete:

- lunghezza reale;
- lunghezza esportata;
- errore assoluto e percentuale.

Primo gate di progetto, non ancora prestazione certificata:

- nessuna parete duplicata;
- perimetro non auto-intersecante;
- altezza plausibile;
- errore massimo parete entro 0.10 m o 3%, usando il valore piu' permissivo;
- OBJ apribile e in metri.

## Test C - due vani nella stessa sessione

1. Completare il primo vano.
2. Premere Attraversa passaggio.
3. Camminare attraverso la porta senza terminare XR.
4. Premere Sono nel nuovo vano.
5. Acquisire e completare il secondo vano.
6. Terminare la sessione.

Passa se:

- esiste una sola sessione WebXR dall'inizio alla fine;
- il secondo vano non viene ruotato o traslato da un registratore separato;
- viene creato un solo portale con lato R1 e lato R2;
- la porta resta sulla parete attraversata;
- i vani non mostrano salti metrici evidenti nella planimetria.

Ripetere con porta larga, corridoio stretto e vano non ortogonale con Smart snap disattivato.

## Test D - oggetti multi-vista

Preparare almeno:

- un tavolo o mobile voluminoso;
- una sedia;
- un oggetto sottile;
- una superficie riflettente o trasparente da annotare come caso difficile.

Per ogni oggetto, acquisire viste da almeno tre posizioni separate di circa 0.4 m o piu'. Terminare XR ed eseguire Deep Rapido.

Passa se:

- un oggetto non compare basandosi solo su ripetizioni dalla stessa posizione;
- componenti di vani diversi non vengono fuse;
- gli oggetti principali compaiono come proposte modificabili;
- rimozione, ripristino, hide/show e correzione dimensioni aggiornano planimetria, scena e OBJ.

Non considerare fallimento automatico l'assenza di vetro, specchi, fili o elementi molto sottili; registrarli come limite del sensore/modello.

## Test E - Deep e fallback

### Online

1. Cancellare la cache AI IndexedDB.
2. Eseguire Deep Rapido.
3. Verificare download runtime/modello e completamento del smoke test.
4. Ripetere il processo o ricaricare un RAW per verificare il riuso del modello dalla cache.

### Offline dopo cache

1. Verificare che la shell e il modello siano gia' stati caricati.
2. Attivare modalita' aereo.
3. Riaprire la PWA.
4. Importare il RAW ed eseguire il batch.

Se il runtime remoto non e' disponibile dalla cache HTTP, installare i file locali descritti in `vendor/onnxruntime-web/README.md`.

### Fallback XR-only

Bloccare volutamente CDN/modello e processare. La app deve segnalare Deep non disponibile, mantenere shell, texture, dati XR e oggetti manuali senza perdere il RAW.

## Test F - pressione memoria

Ripetere una scansione con 3-4 vani e profilo Rapido. Osservare:

- chiusure della scheda;
- freeze durante JPEG o ONNX;
- tempi per keyframe e batch;
- numero di frame selezionati;
- dimensione RAW.

Se il telefono e' in difficolta': usare Rapido, ridurre le viste per vano a 5-6, chiudere altre app e non eseguire Deep mentre il dispositivo e' caldo.

## Test G - installazione e offline shell

1. Visitare la root `/room_scan/` online.
2. Verificare il reindirizzamento a `room_scanner_v12.html`.
3. Installare la PWA o ricaricare due volte.
4. Attivare modalita' aereo.
5. Riaprire root e pagina canonica.
6. Verificare che UI, moduli e worker siano disponibili.

## Materiale da conservare per ogni errore

- RAW JSON;
- screenshot della planimetria;
- modello OBJ;
- log diagnostico copiato dalla pagina;
- passaggi esatti;
- modello telefono e versioni software;
- indicazione se la sessione XR e' stata interrotta;
- foto delle misure reali, senza includere persone non consenzienti.
