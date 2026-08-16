# Room Scanner V12.0.2 — Evidence Fusion + Closed Scene

Sostituzione completa di `room_scanner/room_scanner_v12.html`, costruita sopra la V12.0.1 ma con una fusione WebXR + Depth Anything più continua e una rappresentazione finale esplicitamente separata in:

1. evidenza metrica WebXR;
2. evidenza Deep metrizzata e verificata;
3. superfici strutturali;
4. involucro chiuso della stanza;
5. nuvole/mesh di oggetti rimovibili.

## Installazione

Sostituire **solo**:

```text
room_scanner/room_scanner_v12.html
```

con il file incluso in questo pacchetto.

Restano invariati gli asset già presenti nel progetto:

```text
depth_ai_worker.js
models/depth_anything_v2_small_q4.onnx
vendor/
```

La pagina non usa Three.js, OrbitControls o CDN per il viewer. Il modello Deep live continua a essere caricato dal percorso locale; il fallback remoto del worker resta quello già previsto dal progetto.

## 1. Fusione metrica WebXR + Deep

WebXR resta l'autorità per posa e scala. Depth Anything non genera mai direttamente coordinate world.

Per ogni keyframe RGB:

```text
Depth relativa
   ↓
fit metrico robusto globale
   ↓
campo locale di residui XR 8 × 6
   ↓
Depth metrica localmente corretta
   ↓
back-projection con posa WebXR
   ↓
verifica XR / mesh / superfici / altre viste
   ↓
Deep admitted oppure candidate/rejected
```

### Fit globale

Vengono provati sia un modello affine sulla depth relativa sia un modello affine su `1 / relativeDepth`. Viene scelto il fit robusto con errore migliore dopo rimozione iterativa degli outlier.

### Correzione metrica locale

Il fit globale non è più l'unica correzione. Le ancore WebXR sono accumulate in una griglia immagine 8 × 6; ogni cella conserva il residuo metrico robusto tra Deep metrizzata e XR. Durante la proiezione ogni pixel Deep riceve una correzione locale interpolata e limitata a ±0.30 m.

Le ancore XR sincronizzate con il keyframe hanno peso maggiore delle ancore consolidate da altre osservazioni.

Questo consente di correggere errori spazialmente variabili di Depth Anything senza deformare la posa o la scala WebXR.

## 2. Verifica multi-vista visibility-aware

Una seconda vista non è più trattata soltanto come un test di distanza. La V12.0.2 distingue:

- **supporto**: il punto proiettato cade sulla depth attesa;
- **supporto XR**: la seconda vista possiede depth nativa coerente;
- **occlusione**: il punto candidato è dietro una superficie già vista più vicina;
- **free-space conflict**: il candidato sarebbe davanti a una superficie osservata e occuperebbe spazio che la seconda vista misura come libero.

I conflitti XR hanno priorità e possono respingere un punto anche se Deep è localmente plausibile.

La rifusione è atomica: si costruisce una nuova mappa Deep e la si sostituisce soltanto al termine del passaggio. Durante scansione continua il debounce ha anche una latenza massima, così nuove evidenze vengono integrate periodicamente senza dover fermare il telefono.

## 3. Mesh XR usata come geometria

Quando `XRMesh.indices` è disponibile vengono conservati e campionati triangoli reali in coordinate WebXR. L'ammissione Deep può quindi ricevere supporto dalla distanza punto-triangolo e non soltanto dalla vicinanza a un vertice della mesh.

La mesh WebXR rimane evidenza autorevole; non viene resa più dettagliata artificialmente.

## 4. Superfici strutturali

L'ordine di stima è:

1. XR planes;
2. piani derivati dalle normali di WebXR depth;
3. estensione conservativa con evidenza Deep/XR coplanare e connessa;
4. candidati parete Deep multi-vista;
5. superfici orizzontali di oggetti.

Le superfici Deep-only non diventano automaticamente autorità per ammettere altro Deep: questo evita feedback auto-rinforzanti.

### Superfici orizzontali

La quota `Y` da sola non basta. Pareti verticali producono infatti molte sezioni alla stessa altezza. La V12.0.2 richiede anche una componente connessa 2D nel piano XZ, area minima, due dimensioni reali e fill ratio sufficiente. Una striscia di parete viene quindi rifiutata, mentre il top di un tavolo può essere riconosciuto.

## 5. Involucro stanza chiuso

La scena strutturale genera `ROOM_SHELL`, una mesh chiusa e watertight, soltanto quando esiste una base strutturale minima:

- almeno un pavimento, oppure
- almeno due ipotesi di parete.

Non viene creato un involucro usando soltanto punti generici degli arredi.

Con informazione incompleta il footprint è un inviluppo convesso robusto delle superfici strutturali. La scelta è intenzionalmente conservativa: una concavità non osservata non viene inventata.

Il RAW conserva per ogni parte del guscio:

- tipo: pavimento / soffitto / parete;
- intervallo di triangoli;
- `observed: true/false`;
- confidenza;
- evidenza che ha prodotto quella parte.

