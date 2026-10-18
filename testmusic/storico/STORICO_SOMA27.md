# SOMA 27 — Contesto, decisioni, tracking e istruzioni

**Data:** 18 ottobre 2026  
**Base:** archivio `SOMA_26_COMPLETO(1).zip`; HTML originale conservato nella distribuzione.  
**Stato:** prototipo SOMA 27 integrato e testato automaticamente; verifiche audio reali e hardware ancora da eseguire.

## Identità e vincoli del progetto

SOMA è un ecosistema di sonificazione e composizione biologicamente discendente: PPG attendibile → cellule/organismi con genealogia → tema, interazioni, armonie e sintesi materica. Le quattro modalità (Meditazione, Risveglio, Attivazione, Sonno) cambiano regia e densità. La musica non deve diventare generazione autonoma regolata superficialmente dal battito: il gesto, la stabilità e l'evoluzione devono restare interpretabili in relazione a segnali biologici realmente acquisiti. La mappatura musicale è creativa e non pretende di inferire emozioni dalla fisiologia. Il microfono, opzionale e autorizzato, è una **fonte secondaria**; non crea organismi o temi. L'assenza o bassa qualità PPG deve continuare a bloccare nuove attività biologiche.

### Obiettivo di questa iterazione

Individuare **componenti tonali persistenti del suono ambientale** e farle emergere come **risonanze simpatetiche** di non più di due organismi PPG già vivi; gli organismi devono continuare a mantenere ritmo, inviluppo, articolazione, timbro e genealogia biologici. Non alterare accordi, motivo, forma, impulsi o ritmo del compositore. Privilegiare frequenze compatibili con l'accordo attuale, per evitare battimenti dissonanti e note esterne arbitrarie. Possibilità di confronto A/B disattivando le risonanze ambientali. Nessuna cattura di frammenti e nessun audio microfonico reinstradato senza l'autorizzazione separata esistente.

> Terminologia: un microfono passivo osserva il **campo tonale presente**, NON misura direttamente i modi della stanza. L'identificazione delle risonanze proprie dell'ambiente richiederebbe un successivo esperimento attivo calibrato e gestione dell'eco.

## Architettura originale (riscontrata sul codice)

- Pagina HTML offline/self-contained con synth `AudioWorkletProcessor` incorporato nel `<script id="engine-source">` e script UI inline.
- `SomaEcology`: PPG simulato o import CSV, gating qualità, memoria 2/12/90/900 s, popolazione, DSP, accordi per modalità, partitura.
- Input ambientale browser: `getUserMedia`, `AnalyserNode` FFT 2048 per energia/flatness/centroide/onset; microfono anche collegato al Worklet solo per onset sul thread audio. Secondo tap worklet opzionale per frammenti con consenso distinto.
- Cicli musicali: esposizione, risposta, metamorfosi, ritorno; quattro progressioni definite in `HARMONIC_PATHS`.
- Limiti: non presente un ingresso ESP32 live; test originali su PPG sintetici; riproduzione web AudioWorklet da validare su hardware reale.

## Registro delle attività

| ID | Attività | Stato | Evidenza / note |
|---|---|---|---|
| 01 | Ispezionare archive, componenti DSP, UI e test | COMPLETATO | Studio dell'HTML, `composer.js`, build e stress originari |
| 02 | Predisporre log Markdown aggiornabile | COMPLETATO | Questo file è incluso nel pacchetto |
| 03 | Implementare analisi tonale separata con tracking temporale e gate | COMPLETATO | FFT 16384, finestra temporale ~1,6 s, estrazione di picchi, interpolazione, guardia contro transitori e scadenza |
| 04 | Integrare risonanze simpatiche legate al PPG in DSP | COMPLETATO | Fino a due organismi selezionati; dissolvenza e crossfade 2,6 s. Breve coda degli organismi precedenti può sovrapporsi al cambio di selezione. |
| 05 | Aggiungere controllo A/B e telemetria di provenienza | COMPLETATO | Checkbox A/B, slider 0–100%; frequenze ambientali rilevate separate da frequenze attribuite alle cellule attive |
| 06 | Test automatizzati su toni, transitori, silenzio, gating e regressione | COMPLETATO | `test_ambient.js`, `test_real_fft.js`, `test_dsp.js`, `test_regression.js`; tutti superati |
| 07 | Costruire HTML autonomo, distribuire sorgenti e istruzioni | COMPLETATO | HTML self-contained, template + motore + tracker, rebuild, `LEGGIMI.md`, ZIP |
| 08 | Test con microfono, PPG reali e ascolto in cuffia sul Mac | DA FARE | Necessaria validazione locale dall’utente su hardware reale |

