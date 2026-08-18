# Changelog V20.1.0

## Modello visuale-acustico

- Ripristinata acquisizione RIR durante la sessione WebXR, non come annotazione postuma.
- Aggiunti PCM continuo AudioWorklet, ESS breve, pose metriche e manifest per misura.
- Aggiunti due modi sorgente: telefono monostatico e altoparlante esterno fisso marcato in AR.
- Aggiunti matched filter, inversione di Kirkeby, allineamento al diretto, bande d'ottava, picchi e decadimento.
- Aggiunta associazione probabilistica a zone fisiche, facce oggetto, Gaussiane e classe non assegnata.
- Aggiunta inferenza di assorbimento efficace per zona con supporto e confidenza.

## Geometria

- Sostituito l'accumulo libero con surfel metrici bounded da XR Depth/RGB.
- Aggiunto fit robusto delle pareti limitato rispetto al poligono WebXR.
- Aggiunta calibrazione per-frame della depth monoculare, direct/inverse.
- Aggiunte Gaussiane locali per dettagli residui.
- Conservati punti RGB, mesh voxel e OBB degli oggetti.

## Stabilita post-XR

- Eliminato il reload automatico.
- Processing abilitato solo dopo evento XR `end`, cleanup e persistenza.
- JPEG e PCM salvati in record separati.
- Rimossi oggetti non clonabili dal checkpoint.
- Aggiunta serializzazione esplicita dei corner annotati.
- Aggiunto fallback al sample rate nativo quando la route Android rifiuta un `AudioContext` esplicito a 48 kHz; settings e capabilities reali restano nel RAW.
- Corretta la ricostruzione del descrittore ESS dopo salvataggio.

## Correzioni acustiche

- Il diretto usa il primo picco significativo compatibile, non il massimo globale.
- Gli echi usano delay relativo al diretto, non lag PCM assoluto.
- Il prior `unassigned` usa la stessa scala delle likelihood candidate.
- Gli override manuali non vengono sovrascritti da una nuova inferenza.

## Delivery

- Asset eseguibili versionati `v20_1_0` e alias byte-identici.
- Service worker network-first per asset critici.
- Nessun fallback HTML per JavaScript/worklet mancanti.
- Suite estesa con test sintetico app-level RIR -> superficie.

## Patch diagnostica approfondita

- Aggiunto `roomscan_diagnostics_v20_1_0.js` come modulo osservazionale separato.
- Aggiunto export manuale dalla landing e durante WebXR.
- Aggiunto bundle JSONL gzip con RAW corrente, log, stato, ambiente browser, checkpoint/JPEG e PCM/RIR IndexedDB.
- Aggiunta richiesta di conferma su errori intercettabili e anomalie XR/processing.
- Aggiunto marker di sessione per rilevare crash/chiusure non confermate e proporre l'export alla riapertura.
- Nessun `confirm()` viene tentato durante `pagehide`/`beforeunload`, dove i browser non ne garantiscono il funzionamento.
- Incrementata la cache shell con il modulo diagnostico senza modificare la pipeline geometrica/acustica.
