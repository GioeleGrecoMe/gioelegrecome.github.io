# Room Scanner V10 — Depth Anything replacement V3

Questa revisione sostituisce le patch precedenti. È stata progettata per toccare soltanto il percorso **Depth Anything** e la relativa diagnostica.

## Punto importante

Il V10 corrente dichiara già `depthAIRuntimeVersion:'1.23.2'` e usa `depth_ai_worker.js` come worker dedicato. Non viene quindi fatto alcun pin globale di ONNX Runtime nell'HTML.

Le due correzioni funzionali sono esclusivamente nel worker Depth:

1. **same-origin `wasmPaths`**: un URL assoluto `https://...` sullo stesso origin non deve essere trattato come CDN/remoto. Il worker confronta ora gli `origin` reali e, quando il runtime ORT è locale, usa `vendor/depthai-123/` anche per WASM/JSEP;
2. **fallback runtime interno**: il default residuo `1.24.1` nel ramo `init` viene allineato a `1.23.2`.

Non vengono modificate formule di preprocessing/inferenza, provider order, metric fit, fusion gates, WebXR, camera, audio, geometria, SAM/MobileSAM, splatting o Service Worker.

## Diagnostica aggiunta

Il worker conserva un trace circolare (max 120 eventi) con:

- boot e ambiente del worker;
- ogni tentativo di import ORT e relativo errore/stack;
- runtime effettivamente scelto e `wasmPaths`;
- fetch modello, HTTP status, byte count e SHA-256;
- provider richiesti e creazione sessione;
- smoke inference;
- dimensioni input/output, validità numerica e timing;
- eventuale crash del worker con filename/line/column.

Nell'HTML viene aggiunto **Copia log Depth AI** accanto alla diagnostica esistente. Il pulsante copia un JSON pronto da incollare.

La diagnostica non sostituisce globalmente `Worker`, non intercetta `fetch`, non intercetta `console` e non modifica `sw.js`.

## Metodo consigliato: genera i due file drop-in dal sito pubblico

Da questa cartella:

```bash
python3 build_dropin_replacement.py --from-public -o replacement
```

Otterrai:

```text
replacement/
  room_scanner_v10.html
  depth_ai_worker.js
  DEPTH_FIX_MANIFEST.json
  DEPLOY.txt
```

Carica nel sito **solo** i primi due file come sostituti dei corrispondenti file correnti.

Mantieni invariati:

```text
sw.js
vendor/depthai-123/
models/depth_anything_v2_small_q4f16.onnx
```

Il builder è fail-closed: prima di scrivere controlla che il sorgente abbia gli anchor del V10 revisionato. Se il sito è cambiato, si ferma invece di applicare sostituzioni approssimative.

## Metodo da checkout locale

Se hai già la cartella `room_scanner`:

```bash
python3 build_dropin_replacement.py /percorso/room_scanner -o replacement
```

Questo non modifica i sorgenti: crea i due file sostitutivi nella cartella `replacement`.

Per applicare invece direttamente in-place con backup:

```bash
python3 patch_depth_v3.py /percorso/room_scanner
python3 verify_depth_v3.py /percorso/room_scanner
```

## Test sul telefono

Dopo il deploy:

1. apri V10 con un hard refresh;
2. lascia eseguire il preflight/smoke Depth Anything già previsto dal V10;
3. se fallisce, premi **Copia log Depth AI**;
4. incolla il JSON completo.

I campi più utili sono `depthAI.lastWorkerDebug`, `depthAI.lastSmoke`, `depthAI.lastError`, `runtimeSource`, `wasmPaths`, `modelIntegrity`, `provider` e `events`.
