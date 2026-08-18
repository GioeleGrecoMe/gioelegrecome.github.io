# Room Scanner V20.1.0 - Metric RIR Twin

## Obiettivo

V20.1 costruisce sul telefono un modello metrico leggero di piu vani collegati e registra, nelle stesse pose WebXR, brevi sweep ESS con una finestra PCM continua. Dopo la chiusura di WebXR produce:

- shell strutturale vincolata: pavimenti, soffitti, pareti, aperture e collegamenti;
- traiettoria metrica nello stesso riferimento `local-floor` per tutta la sessione;
- mappa surfel RGB limitata in memoria, alimentata da XR Depth e keyframe camera;
- depth monoculare post-XR calibrata metricamente per keyframe;
- patch Gaussiane locali che descrivono dettagli non rappresentati dalla shell;
- oggetti come punti RGB, superficie voxel RGB e OBB editabile;
- RIR relative al cammino diretto, con ritardo elettroacustico ignoto separato dalla geometria;
- associazione probabilistica degli echi a zone delle superfici, Gaussiane o classe non assegnata;
- stima di assorbimento efficace per banda, scattering, supporto, residuo e confidenza;
- export RAW, acustico JSON/CSV, PLY RGB e OBJ colorato.

L'app non usa un backend obbligatorio e non esegue TSDF, ICP globale, bundle adjustment o ricostruzione fotogrammetrica pesante.

## Principi ereditati da V10, V11 e V12

### Da V10

Sono conservati:

- una sola sessione WebXR per scala, pose e continuita tra vani;
- registrazione microfonica continua attorno agli sweep;
- sweep brevi emessi in posizioni metriche note;
- stima del lag per singola misura;
- deconvoluzione e analisi differite, non nel frame XR.

Non viene conservato l'accumulo non vincolato di punti, che produceva pareti spesse, duplicazioni e outlier.

### Da V11

Ogni sottosistema pesante e isolato:

- callback XR: tracking, piccoli campioni depth, keyframe e scheduling leggero;
- AudioWorklet: solo timeline PCM e meter;
- worker Deep: soltanto dopo l'evento XR `end`;
- FFT, Kirkeby, picchi e inferenza: batch post-XR.

Un errore Deep o acustico non elimina il modello metrico gia acquisito.

### Da V12

Sono conservati il perimetro esplicito, le aperture e i vincoli strutturali, ma la shell non sostituisce la metrica WebXR. Il fit puo rifinire localmente una parete; non puo cambiare liberamente scala, topologia o registrazione tra vani.

## Procedura utente

### 1. Preparazione audio

Nella landing scegliere una modalita:

- **Telefono: speaker + microfono**: misura monostatica compatta. La sorgente e il ricevitore sono offset noti nel sistema del telefono.
- **Altoparlante esterno fisso**: il segnale viene instradato verso un diffusore e la sua posizione viene marcata una volta in AR. E la modalita preferibile quando disponibile.

Premere **Prepara microfono e chirp**. L'app richiede un canale mono a 48 kHz e prova a disattivare cancellazione eco, soppressione rumore e guadagno automatico. Le impostazioni effettivamente restituite dal browser vengono salvate nel RAW.

La scansione geometrica resta possibile disattivando la registrazione RIR.

### 2. Una sola sessione WebXR

Premere **Avvia scansione WebXR** e completare tutti i vani collegati senza chiudere la sessione. `local-floor` resta l'unico frame metrico globale.

Con sorgente esterna, mirare al diffusore e premere **Segna sorgente**. In modalita telefono questo passaggio non serve.

### 3. Topologia del vano

Indicare in ordine gli spigoli pavimento-parete. Non esiste un limite operativo sulla distanza tra spigoli: nicchie, pilastri e piccoli ritorni sono ammessi. Resta solo un epsilon numerico per rifiutare due punti esattamente coincidenti.

La chiusura del vano e sempre esplicita; avvicinarsi al primo punto non chiude il poligono.

Indicare quindi il raccordo parete-soffitto o inserire manualmente l'altezza.