## Criteri di accettazione

1. Senza permesso microfono o con ingresso silenzioso non compaiono risonanze ambientali.
2. Un tono stabile con energia sufficiente viene rilevato e mostrato con confidenza; un clic transitorio e rumore non producono una risonanza persistente.
3. Con PPG assente/inattendibile il microfono da solo non produce nuove cellule o composizione.
4. La risonanza appartiene a un organismo biologico e segue la sua ampiezza; la frequenza resta fissa mentre suona. Scomparsa ambientale → dissolvenza; cambio → sovrapposizione.
5. Solo frequenze compatibili con gli accordi vengono effettivamente usate; componenti rilevate ma incompatibili devono essere visibili come tali.
6. A/B attivo/disattivo riproducibile con stesso seed e stesso PPG, almeno a livello di test sintetico senza ingressi live.
7. Il bundle è autonomo, il codice sorgente e i test rimangono disponibili, e questo file riporta risultati e limiti aggiornati.

## Attività successive (non comprese nel primo intervento)

- Ascolti ciechi con registrazione stereo A/B, valutazione di intonazione, interferenze, transizioni e intelligibilità del PPG.
- Protezione dal ritorno degli altoparlanti: la prima verifica va condotta in cuffia. Un eventuale controllo automatico dell'echo richiede riferimenti audio / latenza stimata: non dichiararlo affidabile prima di validarlo.
- Integrazione di dati PPG live dall'ESP32 su Wi-Fi; gestione qualità/sincronia e bridge browser separato.
- Eventuale uso del campo tonale per le inversioni armoniche (solo dopo valutazione A/B della risonanza).
- Identificazione attiva delle risonanze proprie della stanza come progetto dedicato, distinto dalla rilevazione di toni ascoltati.

## Avvio e sviluppo

Istruzioni operative complete in `LEGGIMI.md`. Avviare con `python3 -m http.server 8000` dalla cartella del progetto, poi aprire l’HTML in Chrome all’indirizzo `http://localhost:8000/SOMA_27_Armonie_Ambientali.html`. Per rigenerare: `python3 soma27/rebuild.py`. L'utilizzo in cuffia limita il rischio di auto-rilevamento del suono sintetizzato.

## Dettagli implementativi e decisioni

**Rilevamento**. Il vecchio `AnalyserNode` da 2048 campioni continua a servire la dinamica rapida (onset/centroide). Un secondo `AnalyserNode` da 16384 campioni viene usato per individuare massimi locali spettrali da 95 a 1250 Hz. La prominenza del picco rispetto ai bin vicini, l'ampiezza minima e la stabilità su almeno 1,6 s con più rilevamenti consecutivi riducono falsi positivi. Il tracker invia solo frequenza e confidenza (massimo 3 toni) al Worklet, non campioni microfonici.

**Sintesi**. Il Worklet richiede una firma PPG attendibile, un accordo esistente, un tono ancora recente e una compatibilità di circa 38 cent con un grado dell'accordo. Cerca la migliore trasposizione per ottava entro il registro dell'organismo e ne eccita una risonanza sinusoidale *a frequenza fissa* con l'inviluppo ecologico dell'organismo. Sono selezionati al massimo due organismi per volta; su un cambio di selezione le vecchie code sfumano, quindi possono esserci sovrapposizioni brevi. L'ampiezza varia lentamente; il cambiamento di intonazione è un crossfade e non un portamento. I toni incompatibili vengono visualizzati come **rilevati** ma **non usati**.

