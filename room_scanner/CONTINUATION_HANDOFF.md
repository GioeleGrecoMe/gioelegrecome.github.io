# Continuation handoff - V20.1.0

## Baseline

Build: `v20.1.0-metric-rir-twin-20260818`

Entry point: `room_scanner_v12.html`

## Invarianti

- Una sola sessione WebXR per tutti i vani collegati.
- `local-floor` e l'unico frame metrico globale.
- `getCameraImage()` resta nel callback XR rAF.
- Nessun secondo stream camera; `getUserMedia` e solo audio.
- Nessun Deep, FFT, deconvoluzione o clustering globale nel frame XR.
- Il fit strutturale e bounded e non cambia la scala WebXR.
- PCM e JPEG sono record IndexedDB separati dal checkpoint.
- Nessuna funzione o risorsa browser non clonabile nel checkpoint.
- La chiusura segue `session.end -> XR end -> cleanup -> persist -> review`.
- Le associazioni usano delay eco relativo al diretto.
- Il sample rate effettivo della route audio, non quello richiesto, governa ESS, timeline PCM e deconvoluzione.
- La classe `unassigned` deve restare disponibile.
- Ogni stima acustica conserva supporto, residuo e confidenza.
- Gli override manuali sono autorevoli.
- Gli oggetti automatici richiedono viste distinte e non fondono stanze.

## File principali

```text
roomscan_core_v20_1_0.js
roomscan_signal_v20_1_0.js
roomscan_geometry_v20_1_0.js
roomscan_acoustics_v20_1_0.js
roomscan_audio_v20_1_0.js
roomscan_audio_worklet_v20_1_0.js
roomscan_app_v20_1_0.js
depth_ai_worker_v20_1_0.js
sw_v20_1_0.js
```

Dopo una modifica copiare ogni file versionato nel relativo alias senza versione e rieseguire `static_contract.test.js`.

## Handoff post-XR

Non aggiungere serializzazione prima dell'evento `end`. La mappa clock deve contenere soltanto numeri. I corner devono passare da `serializeCornerRecord`/`restoreCornerRecord`. Non salvare `AudioContext`, `AudioNode`, `MediaStream`, `XRSession`, `XRAnchor`, reader camera o oggetti WebGL.

## Audio

`AcousticCaptureController` emette ESS e conserva finestre PCM bounded. Il descrittore ESS contiene `samples`; non trattarlo come array diretto. La posa deve includere sorgente e ricevitore nello stesso frame metrico.

Il timing assoluto e diagnostico. Il delay acustico usato dal solver e sempre relativo al diretto rilevato nella singola RIR.

## Geometria

`MetricSurfelMap` e la rappresentazione densa autoritativa. La shell utente fornisce topologia e prior. Deep e solo una sorgente secondaria calibrata. Non introdurre ICP globale o una trasformazione per stanza.

## Acustica

Pipeline:

```text
PCM -> onset ESS -> Kirkeby -> diretto -> RIR relativa
-> picchi/bande/decadimento
-> candidati image-source + Gaussiane + unassigned
-> posterior
-> alpha per zona + confidenza
```

Un test sintetico deve continuare ad assegnare l'eco noto alla parete corretta anche cambiando il lag hardware.

## Test obbligatori

```sh
./tests/run_all.sh
```

Prima della distribuzione:

1. rimuovere file di versioni precedenti;
2. rigenerare `SHA256SUMS.txt`;
3. creare l'archivio;
4. estrarlo in una directory vuota;
5. verificare i checksum;
6. rieseguire la suite dalla copia estratta.