### 4. Caselle sulle superfici

Le pareti sono suddivise in target metrici proiettati in AR:

- rosso: nessuna vista valida;
- giallo: prima vista acquisita, manca una posa distinta;
- verde: requisito soddisfatto.

Le frecce guidano verso il target selezionato. Una foto puo coprire piu caselle. Le caselle basse richiedono normalmente almeno due pose distinte per migliorare la forma degli oggetti; quelle alte possono richiedere una sola vista.

Le caselle sono una guida, non un vincolo assoluto. Un vano puo essere completato con almeno tre fotografie e due posizioni distinte anche se una zona occlusa resta rossa o gialla.

### 5. Sweep automatici

Dopo il warm-up, un ESS viene emesso solo quando:

- il telefono e sufficientemente stabile;
- la posa e distinta dall'ultima misura per traslazione o rotazione;
- il limite per vano non e stato raggiunto;
- non e in corso un'altra finestra acustica.

Configurazione predefinita:

- 120 Hz - 15 kHz;
- durata sweep 0.32 s;
- coda registrata 2.65 s;
- massimo 12 misure per vano;
- distanza consigliata tra pose circa 0.42 m, oppure variazione di yaw circa 34 gradi.

L'utente non deve sincronizzare manualmente il chirp. La posa WebXR, il tempo XR, il tempo `performance`, il tempo `AudioContext`, l'onset correlato e i timestamp del browser vengono registrati separatamente.

### 6. Vani collegati

Premere **Attraversa passaggio**, oltrepassare la porta e iniziare il perimetro successivo nello stesso WebXR. La traiettoria del telefono e la geometria del passaggio collegano i due vani senza ICP o riallineamento libero.

### 7. Chiusura sicura

Alla chiusura:

1. vengono sospesi nuovi keyframe e sweep;
2. viene completata o annullata in modo controllato la finestra in corso;
3. viene invocato `session.end()` una sola volta;
4. l'app attende l'evento XR `end`;
5. camera, depth, hit-test, anchor e WebGL vengono rilasciati;
6. i segmenti PCM Int16 e i JPEG vengono salvati come record IndexedDB separati;
7. viene salvato un checkpoint interamente clonabile;
8. la revisione e il processing si aprono nello stesso documento, senza reload automatico.

Il checkpoint non contiene funzioni, `AudioNode`, `MediaStream`, texture WebGL o handle XR. I vertici con metadati e la mappa temporale audio sono serializzati in record numerici espliciti.

### 8. Processing

Premere **Processa metrica + Deep + RIR**. L'ordine e:

1. ricostruzione della mappa surfel metrica XR;
2. fit bounded delle superfici strutturali;
3. Deep Anything post-XR, una immagine per volta;
4. calibrazione metrica direct/inverse per ogni depth relativa;
5. fusione selettiva di surfel RGB e Gaussiane locali;
6. aggregazione oggetti RGB multi-vista;
7. deconvoluzione ESS con regolarizzazione di Kirkeby;
8. rilevamento del diretto, riallineamento e picchi precoci;
9. metriche di decadimento tardivo per banda;
10. associazione probabilistica eco-superfici/Gaussiane;
11. inferenza di assorbimento efficace per zone.

Il batch e interrompibile. Un errore in una foto o in una RIR viene registrato e non invalida automaticamente le altre misure.

## Geometria ibrida leggera

### Autorita metrica

La scala deriva da pose WebXR e XR Depth. La depth monoculare e relativa e viene calibrata per keyframe con:

- campioni XR Depth visibili nello stesso frame;
- intersezioni con la shell come ancore piu deboli;
- scelta automatica tra modello diretto `z = a*d+b` e inverso `z = a/d+b`;
- stima robusta e range fisico limitato.

Una foto senza ancore sufficienti non modifica la scala globale.

### Surfel map

La mappa usa voxel metrici da 5 cm e mantiene per cella:

- posizione media pesata;
- normale, quando disponibile;
- RGB medio;
- numero di viste e sorgenti;
- stanza di appartenenza;
- peso e dispersione.

