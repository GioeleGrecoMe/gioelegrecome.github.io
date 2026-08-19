# Room Scanner V30.10.1.1 - single-folder package

Questo archivio ha una sola radice: `v30/`.

Tutto il codice aggiunto/modificato per V30.10.1, i test e la documentazione sono contenuti sotto questa cartella; non ci sono directory `room_scanner_v30_10_patch/`, `room_scanner/` o file di supporto da copiare altrove.

## Struttura

- `room_scanner_v30.html`, `index.html`, `sw.js`, `build_info.json`: entrypoint/runtime aggiornati.
- `js/`: moduli V30.10.1, inclusi XR manual ROI, guida misura, metric geometry e gestione IndexedDB.
- `workers/metric_mesh_worker.js`: mesher metrico diagnostico.
- `tests/`: regression test Node eseguibili direttamente dalla cartella `v30`.
- `docs/`: changelog, verifica su telefono e risultati di debug.
- `package.json`: nessuna dipendenza esterna; `npm test` usa il test runner incluso in Node.

## Installazione nel repository

Usa `v30/` come cartella `room_scanner/v30/` del sito. Se la cartella del repository contiene gia' gli asset originali V30 non modificati (per esempio `js/app.js`, worker Gaussian/MVS, WASM, CSS, manifest e icona), mantienili nella stessa `v30/` e sovrapponi i file di questo pacchetto.

La patch non usa path esterni alla cartella `v30` e non richiede una cartella sibling per il proprio funzionamento.

## Test

Dalla cartella `v30/`:

```bash
npm test
node tools/check_v30_layout.mjs
```

Il secondo comando verifica che nessun file del pacchetto dipenda dalla vecchia gerarchia `room_scanner/v30` e controlla la coerenza della build V30.10.1.
