# SOMA 28 — Contesto persistente, diario tecnico e attività future

**Aggiornato:** 18 ottobre 2026  
**Versione:** SOMA 28 Spectral Lab (prototipo tecnico, non certificato / da validare all'ascolto)  
**Deriva da:** SOMA 27 Ambient Harmony, a sua volta derivata da SOMA 26. Il precedente file di tracking è preservato in `STORICO_SOMA27.md`.  
**Scopo del file:** mantenere la continuità fra sessioni, preservare vincoli estetici e biologici, decisioni, modifiche eseguite, risultati reali dei test, aspetti ancora non verificati e comandi per proseguire lo sviluppo. **Aggiornare questo file a ogni iterazione.**

## 1. Identità che non va perduta

SOMA **suona il corpo prima di guidarlo**. Battiti PPG attendibili → cellule/organismi con genealogia → fraseggio → composizione, con trasformazioni percettibilmente riconducibili al materiale biologico. Il microfono è un ingresso secondario: le tonalità ambientali, se affidabili, fanno vibrare una o due risonanze di cellule già generate dal PPG. Nessuna cellula, frase, accordo o gesto biologico può nascere soltanto dal suono della stanza. I suoni possono essere dissonanti o inarmonici, ma devono avere intenzione compositiva, inviluppi credibili, stratificazione spettrale curata e continuità timbrica. Le modalità Sonno / Meditazione richiedono coerenza, affidabilità e attacchi temperati; Risveglio / Attivazione possono introdurre sorpresa, dinamica e movimento senza picchi arbitrari. Non promettere effetti terapeutici; verificare sempre con ascolto reale.

## 2. Precisazioni scientifiche fondamentali

**Spettro ambientale passivo ≠ risposta in frequenza della stanza.** La curva nel Developer Studio è una **impronta spettrale relativa del campo acustico osservato** al microfono. Comprende sorgenti, posizioni, risposta del microfono, trattamento del dispositivo e rumore. Non esiste, con il solo microfono e senza eccitazione nota, una H(f)=Y(f)/X(f) identificabile univocamente. L'eventuale stabilizzazione significa solo che la statistica del suono in ingresso cambia poco. Il termine «stanza» nell'interfaccia è colloquiale, esplicitamente circoscritto.

**dBFS ≠ dB SPL ≠ phon.** L'output AnalyserNode è digitale in dBFS (rispetto al full-scale). La pesatura A illustrativa mostra un livello spettrale ponderato ma **NON** costituisce una curva ISO 226:2023. ISO 226:2023 descrive livelli SPL di toni puri con uguale sonorità, in condizioni di ascolto definite; non è un target automatico per equalizzare musica polifonica. Per una misura significativa al timpano servono sistema di riproduzione calibrato, misure acustiche appropriate e condizioni di ascolto definite. In questa release non viene visualizzato alcun valore in phon, non viene stimato un SPL e non viene dichiarata conformità ISO 226. Fonte ufficiale: https://www.iso.org/standard/83117.html

**Peak sample ≠ true peak.** Il compressore Web Audio stabilizza alcuni eccessi ma non è un limiter brickwall certificato né garantisce una misura true-peak BS.1770-5. Il controllo di livello digitale non conosce il volume impostato sull'amplificatore/cuffie: non può garantire un'esperienza soggettivamente mai «spaventosa». Fonte ITU: https://www.itu.int/rec/R-REC-BS.1770

## 3. Architettura della versione 28

- `SOMA_28_Spectral_Lab.html`: app web standalone self-contained; per audio e microfono va aperta in Chrome da `http://localhost` o HTTPS, NON direttamente come file.
- `soma28/ui_template.html`, `engine.js`, `ambient_harmony.js`, `spectral_lab.js`, `spectral_ui.js`: **sorgenti effettivi della build**. `soma28/rebuild.py` concatena le librerie in un HTML unico.
- `engine.js`: `SomaEcology` AudioWorklet, PPG, memoria multi-scala, genetica delle cellule, musica, riverbero, sintesi. Somma parziali e note, con armonie selezionate dalla stessa progressione delle voci compositive; nessun cambiamento alla struttura di note/tema rispetto alla versione 27.
- `ambient_harmony.js`: `SomaTonal.Tracker` con FFT 16384, soglie/prominenza/stabilità tonale. Nessun trasferimento audio microfonico diretto.
- `spectral_lab.js`: `SomaSpectral.RoomField`, `logBands`, `weightedA` (pesatura A indicativa per diagnostica, non correzione isofonica).
- `spectral_ui.js`: disegno Canvas, waterfall STFT, curve ambientali, parametri e instradamento della catena spettrale finale, meter dBFS. Registrazione e uscita condividono il trattamento finale.

### Flusso d'uscita della v28

`SomaEcology (stereo) → highpass 32 Hz → low shelf 145 Hz → presence bell 2950 Hz → high shelf 5600 Hz → lowpass 11,3–19 kHz → DynamicsCompressor → Gain master (.78) → due rami: Splitter L/R → due AnalyserNode (8192, uno per canale) → Merger stereo → altoparlanti; MediaStreamDestination → registrazione`.

Gli EQ guadagnano solo una quantità moderata di dB e cambiano lentamente (costante ~0,65 s); il controllo A/B regola solo **l'intensità dell'EQ**, non bypassa la compressione o l'highpass. I parametri di compressione cambiano con la modalità. Il selettore di intensità A/B non è un confronto a loudness pareggiato: per A/B percettivi serve un'ulteriore normalizzazione esterna. L'analizzatore è a valle degli effetti ma a monte del dispositivo audio e del suo volume hardware.

### Flusso di impronta ambientale

`microfono autorizzato → AnalyserNode 16384 → magnitudini FFT in dBFS → 58 bande log (90–9000 Hz) → centro robusto per banda in dB relativi → una memoria veloce τ≈1,4 s e una memoria lenta τ≈18 s → differenza RMS tra le due forme → indicatore di stabilizzazione condizionato a ≥12–23 s di osservazione`.

Sotto soglia RMS la curva non si aggiorna; il silenzio non è interpretato come una stanza piatta. In parallelo continua il tracker tonale SOMA 27, separato dalla stima di colore spettrale. La memoria viene azzerata alla disconnessione e con pulsante dedicato.

### STFT output

Il browser calcola due STFT separate, una per L e una per R, con `AnalyserNode.fftSize = 8192` e `smoothingTimeConstant=0.38`. Per la waterfall e la curva si somma la **potenza media L/R**, evitando cancellazioni artificiali di fase dovute a un downmix mono; RMS e sample peak considerano entrambi i canali. Tracciatura waterfall a 128 bande log ~65–12500 Hz, storia visualizzata circa 40 s a un aggiornamento ~125 ms; grafico istantaneo in dBFS e stessa curva traslata con pesatura A illustrativa. Letture RMS e sample peak sono calcolate in dominio del tempo. Le differenze spettrali 2,4–5,4 kHz vs 0,3–1,4 kHz e sub vs medi sono diagnostiche e **non** un giudizio di sicurezza o qualità.

### Interventi musicali nel synth

- Sonno / Meditazione: attenuazione progressiva dei parziali superiori degli organismi e delle note, lieve riduzione del drive di saturazione, attenuazione dei transitori microfonici veloci. La fondamentale resta più evidente; le dissonanze timbriche non sono completamente eliminate.
- Risveglio: equilibrio intermedio.
- Attivazione: conservazione dei parziali, drive e transitori più presenti, EQ e compressione dedicate ma con limitazione digitale a valle.
- Parziali sopra ~0,46 × fs non vengono sintetizzati: riduce la possibilità di aliasing di alte armoniche.
- L'identità delle cellule, il ritmo biologico, le loro note e la forma compositiva restano gli stessi a parità di corpo/seed.

## 4. Diario delle attività (stato verificabile)

| ID | Attività | Stato | Evidenza |
|---|---|---|---|
| 28-01 | Studio del motore v27, rischi e flusso | FATTO | Distinti campo acustico passivo, sistema di sintesi e post processing |
| 28-02 | Nuovo pannello sotto Developer Studio | FATTO | HTML + Canvas due aree e regia timbrica |
| 28-03 | Impronta di stanza rapida/lenta e convergenza | FATTO | `spectral_lab.js`, metodo `RoomField.feed`, test sintetico stazionario/cambio |
| 28-04 | STFT stereo live dell'uscita post-EQ | FATTO NEL CODICE | Due Analyzer FFT 8192 L/R, somma delle potenze, waterfall 128 bande, lettura in dBFS; collaudo audio reale aperto |
| 28-05 | Profili spettrali e dinamici per quattro modalità | FATTO NEL CODICE | EQ multipla e compressione Web Audio, transizioni lente, `spectral_ui.js` |
| 28-06 | Invilluppi timbrici, parziali e micro-onset meno aggressivi | FATTO NEL CODICE | `engine.js`, riduzione modalità riposanti e guardia alias |
| 28-07 | Indicazione percettiva onesta, senza claim di phon | FATTO | Pesatura A illustrativa e spiegazioni dentro UI |
| 28-08 | Test algoritmici e regressioni compositive | PASSATI | `test_spectral.js`, `test_dsp.js`, `test_ambient.js`, `test_real_fft.js`, `test_regression.js` |
| 28-09 | UI statica Chromium desktop/mobile | PASSATI | `test_browser28.py`, 1280 e 390 px, senza errori JS né overflow; screenshot nel pacchetto |
| 28-10 | Test browser completo audio worklet+mic | BLOCCATO DALL'AMBIENTE DI TEST | `ERR_BLOCKED_BY_ADMINISTRATOR` su localhost; non equivalente a PASS |
| 28-11 | Ascolto percettivo e taratura cuffie reali | DA FARE | Necessario utente e dispositivo reale |
| 28-12 | Calibrazione SPL/phon tramite catena nota e riferimento | DA PROGETTARE | Richiede hardware, metodologia metrologica e revisione normativa |
| 28-13 | Stima attiva di H(f) della stanza | DA PROGETTARE | Sweep/MLS, impulso di prova, riferimento, gating e feedback control |
| 28-14 | Collegamento live PPG ESP32 | DA FARE | Evitare nuovi suoni da solo ambiente |

## 5. Test automatici ed esiti

- **`node soma28/tests/test_spectral.js`**: PASS. Frequenza di riferimento pesatura A, bande log tonali, convergenza spettrale con ambiente stabile, caduta stabilità dopo cambio della sorgente, silenzio escluso dall'aggiornamento.
- **`node soma28/tests/test_ambient.js`**: PASS. Tono/silenzio/transitorio/rumore.
- **`node soma28/tests/test_real_fft.js`**: PASS. Tono a 196 Hz riconosciuto a 195,99 Hz su fixture FFT sintetica.
- **`node soma28/tests/test_dsp.js`**: PASS. Il microfono non genera organismi autonomamente, massimo due simpatetici, A/B, decadenza, note e tema stabili.
- **`node soma28/tests/test_regression.js`**: PASS. Modalità per A/B: 31/30 meditazione, 44/42 risveglio, 81/75 attivazione, 12/10 sonno. Nessuna nota fuori dall'accordo principale o campione NaN nel test.
- **`python3 soma28/tests/test_browser28.py`**: PASS layout statico 1280/390 e JS UI, NO esecuzione audio/microfono via localhost in questa sandbox, bloccata amministrativamente.

**Limiti dei test:** WebAudio EQ / compressore / AnalyserNode **non** sono stati verificati nel browser reale end-to-end. Nessuna misura di vero SPL, accuratezza ISO 226, LUFS, true peak, picchi intersample, comfort soggettivo, distorsione DAC, risposta delle cuffie o usabilità in un contesto clinico. Non dichiararli come fatti.

## 6. Prossimi sviluppi prioritari

1. **Ascolto A/B in cuffia e stesse impostazioni di volume** con seed e PPG identici, quattro modalità, regolazione EQ 0%/75%/100%; documentare artefatti, sensazione di presenza, stanchezza, transitori e impatto delle dissonanze. Registrare clip di riferimento e metriche in `VALUTAZIONE_ASCOLTO.md`.
2. **Misura audio post-elaborazione realmente eseguita** in Chrome locale con `getUserMedia`, confron­to delle STFT e registrazioni, latenza, glitch e CPU.
3. **Metrologia reale**: acquisizione con microfono calibrato / coupler per cuffie e riferimento SPL, definizione condizioni ascolto e controllo per livello; poi scegliere se visualizzare curve ISO 226:2023 (dati autorizzati) per toni puri, evitando un'equalizzazione ingenua del polifonico.
4. **Analisi percettiva e automix**: valutare masking, durate, salienza timbrica e robustezza con scenari estremi prima di aggiungere adaptive EQ; rendere misurabile la sicurezza contro transitori e introdurre eventualmente true-peak oversampling BS.1770.
5. **Acustica della stanza vera**: solo con misura attiva a volume moderato e con microfono in posizione nota (meglio diffusori, non cuffie). Distinguere chiaramente risposta del sistema di riproduzione e transfer-room.
6. **ESP32 PPG live**: bridge Wi-Fi e protocollo deterministico con provenance; attivazione della sintesi solo con misure affidabili, esperimenti con un paio di sensori PPG.

## 7. Procedura per una sessione successiva

Leggere nell'ordine questo file, `LEGGIMI.md`, `soma28/engine.js`, `soma28/spectral_lab.js`, `soma28/spectral_ui.js`, `soma28/ui_template.html`. Non ricominciare il progetto dalla descrizione astratta: preservare PPG e test regressivi. Cambiare soltanto i sorgenti; rigenerare `python3 soma28/rebuild.py`; eseguire tutti i test; aggiornare la tabella qui sopra con PASS/FAIL/DA FARE e **motivazione**; rigenerare ZIP. Evitare di rigenerare la v28 mediante vecchi script di patch v27.