La capacita e limitata; celle deboli vengono potate prima di quelle multi-vista. Non esiste una griglia volumetrica densa.

### Fit delle pareti

Per ogni parete vengono considerati surfel compatibili con altezza, stanza e orientamento. Il fit robusto puo applicare soltanto correzioni locali predefinite:

- rotazione massima circa 4.5 gradi;
- traslazione normale massima circa 0.26 m;
- spostamento massimo del corner circa 0.38 m.

Il poligono acquisito resta il prior topologico e la metrica WebXR non viene riscalata.

### Gaussiane locali

Le regioni non spiegate bene dalla shell vengono raggruppate in patch Gaussiane compatte con centro, covarianza, normale, colore, supporto e stanza. Servono per:

- descrivere dettagli sporgenti o irregolari;
- offrire alternative geometriche all'associazione degli echi;
- evitare una mesh densa globale.

Non sono Gaussian Splatting fotorealistico e non vengono ottimizzate globalmente.

## Oggetti RGB

Un oggetto automatico richiede supporto multi-vista nello stesso vano. Contiene:

1. punti voxel RGB;
2. mesh delle sole facce voxel esterne, con colore per vertice;
3. OBB editabile;
4. volume occupato, volume OBB e fill ratio;
5. sei gruppi di facce acustiche `bottom/top/front/back/right/left`.

Ogni triangolo della mesh ha una `triangleFaceKey`, quindi la futura simulazione puo applicare una proprieta acustica alla parte corrispondente della forma approssimata. Quando l'OBB viene modificato, punti e mesh vengono trasformati insieme.

Gli oggetti manuali sono marcati `synthetic: true` e non vengono confusi con punti osservati.

## RIR, ritardo e latenze

Il sistema non assume di conoscere il ritardo assoluto tra comando audio e pressione sonora registrata. Per ogni misura conserva:

- tempo pianificato nel dominio `AudioContext`;
- coppie numeriche per stimare la mappa `AudioContext <-> performance`;
- `getOutputTimestamp`, quando disponibile;
- indice PCM previsto;
- onset ESS da correlazione;
- picco del cammino diretto;
- residuo elettroacustico diagnostico.

La RIR viene riallineata sul diretto. Le associazioni geometriche usano quindi:

```text
delta_t_echo = t_echo - t_direct
```

non l'indice PCM assoluto. Un ritardo hardware costante o variabile entro la finestra non viene interpretato come distanza aggiuntiva.

La risposta viene filtrata nelle bande 125, 250, 500, 1000, 2000, 4000 e 8000 Hz. Le bande non supportate dal dispositivo o dallo sweep mantengono confidenza bassa.

## Associazione probabilistica alle superfici

Per ogni picco precoce e posa metrica vengono generati candidati:

- cammini image-source di primo ordine su zone di parete, pavimento e soffitto;
- gruppi di facce degli oggetti;
- Gaussiane locali compatibili con stanza, visibilita e normale;
- una classe esplicita `unassigned`.

Il punteggio combina:

- residuo temporale tra delay previsto e osservato;
- appartenenza del punto speculare al poligono/alla zona;
- orientamento e visibilita;
- confidenza della geometria;
- supporto multi-RIR;
- energia per banda.

I posteriori vengono normalizzati e non obbligano ogni eco ad appartenere a una superficie. Echi ambigui o incompatibili possono restare non assegnati.

## Inferenza di assorbimento per zone

Per una zona con sufficiente supporto, l'energia riflessa viene confrontata con diretto, distanza del cammino, geometria e affidabilita della misura. L'app produce un coefficiente di assorbimento efficace per banda, regolarizzato con:

- decadimento tardivo globale del vano;
- prior visivo/materiale a bassa autorita;
- regolarita tra zone vicine;
- limite fisico `[0,1]`.

Ogni risultato conserva:

- `alpha[]`;
- `confidence[]`;
- scattering;
- numero di RIR e picchi di supporto;
- posteriori e residui;
- sorgente `inferred`, `manual` oppure `auto`.

