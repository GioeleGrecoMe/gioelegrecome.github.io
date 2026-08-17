# Room Scanner V12.2.3 — Persistent WebXR Wall Evidence

V12.2.3 mantiene il workflow guidato stabile della V12.2.2 e inserisce un livello intermedio molto leggero fra il perimetro tracciato dall'utente e Depth Anything: **surfel WebXR persistenti con statistiche gaussiane**.

## Obiettivo

Il perimetro disegnato dall'utente stabilisce la topologia della stanza, anche quando mobili nascondono gli spigoli. Non viene però assunto come misura perfetta: dopo la prima conferma l'utente esegue una breve passata WebXR. Depth, mesh, plane e RGB vengono aggregati in surfel persistenti e usati per proporre una correzione metrica delle pareti. La correzione viene mostrata in pianta e richiede una seconda conferma.

Solo dopo questa verifica si acquisiscono le foto delle pareti. Ogni parete possiede una coverage map 2D separata per:

- evidenza metrica WebXR;
- fotografie disponibili;
- profondità Deep effettivamente validata.

Più fotografie parziali della stessa parete possono quindi comporre progressivamente la copertura completa.

## Pipeline

```text
Perimetro utente
      ↓
Prima verifica top-down
      ↓
Passata WebXR di raffinamento
 depth + mesh + plane + RGB
      ↓
Surfel persistenti / gaussian statistics
      ↓
Correzione robusta delle linee parete
      ↓
Seconda verifica top-down
      ↓
Foto pareti multi-vista
      ↓
Depth Anything batch
      ↓
XR same-view + Gaussian anchors + shell analytica
      ↓
Parete / foreground object / optical anomaly
      ↓
Texture atlas per parete + oggetti OBB/cloud
      ↓
ROOM_SHELL chiusa
```

## Gaussian surfel leggeri

Non viene eseguito un vero 3D Gaussian Splatting. Ogni voxel/surfel XR già esistente conserva semplicemente:

- media metrica `p`;
- normale quando disponibile;
- RGB medio;
- peso/confidenza;
- numero di osservazioni;
- varianza spaziale accumulata (`m2`).

Da questi campi derivano `surfelSigma()` e `surfelPersistence()`. Non viene quindi creata una seconda point cloud densa in RAM.

## Raffinamento del perimetro

Per ogni lato tracciato si cercano surfel verticali compatibili entro una fascia limitata. Gli offset ortogonali vengono accumulati in un istogramma robusto e pesati per:

- confidenza;
- persistenza multi-vista;
- dispersione/sigma;
- compatibilità della normale;
- estensione longitudinale lungo la parete.

La soluzione preferisce una popolazione persistente ed estesa lungo la frontiera. Una faccia di mobile parallela ma corta o instabile viene penalizzata. Lo shift massimo proposto è limitato (`wallRefineMaxShift`), e gli spigoli finali sono ricalcolati come intersezioni delle linee corrette per mantenere il footprint chiuso.

Nessuna correzione viene applicata in modo invisibile: dopo la passata XR la nuova pianta viene mostrata all'utente per conferma.

## Coverage per parete

Ogni parete è parametrizzata in coordinate locali `(s,h)` con griglia 24 x 14. Le celle mantengono tre livelli indipendenti:

- `xr`: supporto dei surfel persistenti;
- `photo`: copertura geometrica delle fotografie acquisite;
- `deep`: porzione che Depth Anything ha realmente validato e applicato.

Durante la scansione la parete viene colorata direttamente in AR:

- rosso: dati insufficienti;
- giallo: foto disponibile o evidenza XR ancora debole;
- verde: supporto XR persistente o Deep validato, a seconda della fase.

La guida indica anche la regione mancante (`alta destra`, `centrale`, ecc.). Una parete lunga può quindi essere acquisita con più foto da prospettive differenti.

## Deep Anything

Deep rimane **batch-only**. Non viene mantenuto ONNX Runtime mentre WebXR è attivo.

Per ogni foto il fit metrico usa, in ordine di forza:

1. depth XR sincronizzata della stessa vista;
2. surfel gaussiani XR persistenti riproiettati nella foto;
3. profondità analitica della parete confermata come fallback debole.

Un punto assegnato alla parete viene proiettato sull'esatto piano strutturale. Deep non può quindi introdurre una nuova normale della parete. I punti significativamente più vicini diventano residui/oggetti; quelli dietro la shell vengono trattati come incompatibili o possibili aperture/superfici ottiche.

## Texture

La geometria finale delle pareti resta leggera. Il dettaglio vive negli atlas RGB per parete. Le fotografie sono pesate per angolo, copertura, nitidezza e occlusione; i colori dei surfel XR persistenti sono usati come anchor/fallback. Gli oggetti davanti alla parete non vengono usati per dipingere la texture quando il foreground è riconosciuto.

## Oggetti

Gli oggetti rimangono rappresentati come:

- OBB orientato sul pavimento;
- point cloud RGB voxelizzata interna;
- persistenza multi-vista;
- stato `visible / hidden / removed`.

`Stanza nuda` nasconde gli oggetti senza modificare il modello. `Rimuovi` li esclude anche dagli export attivi; `Aggiungi` li ripristina senza rieseguire Deep.

## Prestazioni

La passata XR di raffinamento non esegue Deep. Il calcolo pesante resta differito finché la sessione XR non è terminata. L'evidenza gaussiana riutilizza i surfel esistenti e non introduce un renderer 3DGS o una nuova struttura volumetrica densa.

## Test

```bash
node tests/test_v12_2_3_static.js
node tests/test_v12_2_3_runtime.js
node tests/test_v12_2_3_package.js
```

La suite verifica, fra gli altri casi:

- perimetro con errore metrico e correzione da evidenza XR persistente;
- parete esterna dietro una faccia di mobile parallela;
- footprint chiuso dopo il raffinamento;
- coverage XR da surfel gaussiani;
- unione di più fotografie parziali della stessa parete;
- anchor gaussiani disponibili al fit Deep;
- snapping dei punti Deep strutturali sul piano metrico;
- residui-oggetto davanti alla shell;
- ROOM_SHELL manifold/watertight;
- viewer ortografico;
- lifecycle WebXR senza seconda camera.

## Limite di validazione

I test automatici non possono sostituire la prova fisica di WebXR raw camera/depth/plane/mesh sul dispositivo Android/ARCore. Questa resta necessaria prima del deploy definitivo.
