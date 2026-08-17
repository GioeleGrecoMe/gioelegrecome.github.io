# Room Scanner V12.2.2 — Guided Capture Fix + Object OBB Manager

V12.2.2 mantiene il workflow guidato di V12.2.1 e corregge una regressione critica nell'acquisizione del perimetro, aggiungendo inoltre la gestione esplicita degli oggetti non strutturali.

## Fix critico: spigoli del pavimento nuovamente cliccabili

In V12.2.1 `onXRFrame()` chiamava `updateGuidedAimAndOverlay(view)`, ma la funzione era stata accidentalmente rimossa durante il refactoring della guida pareti/texture.

Effetto sul dispositivo:

- ogni XR frame generava un errore interno;
- `S.guided.currentAim` restava sempre `null`;
- `updateGuidedHUD()` manteneva correttamente ma permanentemente disabilitato `Aggiungi spigolo + foto`;
- il workflow non poteva superare il primo step.

V12.2.2 ripristina una funzione XR molto leggera che, a ogni frame:

1. salva uno snapshot minimo delle matrici della `XRView`;
2. interseca il raggio centrale con `local-floor` durante `floor-trace` e `floor-refine`;
3. aggiorna `currentAim`;
4. rende verde il reticolo quando il punto metrico è valido;
5. abilita il pulsante `Aggiungi spigolo + foto`;
6. in fase pareti aggiorna la guida rosso/giallo/verde;
7. ridisegna solo l'overlay AR, senza eseguire Deep o elaborazioni pesanti.

Il pulsante resta volutamente disabilitato quando il reticolo non interseca il pavimento: in quel caso l'utente deve inclinare il telefono verso il floor plane. Questo evita di creare vertici non metrici.

È stato aggiunto un test di regressione che costruisce una `XRView` sintetica inclinata verso il basso e verifica sia `currentAim != null` sia `guidedPrimary.disabled === false`.

## Oggetti non strutturali: OBB + RGB point cloud

Il modello finale mantiene sempre separati:

- `ROOM_SHELL`: pavimento, pareti, soffitto e texture;
- oggetti interni: residuo XR/Deep persistente.

Ogni oggetto è rappresentato principalmente da:

- una point cloud RGB voxelizzata e limitata per il display;
- un OBB gravity-aligned orientato tramite PCA nel piano XZ;
- tutte le chiavi voxel originali dell'oggetto, conservate anche se la cloud visuale viene campionata;
- frame di provenienza, percentuale XR/Deep, persistenza e confidenza.

Questa rappresentazione è intenzionalmente più leggera e robusta di una mesh dettagliata ricostruita automaticamente dal rumore monoculare.

## Gestore oggetti nella Scena

Nel viewer è presente una tendina per selezionare un oggetto. Per l'oggetto selezionato sono disponibili:

- `Inquadra`;
- `Nascondi / Mostra`;
- `Rimuovi / Aggiungi`;
- `Ripristina tutti`.

Il layer `Box oggetti` mostra gli OBB orientati. Il layer `Cloud oggetti` mostra la geometria RGB residua.

### Stanza nuda

`Stanza nuda` è un toggle puramente visuale: nasconde tutti gli oggetti ma non modifica il modello.

`Rimuovi`, invece, modifica il modello attivo:

- le celle dell'oggetto vengono escluse dal PLY finale;
- l'OBB proxy dell'oggetto non viene scritto nell'OBJ;
- `Aggiungi` ripristina l'oggetto senza rieseguire Depth Anything.

## Export

### PLY

La PLY resta la rappresentazione dettagliata degli oggetti perché conserva la point cloud RGB residua e l'`object_id`.

### OBJ

L'OBJ contiene:

- la shell strutturale;
- un `OBB_PROXY` molto leggero per ogni oggetto attivo.

Non viene generata automaticamente una mesh OBJ densa dell'oggetto: sarebbe costosa e rischierebbe di solidificare rumore Deep. Una ricostruzione superficiale degli oggetti potrà essere un passaggio offline successivo.

## Test

Eseguire:

```bash
node tests/test_v12_2_2_static.js
node tests/test_v12_2_2_runtime.js
node tests/test_v12_2_2_package.js
```

La suite comprende esplicitamente la regressione del puntatore pavimento e verifica che `Aggiungi spigolo + foto` si abiliti quando il raggio XR interseca `local-floor`.

## Deploy

Sostituire:

- `room_scanner_v12.html`
- `sw.js`
- `build_info.json`

Mantenere invariati:

- `depth_ai_worker.js`
- `models/depth_anything_v2_small_q4.onnx`
- `vendor/depthai-123/`

Dopo il deploy verificare che il badge mostri `V12.2.2` e, iniziata la scansione, inclinare il telefono verso il pavimento: il reticolo deve diventare verde e `Aggiungi spigolo + foto` deve diventare cliccabile.
