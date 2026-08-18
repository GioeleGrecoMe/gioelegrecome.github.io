# Room Scanner V20.0.0 — RGB Acoustic Twin

## Obiettivo

V20 costruisce su smartphone un modello metrico leggero di più vani collegati, nello stesso riferimento `local-floor` WebXR. Il modello contiene:

- perimetri, altezze, pareti, pavimenti, soffitti e passaggi;
- fotografie sincronizzate con posa, proiezione e depth WebXR;
- oggetti come nuvole di punti RGB, superficie voxel approssimata e OBB editabile;
- una superficie acustica indipendente per pavimento, soffitto, ogni parete e ciascuna delle sei facce proxy di ogni oggetto;
- coefficienti di assorbimento per 125, 250, 500, 1000, 2000, 4000 e 8000 Hz, più scattering;
- export RAW, acustico JSON/CSV, PLY colorato e OBJ con colori per vertice quando supportati.

L’app è una pagina statica, senza backend obbligatorio. Deep Anything viene eseguito in un Web Worker soltanto dopo la chiusura di WebXR.

## Procedura utente

1. Aprire la pagina in Chrome Android su un dispositivo ARCore e avviare WebXR.
2. Inquadrare e aggiungere gli spigoli pavimento-parete del vano.
3. Premere esplicitamente **Chiudi vano**. La vicinanza al primo punto non chiude mai automaticamente il perimetro.
4. Confermare il raccordo parete-soffitto oppure impostare l’altezza.
5. Seguire le caselle proiettate sulle pareti:
   - rosso: nessuna vista utilizzabile;
   - giallo: prima vista acquisita, serve una posizione differente;
   - verde: requisito soddisfatto.
6. Attraversare un passaggio senza chiudere la sessione WebXR e acquisire il vano successivo.
7. Terminare l’acquisizione. V20 salva, libera WebXR e ricarica la pagina in modo controllato.
8. Dalla revisione, eseguire facoltativamente Deep, correggere oggetti e materiali, quindi esportare.

Le caselle sono una guida qualitativa. Per chiudere un vano bastano almeno tre fotografie da almeno due posizioni; caselle residue non bloccano il flusso.

## Geometria senza limite pratico sugli spigoli

Sono stati rimossi i limiti utente sulla distanza tra angoli e sulla lunghezza delle pareti. Nicchie, pilastri, rientranze e piccoli ritorni possono essere rappresentati.

Resta soltanto un epsilon numerico di `1e-5 m` nel nucleo geometrico per evitare un vettore esattamente nullo. L’interfaccia usa lo stesso epsilon di `1e-5 m` esclusivamente per impedire l’inserimento di due punti numericamente coincidenti. Non esiste più:

- chiusura automatica avvicinandosi al primo angolo;
- soglia minima di 20 cm o 5 cm per un nuovo lato;
- soglia fissa di area immagine che rende impossibile fotografare una parete molto stretta.

I target fotografici di pareti corte riducono dinamicamente margine, area di riferimento e distanza minima di acquisizione.

## Uscita sicura da WebXR

Il passaggio diretto da ARCore/Raw Camera/WebGL a ONNX era il punto più fragile sui telefoni. V20 usa una barriera deterministica:

1. sospende nuovi scatti;
2. attende o annulla in modo controllato lo scatto in corso;
3. termina la sessione WebXR una sola volta, senza clonare fotografie o geometria mentre ARCore è ancora attivo;
4. nell’evento `end` cancella hit-test, anchor, camera reader e riferimenti depth;
5. invoca `WEBGL_lose_context`, riduce il canvas AR a 1×1 e annulla i buffer RGBA/depth decodificati;
6. salva ogni JPEG in un record IndexedDB separato, quindi salva un checkpoint leggero che contiene soltanto metadati e riferimenti alle foto;
7. scrive un marker temporaneo in `sessionStorage`;
8. ricarica la stessa pagina;
9. ripristina checkpoint e fotografie e abilita soltanto allora il processing.

Se IndexedDB o `sessionStorage` non sono disponibili, l’app non scarta i dati in memoria: resta nella revisione e invita a esportare RAW.

### Riduzione della memoria nel processing

- Le immagini vengono decodificate una alla volta o in piccoli gruppi.
- Ogni parete viene texturizzata separatamente; i buffer RGBA vengono liberati subito dopo.
- I JPEG dei keyframe sono record IndexedDB indipendenti; il checkpoint principale non li clona in un unico oggetto.
- Il checkpoint limita evidenza voxel e punti densi e non incorpora le texture di parete rigenerabili.
- Il modello ONNX non viene caricato finché `postXrReady` non è vero.
- Il worker viene terminato prima di una nuova sessione WebXR.

## Oggetti RGB e forma approssimativa

Un oggetto rilevato conserva tre rappresentazioni complementari:

1. **Punti RGB:** centri voxel colorati con i pixel delle fotografie che hanno prodotto l’evidenza.
2. **Superficie voxel RGB:** sole facce esterne dei voxel occupati, con colore per vertice.
3. **OBB editabile:** ingombro orientato, utile come proxy stabile per editing, export e simulazione.

Ogni triangolo esterno della mesh voxel riceve inoltre una delle etichette acustiche `bottom/top/front/back/right/left`. Le sei superfici editabili dell’oggetto sono quindi una partizione leggera della mesh RGB, non sei elementi scollegati: l’export conserva `triangleFaceKeys` e il riferimento `geometryRef` di ciascuna superficie.