**Correzione contestuale aggiuntiva**. `pickPitch()` degli organismi usava una tabella armonica indipendente dai veri accordi di `HARMONIC_PATHS`. È stato modificato per chiamare `midiInChord()` con l’accordo della partitura corrente; le risonanze biologiche e la partitura ora condividono il riferimento armonico. Questo modifica alcune altezze ecologiche originali ma non la partitura PPG generata, e andrà valutato all'ascolto.

**Tutela/provenienza**. Microfono disattivato all'avvio, attivabile solo su richiesta. Analisi e sintesi locali. Il checkbox di recupero di microframmenti, separato, rimane non autorizzato fino a consenso esplicito. Non vengono inviate frequenze a server. Il tracker non deduce il riverbero o modi fisici della stanza e non corregge automaticamente eventuali ritorni dagli altoparlanti.

## Evidenze dei test del 18/10/2026

- **Unit test tracker:** PASS per silenzio, rumore piatto, impulsi tonali isolati, tono 196 Hz persistente, miscela 196/293,66 Hz, perdita del tono e scadenza delle tracce.
- **FFT realistico:** PASS su campioni sintetici sinusoidali 196 Hz + rumore casuale, FFT 16384 punti con finestra Blackman (48 kHz): frequenza bloccata 195,99 Hz.
- **DSP (Node VM, 4 kHz sintetico):** PASS con e senza microfono, A/B off, PPG non attendibile, cessione dell'energia alla disconnessione, incompatibilità armonica, pitch per ottava, nessun campione non finito o clipping. Le composizioni con e senza ingresso ambientale hanno uguali numero di note e contorno del tema.
- **Stress originale della 26 sul nuovo motore:** PASS per 4 modalità × 2 corpi, stesso seed; esattamente gli stessi conteggi `31/30`, `44/42`, `81/75`, `12/10`, nessuna nota strutturale estranea all'accordo e nessun clipping.
- **Chromium statico:** PASS su desktop (1280 px) e mobile (390 px) con `page.set_content`: libreria, pagina, checkbox, slider e assenza overflow/errors. Browser in sandbox ha risposto `ERR_BLOCKED_BY_ADMINISTRATOR` sia per HTTP localhost sia per `file://`; perciò NON è stato possibile collaudare end-to-end l'inizializzazione del vero AudioWorklet e `getUserMedia` in browser.
- **Non verificato:** ascolto reale, effettivo riconoscimento di toni su microfono fisico, condizioni con diffusori/eco, prestazioni CPU su dispositivi mobili, PPG live.

## Piano di validazione di ascolto (prossima sessione)

1. Mac + Chrome + cuffie, microfono autorizzato e output audio in cuffia. Con Corpo A simulato tenere il seed fisso, aspettare almeno 30–60 s. Alternare A/B e verificare transizioni fluidissime e compatibilità armonica quando l'accordo cambia.
2. Far riprodurre a una sorgente esterna un tono moderato per 4–5 s; osservare distinzione `Rilevati` vs `Accoppiati al PPG`. Poi interrompere il tono: la risonanza deve spegnersi senza nuovi attacchi.
3. Provare silenzio, parlato, ventilazione e rumore stradale. Non forzare sempre una nota: in scenari non tonali, **nessun accoppiamento** è la risposta corretta.
4. Ripetere con PPG reale quando disponibile. La musica deve riflettere il segnale corporeo e il microfono solo le risonanze secondarie; registrare feedback sull'equilibrio sonoro e sulle modulazioni.
5. Se la risonanza è troppo poco udibile, ottimizzare **il suo livello / il rapporto con la partitura** con ascolti A/B; non aumentare automaticamente la densità di note o aggiungere composizioni autonome.