Quindi una faccia aggiunta soltanto per chiudere topologicamente la stanza non viene confusa con una parete misurata.

## 6. Oggetti come entità rimovibili

Dopo avere sottratto l'involucro strutturale, i punti residui XR + Deep vengono voxelizzati e raggruppati in componenti 3D connesse.

Ogni oggetto conserva:

- nuvola di punti dedicata;
- `cellKeys` di appartenenza;
- OBB orientato;
- mesh voxel di bordo chiusa;
- frame che lo confermano;
- evidenza XR/Deep;
- numero di punti XR e Deep;
- confidenza;
- stato `candidate`, `confirmed`, `hidden` o `removed`.

Una superficie sottile ma ben osservata (ad esempio un piano di tavolo) non viene più scartata per spessore nullo della sola nuvola: la mesh usa come minimo lo spessore di un voxel, senza estrudere arbitrariamente un grande volume.

Nel viewer sono separati:

```text
Mesh stanza
XR strutturale
Deep strutturale
Superfici
Mesh oggetti
Nuvole oggetti
Candidati
```

`Nascondi` rimuove temporaneamente cloud e mesh dal viewer. `Rimuovi` esclude l'entità dalla scena attiva; il pulsante diventa `Aggiungi` e consente di ripristinarla.

## 7. Export

### RAW V12.0.2

Schema:

```text
room-scanner-v12.0.2-raw
```

Include, tra le altre cose:

- RGB originali dei keyframe;
- posa/projection/intrinsics;
- depth XR sincronizzata;
- Depth Anything relativa;
- fit globale;
- campo locale delle ancore;
- surfel XR e Deep con provenienza/confidenza;
- metadati degli XR planes;
- triangoli XR mesh campionati;
- superfici;
- `ROOM_SHELL` con provenance per parte;
- oggetti, nuvole e mesh;
- log diagnostico.

L'import resta compatibile anche con RAW V12.0.1.

### PLY fusa

Il PLY contiene:

```text
x y z
RGB
confidence
source       # 1 = XR, 2 = Deep
object_id    # 0 = struttura/non assegnato, >0 = oggetto
```

Gli oggetti nascosti/rimossi non vengono esportati nella nuvola attiva.

### OBJ scena chiusa

L'OBJ contiene:

- `ROOM_SHELL`;
- una mesh separata per ogni oggetto attivo;
- commenti con confidenza, stato ed evidenza degli oggetti;
- commento sul rapporto pareti osservate / pareti inferite della stanza.

## 8. Test automatici

Eseguire dalla directory del pacchetto:

```bash
node --check <javascript estratto dal tag module>
node tests/test_v12_0_2_static.js
node tests/test_v12_0_2_synthetic.js
```

I test sintetici coprono:

- piano finito;
- OBB tavolo ruotato;
- volume divano;
- parete parzialmente occlusa;
- fit metrico robusto con outlier;
- campo di correzione locale con bias spaziale opposto;
- distanza da triangolo XR;
- rifiuto di una sezione di parete come falso piano orizzontale;
- riconoscimento top tavolo;
- rifiuto di una stanza chiusa costruita solo da arredi;
- creazione di `ROOM_SHELL` chiuso;
- distinzione parti misurate / inferite del guscio;
- mesh voxel watertight;
- oggetto sottile trasformato in cloud + mesh separabile.

## 9. Test reale consigliato su Android / ARCore

### A. Parete + tavolo

1. Inquadrare una parete e il tavolo frontalmente.
2. Spostarsi lateralmente di 30–60 cm.
3. Girare attorno al tavolo di almeno 30–45°.
4. Aprire Revisione.
5. Verificare che `multi-vista` cresca e che `conflicts` non esploda.
6. Aprire Scena e disattivare/riattivare `Nuvole oggetti` e `Mesh oggetti`.
7. Rimuovere il tavolo e verificare che la stanza strutturale resti invariata.

### B. Soffitto e parete incompleta

1. Acquisire pavimento e almeno due pareti.
2. Osservare solo parzialmente il soffitto.
3. Controllare `Mesh stanza chiusa` nella Revisione.
4. Verificare nel RAW che le parti non misurate abbiano `observed:false`.

### C. Profilo degradato

Ripetere una sessione con depth/mesh native non disponibili, se il dispositivo/browser lo permette. La pagina deve continuare a funzionare; Deep può contribuire soltanto dopo ancoraggio metrico sufficiente e verifica multi-vista.

## 10. Limiti intenzionali

- `ROOM_SHELL` usa un footprint convesso quando mancano bordi affidabili. Non inventa rientranze non osservate.
- La mesh voxel degli oggetti privilegia chiusura, robustezza e separabilità rispetto alla levigatezza estetica.
- Il viewer non esegue texture mapping o fotogrammetria densa.
- I test Node non possono sostituire il test fisico di WebXR camera/depth/plane/mesh sul dispositivo.

Queste scelte sono coerenti con l'obiettivo della V12: geometria verificabile per un digital twin acustico, non una ricostruzione visivamente densa ma metricamente fragile.
