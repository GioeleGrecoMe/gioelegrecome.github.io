# Architettura V20.1.0

## Moduli

- `roomscan_core_v20_1_0.js`: geometria di base, target parete, oggetti voxel RGB, materiali e superfici acustiche.
- `roomscan_signal_v20_1_0.js`: ESS, correlazione, FFT, Kirkeby, allineamento al diretto, filtri per banda, picchi e decadimento.
- `roomscan_geometry_v20_1_0.js`: surfel map bounded, fit strutturale robusto, calibrazione depth e Gaussiane locali.
- `roomscan_acoustics_v20_1_0.js`: zone, image-source, candidati Gaussiani, posteriori, stima per banda e applicazione alle superfici.
- `roomscan_audio_v20_1_0.js`: microfono, AudioContext, scheduling ESS, clock map numerica, finestre PCM e persistenza.
- `roomscan_audio_worklet_v20_1_0.js`: cattura PCM continua e meter, senza FFT.
- `roomscan_app_v20_1_0.js`: stato, WebXR, camera/depth, UX multi-vano, handoff, batch, editing ed export.
- `depth_ai_worker_v20_1_0.js`: ONNX post-XR e restituzione depth relativa.
- `sw_v20_1_0.js`: shell offline e aggiornamento network-first degli asset critici.

Gli alias senza versione sono copie byte-identiche dei moduli versionati.

## State machine principale

```text
idle
  -> source-mark (solo sorgente fissa)
  -> corners
  -> height
  -> coverage
  -> room-ready
  -> transition
  -> corners ...
  -> xr-ending
  -> post-xr-ready
  -> processing
  -> review
```

Il processamento non puo iniziare finche esiste una sessione XR, un handoff o una finestra audio non chiusa.

## Frame e tempi

### Spazio

Tutti i dati geometrici usano il medesimo `XRReferenceSpace` `local-floor`:

- pose camera;
- sorgente/ricevitore acustico;
- corner e aperture;
- depth XR;
- keyframe RGB;
- surfel e Gaussiane;
- oggetti e superfici.

Non esiste una matrice di riallineamento per stanza. Il passaggio usa la traiettoria nello stesso frame.

### Tempo

Ogni sweep usa almeno tre domini:

- timestamp XR/performance;
- `AudioContext.currentTime`;
- indice PCM dell'AudioWorklet.

`ClockBridge` conserva solo coefficienti e campioni numerici clonabili. La conversione e diagnostica; l'allineamento fisico finale usa matched filter e diretto della RIR.

## Acquisizione live

Il callback XR esegue soltanto operazioni bounded:

1. posa e velocita;
2. hit-test/reticolo;
3. percorso metrico a frequenza ridotta;
4. piccolo grid XR Depth a circa 4 Hz;
5. selezione keyframe e lettura Raw Camera nello stesso frame;
6. aggiornamento caselle;
7. richiesta di uno sweep al controller audio quando la posa e stabile.

Non vengono eseguiti FFT, ONNX, clustering globale o mesh extraction nel callback.

## Record audio

Un manifest di misura include:

```text
id, roomId, sourceMode
sourcePosition, receiverPosition, pose
scheduledContextTime, scheduledPerformanceTime
expectedStartSample, recordedStartSample, recordedEndSample
sampleRate, ESS parameters, clock snapshot
media track settings, capture diagnostics
```

Il PCM Int16 e memorizzato nello store `measurements` del database `room-scanner-v20-acoustic-captures`. Il checkpoint conserva ID e manifest, non il buffer completo.

## Handoff post-XR

Il contratto e:

```text
request stop
-> block keyframes/sweeps
-> settle pending capture
-> session.end()
-> XR end event
-> release XR/GL resources
-> flush AudioWorklet
-> persist PCM/JPEG records
-> structured-clone-safe checkpoint
-> same-document review
```

Qualunque nuovo codice deve rispettare questo ordine. Non serializzare `MediaStream`, `AudioNode`, `XRAnchor`, funzioni, canvas, texture o typed buffer giganti nel checkpoint principale.

## Processing geometrico

### 1. Surfel XR

I campioni XR Depth vengono proiettati con matrice di proiezione e posa del frame. Una hash grid da 5 cm aggrega posizione, RGB, normale e viste. L'inserimento ha limiti di profondita, stanza e capacita.

### 2. Fit strutturale

Per ciascun segmento del poligono acquisito:

- selezione di surfel vicini al piano verticale atteso;
- stima robusta della normale orizzontale;
- clamp di angolo e offset;
- intersezione dei segmenti fitted;
- clamp dello spostamento dei corner;
- fallback al poligono acquisito con confidenza bassa.

Il fit non ottimizza la scala.

### 3. Deep metrico

La depth relativa viene campionata nei punti con ancore metriche. Sono valutate le forme direct e inverse; il modello con residuo robusto minore e supporto sufficiente viene usato entro il range fisico. I punti Deep hanno peso inferiore a XR Depth.

### 4. Gaussiane e oggetti

I residui rispetto alla shell vengono aggregati in Gaussiane locali. L'evidenza davanti alla shell e supportata da viste distinte alimenta voxel oggetto. Le componenti non attraversano i confini di stanza.

## Processing acustico

### 1. Deconvoluzione

Per ogni finestra:

- ricostruzione esatta dell'ESS dal descrittore;
- matched filter per l'onset;
- inversione regolarizzata di Kirkeby;
- selezione del primo picco diretto significativo vicino al delay geometrico atteso;
- shift della RIR per porre il diretto a tempo zero.

### 2. Features

Si calcolano:

- energia diretta e precoce per banda;
- picchi precoci con delay relativo, energia e affidabilita;
- EDT/T20/T30/RT60 quando la dinamica lo consente;
- rumore e indicatori di clipping;
- residuo tra lag osservato e timing previsto.

### 3. Candidate generation

Le superfici principali sono suddivise in zone. Per ogni picco sono valutati:

- image source di primo ordine;
- punto speculare e appartenenza alla zona;
- percorso sorgente-superficie-ricevitore;
- Gaussiane vicine al locus compatibile;
- classe non assegnata.

### 4. Posterior

Le likelihood temporali e geometriche vengono pesate con confidenza del fit, visibilita, supporto multi-pose e affidabilita della RIR. Il prior `unassigned` usa la stessa scala delle likelihood candidate; non deve dominare per errore numerico.

### 5. Alpha

Per zona e banda, i contributi vengono aggregati robustamente. L'energia tardiva del vano e il prior visuale agiscono da regolarizzatori deboli. Il risultato conserva supporto e confidenza; non viene trasformato in etichetta certa.

## Budget smartphone

- surfel map bounded e potata;
- keyframe limitati e JPEG separati;
- massimo 12 sweep per vano di default;
- massimo 96 finestre acustiche per sessione;
- PCM Int16, non Float32 persistente;
- Deep una immagine alla volta in worker;
- Gaussiane e punti viewer sottocampionati;
- nessuna copia del checkpoint durante XR;
- nessuna doppia camera.

## Invarianti da testare a ogni modifica

- una sola chiamata `requestSession` e un solo `getCameraImage` nel percorso XR;
- `getUserMedia` solo nel modulo audio;
- nessun ONNX/FFT nel frame XR;
- checkpoint clonabile con corner annotati e clock audio;
- RIR invarianti a un ritardo hardware ignoto dopo allineamento al diretto;
- fit bounded senza cambio di scala;
- posterior corretto per una riflessione sintetica nota;
- override manuali acustici preservati;
- missing JavaScript non sostituito da HTML nel service worker.