Questi coefficienti sono stime in situ efficaci, non coefficienti da tubo di impedenza o camera riverberante. Direttivita non calibrata, risposta del telefono, occlusioni e modello di riflessione di primo ordine limitano l'accuratezza assoluta.

Le modifiche manuali restano autorevoli dopo nuovo fit, import e reload.

## Compatibilita browser e dispositivo

Requisiti principali:

- HTTPS;
- Chrome Android con sessione `immersive-ar`;
- ARCore;
- `local-floor`, hit-test e DOM overlay;
- Raw Camera Access per RGB e Deep;
- XR Depth per la calibrazione metrica migliore;
- microfono e uscita audio per le RIR;
- AudioWorklet e IndexedDB.

La disponibilita effettiva di Raw Camera e XR Depth dipende dal telefono. Se XR Depth manca, la shell resta metrica grazie a WebXR e alla topologia utente, ma Deep dispone di meno ancore. Se Raw Camera manca, questa build interrompe la scansione visuale per evitare di produrre un modello oggetti privo di RGB; una futura variante potrebbe offrire un profilo solo shell+RIR.

Le API Web Audio non garantiscono che il browser disattivi davvero tutte le elaborazioni microfoniche: il RAW conserva le impostazioni effettive per escludere o pesare misure compromesse.

## Deep locale e funzionamento offline

La shell, il worklet, l'editing, il processing RIR e gli export sono cacheabili dal service worker dopo un primo caricamento online.

Il modello Deep e il runtime non sono inclusi nel pacchetto. Per elaborazione interamente offline copiare:

```text
vendor/onnxruntime-web/ort.min.js
vendor/onnxruntime-web/<WASM/MJS della stessa release>
models/depth_anything_v2_small_q4.onnx
```

Il worker tenta prima i file locali. Senza Deep, restano disponibili shell metrica, XR Depth, RIR, oggetti manuali, revisione ed export.

## Export

### RAW JSON

Contiene lo stato completo ricostruibile:

- frame metrico e traiettoria;
- perimetri acquisiti e fitted;
- surfel e Gaussiane compattati;
- fotografie e riferimenti IndexedDB;
- manifest delle finestre PCM;
- analisi RIR e associazioni;
- oggetti RGB e mesh;
- superfici, zone, coefficienti e modifiche manuali;
- diagnostica e capacita del dispositivo.

I campioni PCM grezzi non vengono duplicati nel JSON: restano in record IndexedDB separati. Le RIR analizzate e i risultati numerici sono inclusi.

### Acoustic JSON / CSV

Contengono superfici e zone, geometria di riferimento, bande, `alpha`, scattering, confidenza, supporto, latenze diagnostiche e risultati RIR.

### PLY

Punti RGB degli oggetti con `object_id` e flag `synthetic`.

### OBJ

Shell delle stanze e mesh voxel degli oggetti. I vertici oggetto usano l'estensione comune `v x y z r g b`; un lettore che ignora i colori conserva comunque la geometria.

## Deploy

Pubblicare tutti i file della cartella nella root HTTPS. L'entry point canonico resta:

```text
room_scanner_v12.html
```

`index.html` reindirizza mantenendo query e hash. Gli asset eseguibili sono versionati `v20_1_0`; gli alias senza versione hanno gli stessi byte.

Dopo l'aggiornamento da V15/V20.0 cancellare una volta i dati del sito o disinstallare la vecchia PWA. Il service worker usa network-first per HTML, JavaScript, worklet, worker, manifest e build info. Solo una navigazione puo usare la pagina HTML come fallback; un file JavaScript mancante non riceve HTML.

## Test

Eseguire:

```sh
./tests/run_all.sh
```

Poi seguire `TEST_ON_PHONE.md`. I 26 test Node verificano geometria, scaling Deep, lag acustico, fallback audio Android, checkpoint clonabile, handoff post-XR, associazione RIR-superficie, oggetti RGB, export contract e delivery HTTP. Non sostituiscono una misura fisica su Chrome Android/ARCore.
