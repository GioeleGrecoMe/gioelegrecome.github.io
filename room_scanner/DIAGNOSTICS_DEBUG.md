# Diagnostica approfondita V20.1.0

La patch diagnostica e volutamente separata dalla pipeline di scansione. Il file principale e:

```text
roomscan_diagnostics_v20_1_0.js
```

L'unica integrazione nell'app consiste in hook leggeri per inoltrare log, errori di runtime, uscita WebXR inattesa, fallimento del processing e chiusura intenzionale per una nuova scansione.

## Export manuale

Sono disponibili due pulsanti:

- `Esporta log debug` nella landing;
- `Log debug` durante WebXR.

L'export produce normalmente:

```text
room_scan_diagnostic_v20_1_<timestamp>.jsonl.gz
```

Chrome usa `CompressionStream('gzip')`; se non disponibile il fallback e `.jsonl` non compresso.

## Contenuto del bundle

Il bundle e JSON Lines, quindi un record corrotto o molto grande non rende il resto del file inutilizzabile. Include:

- versione/build e motivo dell'export;
- user agent, piattaforma, viewport, memoria/deviceMemory quando esposta;
- stato rete, storage quota, cache e service worker;
- ultime Performance Resource/Navigation entries;
- ring buffer diagnostico esteso;
- log applicativi V20;
- fase corrente, stato XR, handoff, audio, processing e conteggi principali;
- `buildRawSnapshot()` completo disponibile in memoria;
- tutti i record dello store checkpoint `room-scanner-v20-1-checkpoints/snapshots`;
- JPEG persistiti come `photo:<frameId>`;
- tutti i record PCM/RIR di `room-scanner-v20-acoustic-captures/measurements`;
- metadata dello store acustico;
- typed array e PCM codificati losslessly in base64.

Questo formato privilegia il debug: puo contenere fotografie, audio registrato, geometria e dati ambientali. Va quindi condiviso solo consapevolmente.

## Errori intercettabili

Viene proposta automaticamente una conferma di export per:

- `window.error`;
- `unhandledrejection`;
- errori riportati da `reportRuntimeError`;
- chiusura WebXR non richiesta dall'app;
- fallimento dell'handoff post-XR;
- fallimento non volontario del processing.

Se WebXR o il salvataggio sono ancora attivi, la conferma viene differita fino a quando l'handoff e sicuro, per non introdurre pressione di memoria mentre camera/audio sono ancora in fase di rilascio.

## Crash o chiusura del tab

I browser moderni non consentono di mostrare in modo affidabile un `confirm()` e avviare un download durante `pagehide`/`beforeunload`. La patch quindi:

1. mantiene un marker di sessione attiva in `localStorage`;
2. salva periodicamente un piccolo ring diagnostico;
3. su `pagehide` marca la chiusura non confermata;
4. se il processo viene ucciso senza `pagehide`, resta il marker `active`;
5. alla successiva apertura chiede se esportare il bundle completo recuperabile da checkpoint e IndexedDB.

Il reset volontario `Nuova scansione` viene invece marcato come chiusura attesa e non genera un falso allarme alla riapertura.

## Note per il debug

Per un bug riproducibile allegare preferibilmente:

1. bundle diagnostico `.jsonl.gz`;
2. breve descrizione dell'ultimo gesto effettuato;
3. modello del telefono e versione Chrome/Android;
4. indicazione se il problema e avvenuto dentro WebXR, durante l'handoff o nel processing.

Non serve esportare separatamente RAW e log, perche il bundle diagnostico include anche il RAW corrente e i record persistiti disponibili.