Il viewer può mostrare contemporaneamente punti, superficie voxel RGB e OBB. La densità visualizzata è limitata a 6000 punti per oggetto, senza eliminare i punti dal RAW esplicito.

Gli oggetti manuali non fingono di essere misurati: ricevono una shell di punti RGB sintetici marcati `synthetic: true`, così l’ingombro è comunque visibile. Se l’utente modifica dimensioni o orientamento di un oggetto, i punti vengono trasformati nelle coordinate normalizzate del nuovo OBB invece di restare nella vecchia posizione.

### Export oggetti

- **PLY:** punti RGB, `object_id` e flag `synthetic`.
- **OBJ:** mesh di stanze e oggetti; per gli oggetti viene usata l’estensione de facto `v x y z r g b` con RGB normalizzato.
- **RAW JSON:** conserva punti, mesh, colori per vertice, etichette acustiche per triangolo, OBB, riepilogo RGB, volume occupato, volume OBB e fill ratio.

## Superfici acustiche

Il modello dati è centrato sulle superfici, non sul solo vano:

- `R#:floor`;
- `R#:ceiling`;
- `R#:wall:#` per ogni parete;
- `O#:face:bottom/top/front/back/right/left` per ogni oggetto attivo.

Le aperture vengono sottratte dall’area netta della parete e conservate anche come metadati. Per gli oggetti la superficie acustica è una proxy OBB sopra i voxel RGB; il RAW mantiene la geometria più dettagliata per futuri metodi di simulazione.

### Prior automatico e modifiche manuali

Il sorgente V10 non era incluso negli archivi V14/V15 disponibili in questa sessione. V20 ricostruisce quindi in modo esplicito una logica V10-style compatibile con il comportamento richiesto, basata su:

- libreria di materiali;
- coefficienti per banda;
- prior differenziato per parete, pavimento, soffitto e oggetto;
- caratteristiche visive leggere: luminanza, contrasto, saturazione, highlight, texture e tonalità calda;
- classificazione conservativa con confidenza massima `0.28`.

Il materiale automatico è sempre marcato come `visual-prior-v10` o `role-prior-v10`. Non è una misura RIR e non deve essere usato come verità sperimentale. L’utente può impostare materiale, sette coefficienti di assorbimento e scattering e applicarli alla singola superficie, a tutte le pareti del vano, alle sei facce dell’oggetto oppure alle superfici visivamente simili. Una modifica manuale ha confidenza 1 e sopravvive a ricostruzione, checkpoint, import e nuovo calcolo dei prior.

Il riepilogo Sabine mostrato nell’interfaccia è soltanto diagnostico e porta il flag `visual-prior-not-measured`.

## Compatibilità e import

V20 usa lo schema RAW `room-scanner-v20-raw` e può importare `room-scanner-v15-raw`. Durante la migrazione:

- ricostruisce le caselle mancanti;
- converte depth grid e mask in typed array;
- aggiunge metadati RGB/shape agli oggetti legacy;
- genera le superfici acustiche;
- mantiene perimetri, fotografie, porte e modifiche oggetto esistenti.

Una scansione WebXR terminata non può essere estesa in un nuovo `local-floor` fingendo continuità metrica. Va esportata o processata come sessione chiusa.

## Deploy

Pubblicare nella root HTTPS tutti i file di questa cartella. L’entry point canonico resta:

```text
room_scanner_v12.html
```

La root `index.html` reindirizza mantenendo query e hash. Gli asset eseguibili sono versionati:

```text
roomscan_core_v20_0_0.js
roomscan_app_v20_0_0.js
depth_ai_worker_v20_0_0.js
sw_v20_0_0.js
```

Gli alias senza versione contengono gli stessi byte per compatibilità e test.

Dopo un aggiornamento da V15 è consigliato cancellare una volta i dati del sito oppure disinstallare la vecchia PWA, quindi aprire online la V20. Il service worker V20 usa network-first per HTML, JavaScript, worker, manifest e build info. Soltanto le navigazioni possono ripiegare sull’HTML della shell: una richiesta JavaScript mancante non riceve mai HTML, evitando il tipico errore “HTML caricato come JS” durante il reload post-XR.

## Deep locale opzionale

Il pacchetto non include il runtime o il modello. Per un deploy interamente locale inserire:

```text
vendor/onnxruntime-web/ort.min.js
vendor/onnxruntime-web/<file WASM/MJS della stessa release>
models/depth_anything_v2_small_q4.onnx
```

Il worker tenta prima i file locali, poi le sorgenti remote configurate. I byte del modello vengono memorizzati in IndexedDB. La scansione geometrica, l’editing, gli oggetti manuali e gli export restano utilizzabili anche senza Deep.

## Limiti dichiarati

- Raw Camera Access e WebXR Depth dipendono da Chrome/ARCore e dal singolo dispositivo.
- La forma degli oggetti è sparsa e approssimata; non è una scansione fotogrammetrica watertight.
- I materiali automatici sono prior visivi, non assorbimento misurato.
- Il test automatico non sostituisce una prova fisica su telefono per memoria, temperatura, tracking e comportamento del compositor XR.

Seguire `TEST_ON_PHONE.md` prima di usare la V20 in una campagna di misura.
