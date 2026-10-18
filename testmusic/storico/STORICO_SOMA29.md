# SOMA 29 — Contesto persistente, decisioni e tracking

**Ultimo aggiornamento:** 18 ottobre 2026. **Release:** 29 — Adaptive Composer (prototipo di laboratorio, non dispositivo medico). **Base verificata:** SOMA 28 / Spectral Lab, con codici 26 e 27 e test conservati nell'archivio.

Questo file è la **fonte unica** per riprendere il lavoro; aggiornare la tabella di avanzamento e i risultati dopo ogni intervento, prima di consegnare il pacchetto. Non scrivere PASS senza aver effettivamente eseguito un test. Ogni proposta futura deve mantenere la provenienza dei segnali e la priorità biologica.

## 1. Visione e vincoli non negoziabili

SOMA traduce segnale biologico PPG (intervalli, morfologia, qualità) in organismi sonori, cellule melodiche, partitura armonica e paesaggio acustico. Si vuole **suonare il corpo**, poi eventualmente accompagnare l'ascoltatore verso uno stato. Un organismo, nota, battuta e scelta musicale devono restare riconducibili al PPG; microfono, meteo, orario e ambiente possono influenzare la materia, non inventare origine biologica.

SOMA 29 aggiunge un osservatore di risposta al PPG e un compositore che può ripetere un ciclo armonico, migrare a una variante e ritornare alla precedente. L'obiettivo cambia con quattro modalità: Meditazione = centro/risonanza e stabilità; Sonno = diminuzione della salienza, continuità e prevedibilità senza pretendere di identificare stadi; Risveglio = apertura progressiva; Attivazione = maggiore tensione/esplorazione senza premiare tachicardie o aumentare indiscriminatamente il volume.

Il risultato del controller è una **compatibilità osservazionale della tendenza PPG con l'obiettivo** e NON una prova che la musica ha prodotto un effetto, NON una diagnosi di stress, piacere, dissonanza soggettiva o sonno profondo. PRV-RMSSD derivata dal polso NON è automaticamente HRV-RMSSD da ECG. Le evidenze cliniche sono eterogenee: dettagli in §8.

## 2. Architettura aggiornata

**File da modificare:**

- `soma29/engine.js`: motore AudioWorklet, PPG, cellule, musica, sintesi. Include il marcatore `/*@@SOMA_ADAPTIVE_LIBRARY@@*/` sostituito durante la build.
- `soma29/adaptive_feedback.js`: controller puro e verificabile, senza dipendenze da DOM/WebAudio; `PulseWindow`, `compare`, `Controller`, `PATHS`.
- `soma29/ui_template.html`: tutte le UI 26-29, include pannello nuovo 08 sotto Spectral Lab e relativi marcatori di build.
- `soma29/adaptive_ui.js`: linea PPG/baseline, letture, provenienza, tracciatura decisioni, input facoltativo dell'ascoltatore.
- `soma29/ambient_harmony.js`, `spectral_lab.js`, `spectral_ui.js`: conservano microfono, impronta di stanza, FFT di uscita stereo, regia spettrale.
- `soma29/rebuild.py`: rigenera **unico HTML standalone** `SOMA_29_Adaptive_Composer.html` dagli effettivi sorgenti. Non modificare l'HTML compilato direttamente.
- `soma29/tests/test_adaptive29.js`, `test_regression29.js`, `test_long29.js`, `test_browser29.py`; inoltre test DSP e spettrali già esistenti.
- `STORICO_SOMA28.md` e `STORICO_SOMA27.md`: storici integrali delle release precedenti; non eliminarli.

**Percorso:** `PPG fisico / CSV o simulato → qualità e intervalli PPG → PulseWindow (baseline e misure) → Controller (trend, tempi di assestamento, decisione) → confine di ciclo musicale → HARMONIC_PATHS / varianti → voiceChord + tema PPG + sintetizzatore → EQ e compressione SOMA28 → STFT stereo`. Separatamente: `microfono → descrittori e risonanza simpatetica + detection disturbo`, `meteo → timbro lento`; nessuno è confuso con biomarcatori. L'ingresso diretto facoltativo dell'utente può imporre una riduzione morbida del livello digitale.

**Limite decisivo della release:** ingresso PPG disponibile nell'app attraverso simulazione o CSV riprodotto secondo timestamp: **non c'è ancora una sorgente live ESP32**. In modalità CSV le reazioni sono calcolate durante il replay, non è possibile verificare che la musica abbia causato quel segnale già registrato. In modalità simulata non esiste nessun ascoltatore fisiologico reale. Per chiudere sul serio il loop umano serve un ingresso PPG live con timestamp e qualità affidabili, possibilmente ESP32 via WebSocket/bridge, e un protocollo sperimentale.

## 3. Misure e criteri implementati

### 3.1 Provenienza e affidabilità

`PulseWindow.add(t, ibi, q, amp, width)` accetta intervalli tra 0,38 e 1,65 s, qualità almeno 0,76, tempo strettamente monotono, e scarta differenze fortemente anomale rispetto alla mediana recente (> max(0,13 s, 24% della mediana)). Conta gli eventi scartati. Queste soglie sono euristiche da verificare sul sensore reale; non sono un algoritmo clinico di correzione artefatti. Mantiene la cronologia degli ultimi ~200 s. Calcola le statistiche degli ultimi 40 s se ci sono almeno 15 battiti, durata coperta >=15 s e nessuna lacuna maggiore di 5 s. `bpm=60/mean(IBI)`. `PRV_RMSSD=1000 sqrt(mean((IBI_n-IBI_(n-1))²))` in ms, ma solo su coppie sufficientemente contigue e con >=12 differenze. Nessuna stima di respirazione o di stadio del sonno è dichiarata.

La baseline iniziale richiede almeno **26 battiti accettati** e una finestra valida di almeno 23 impulsi; una baseline personale è mantenuta per tutta la sessione, senza confonderla con ogni cambiamento di accordo. A ogni migrazione si salva separatamente un `reference` locale prima dell'esposizione, per il confronto fra due segmenti. Per i punteggi serve una finestra PPG recente di durata ≥22 s, ≥20 battiti, qualità media ≥0,79 e stabilità morfologica (ampiezza/larghezza). Le deviazioni estreme annullano la confidenza.

### 3.2 Regole di ricompensa (euristiche conservative)

Si calcola `ΔBPM = BPM_recente - BPM_riferimento` e il log-rapporto saturato di PRV-RMSSD, **solo quando entrambi i valori sono disponibili e >4 ms**. Punteggi `[-1,+1]`, con zona morta attorno a zero. I pesi sono **scelte ingegneristiche esplorative**, non soglie cliniche né percentuali di efficacia.

| Modalità | Segnale positivo sperimentale | Veto negativo | Forma musicale |
|---|---|---|---|
| Sonno | lieve diminuzione BPM + PRV non incompatibile | aumento BPM >5 rispetto alla finestra precedente; forti scostamenti | ancoraggi, sospensioni, pedale, ritorni morbidi |
| Meditazione | diminuzione lieve o quiete con possibile variabilità | incremento BPM e cambio morfologico | consonanze aperte, add9/add11, stabilità di centro |
| Risveglio | crescita moderata BPM (tetto 3 BPM premiati) | crescita >8 BPM rispetto alla finestra o eccesso relativo alla baseline | Imaj9→IV→ii/V e cromatismi contenuti |
| Attivazione | lieve incremento BPM (tetto 4 BPM premiati) e qualità stabile | >8 BPM rispetto alla finestra, o BPM >max(106, baseline+17); forte variabilità anomala | add11, bIImaj7, V7(b9) come tensioni progettate, con ritorno |

`score` = mix parametrico di ΔBPM e log rapporto PRV, con soglie di sovra-attivazione; la confidenza cresce con qualità, numero e continuità di impulsi. Il punteggio non è una misura psicofisiologica validata e non deve essere presentato come tale. Nel progetto futuro sostituire questa euristica con calibrazione personalizzata, distribuzioni di incertezza e una procedura di attribuzione causale (es. cross-over N-of-1).

La modalità sleep NON cerca di aumentare la PRV a tutti i costi, perché la PRV dipende anche dalla respirazione e la fisiologia del sonno non può essere inferita dalla singola metrica. L'attivazione NON usa la massimizzazione continua dell'HR: l'energia musicale cresce tramite contrasto, ritmo e tensione spettrale controllata.

### 3.3 Temporalità delle decisioni

`Controller.observe()` ogni ~1 s in AudioWorklet (solo con PPG affidabile); baseline locale iniziale; **nessun giudizio per i primi 38 s dall'esposizione**. Due valutazioni a ≥16 s l'una dall'altra prima di definire tendenza favorevole (`mean score >=+0,26`), sfavorevole (`<=−0,32`), altrimenti neutra. Disturbi microfonici `onset`/impulsi alti sospendono la valutazione: NON diventano sintomo di stress. Lo stesso vale per mancanza/qualità PPG.

La musica cambia soltanto al **confine di ciclo armonico completo** (4 accordi, ciascuno mantenuto 2 o 4 battute a seconda della modalità): non al singolo battito, e solo dopo durata minima di esposizione di 65 s e 60 s dalla migrazione precedente. La baseline del confronto viene azzerata a ogni migrazione, mentre quella fisiologica originale persiste. Risposte favorevoli ripetute possono promuovere una fase più profonda/esplorativa; risposte neutre con ripetizione prolungata possono proporre una variante; risposte sfavorevoli ripetute inducono ritorno verso il livello familiare. Nessuna migrazione con confidenza bassa. Massimo 3 livelli (0,1,2), tempi lenti e nessun tentativo di provocare effetti forti.

A parità di DNA PPG il tema resta invariato: le progressioni cambiano solo grammatica melodico-armonica, voicing tramite minimizzazione dei salti e lieve (massimo ~11%) riduzione/amplificazione del guadagno dei motivi secondo la modalità e la fase. Le sorgenti ambientali non introducono temi non biologici.

### 3.4 Override esplicito dell'ascoltatore

Il pulsante **Confortevole** salva una preferenza e può ripristinare progressivamente il gain master nominale 0,78; **Troppo intenso** riduce gradualmente il gain digitale verso 0,58 e richiede ritorno armonico al prossimo confine. Al livello 0, un voto di intensità eccessiva inibisce nuove esplorazioni per ~4 minuti. Questi pulsanti sono facoltativi e non devono essere richiesti durante il sonno. I pulsanti NON possono conoscere o garantire SPL/phon reali, perché dipendono da cuffie/amplificazione/volume fisico.

**Attenzione:** lo score fisiologico non è una prova di preferenza; il voto soggettivo esplicito ha precedenza conservativa per la limitazione dell'energia.

## 4. Perché la migrazione ha senso musicalmente

- **Persistenza:** ogni ciclo resta riconoscibile: ritornano cellula PPG e tema, voicing continuo e risonanza ambientale.
- **Contesto:** l'armonia deve poter stare ferma quando il corpo non offre evidenza, evitando il ciclo fisso che modula sempre.
- **Esplorazione controllata:** un vettore di accordi per livello (0 classico, 1 leggermente diverso, 2 più specifico all'obiettivo), sempre con 4 funzioni per non spezzare la riconoscibilità della composizione.
- **Ritiro/reazione:** se la tendenza PPG è contraria all'obiettivo, tornare a un percorso più familiare; non usare variazione rapida o impennata di volume.
- **Limite reale:** questa prima migrazione non costituisce ancora un compositore capace di trovare ottimizzazioni psicofisiologiche personalizzate nel senso sperimentale; le varianti sono curate a priori.

## 5. Tracking delle attività

| ID | Task | Stato | Evidenza / limite |
|---|---|---|---|
| 29-01 | Studiare sorgente SOMA28, priorità biologica e compositore | FATTO | `engine.js`, `ui_template.html`, test e rapporto base |
| 29-02 | Ricognizione HRV/PRV, musica/sonno e feedback | FATTO | Sezione 8; limiti di causalità dichiarati |
| 29-03 | Metriche di baseline e stato PPG robusto agli artefatti | IMPLEMENTATO + TEST UNITARIO | `PulseWindow`, `test_adaptive29.js`; dati reali da validare |
| 29-04 | Encoding di ricompense per quattro obiettivi e condizioni di veto | IMPLEMENTATO + TEST UNITARIO | `compare()`, `test_adaptive29.js`; non validato psicofisiologicamente |
| 29-05 | Esposizione lunga, intervalli di osservazione e rollback | IMPLEMENTATO + TEST UNITARIO | `Controller.observe()` / `boundary()` |
| 29-06 | Progressioni armoniche alternative (3 livelli/obiettivo) | IMPLEMENTATO + TEST DSP | `PATHS`, motore Worklet, progressione musicale coerente |
| 29-07 | Override ascoltatore e attenuazione digitale progressiva | IMPLEMENTATO UI | Messaggio del Worklet + ramp su GainNode; prova interattiva live da fare |
| 29-08 | Developer Studio / 08, trend, baseline, score e registro | PASS TEST UI STATICO | Browser Chromium 1280 e 390 px, senza overflow; live da fare |
| 29-09 | Regressione musica su 4 modalità x 2 corpi simulati | PASS TEST DSP | `test_regression29.js`, no NaN/clipping al livello del motore |
| 29-10 | Conservazione e test delle funzioni ambientali/spettrali | PASS TEST DSP | `test_ambient`, `test_real_fft`, `test_spectral`, `test_dsp` |
| 29-11 | Simulazione lunga di musica e migrazioni | PASS TEST | `test_long29.js`: 220 s wake, migrazioni ~99 e ~168 s, nessun NaN e nessuna voce armonica/basso fuori dall’accordo migrato |
| 29-12 | Test end-to-end Chrome WebAudio/microfono/cuffie | DA FARE | `test_browser29_live.py`: net::ERR_BLOCKED_BY_ADMINISTRATOR su localhost; richiede Mac reale |
| 29-13 | PPG ESP32 live, q affidabile, timebase e ritardo rete | DA FARE | Il CSV/replay non è causalmente closed-loop umano |
| 29-14 | Esperimenti N-of-1 con auto-report e stimoli controllati | DA PROGETTARE | Valutare temporizzazione, soggettività, effetto e contesto |
| 29-15 | Misura SPL reale, ascolti alla pari e qualità percettiva | DA FARE | STFT digitale e pesatura A non sono misura ISO226/phon |
| 29-16 | Indice spettrale di salienza e gestione dissonanze | DA PROGETTARE | Masking, roughness, envelopes, comfort verificati in cuffia |
| 29-17 | Rilevamento respirazione opzionale e controlli multi-sensore | DA PROGETTARE | Evitare confondere PRV con respirazione/HRV; misure validate |

## 6. Collaudo e riproducibilità

Da cartella `SOMA_29_Adaptive_Composer`:

```bash
python3 soma29/rebuild.py
bash TEST_RAPIDI.sh
python3 -m http.server 8000
```

Aprire `http://localhost:8000/SOMA_29_Adaptive_Composer.html` con Chrome (in contesto sicuro). Cuffie consigliate. Prima simulatore PPG qualità >80%, lasciare 2–4 min per osservare eventuali migrazioni; il log mostra `SIMULATO`, nessuna affermazione su un ascoltatore reale. Con file CSV di PPG, il segnale viene riprodotto, quindi non è un intervento fisiologico in circuito chiuso. Cambiare obiettivo con pulsanti modalità, verificare stato e note, attivare/spegnere A/B adattamento; provare `Troppo intenso` e la STFT post-elaborazione. Conservare una registrazione A/B con stesso seed/PPG a volume pareggiato. Il pulsante di riduzione livello non è un limite SPL e non sostituisce il controllo fisico cuffie.

Non eseguire mai `patch29.py`/`patch_ui29.py` sulla base già modificata: sono script monouso di sviluppo (da non includere nella release). Non modificare la libreria JS direttamente dentro l'HTML compilato.

## 7. Lavoro prioritario nella prossima sessione

1. Collegamento effettivo dei sensori PPG su ESP32 (timestamp, IBI e q da segnale, sincronizzazione e gestione perdita) prima di dichiarare un vero feedback corporeo umano.
2. Verifica end-to-end browser AudioWorklet/ambiente, cuffie e regressioni temporali ≥30 min incluse ripartenze, cambio mode, PPG intermittente, mic dropout.
3. Verificare se gli ascoltatori riconoscono la propria firma biologica quando il programma armonico cambia, e se le migrazioni differiscono emotivamente per obiettivo.
4. Progettare misurazione causale: segmenti ABAB o varianti randomizzate a volume pareggiato, covariate tempo del giorno e contesto, outcome soggettivi e PRV personali robusti. Nessun overfitting su fisiologia momentanea.
5. Migliorare la modellazione musicale: tensione/dissonanza separata per roughness, durata, registro e envelope; preservare le tensioni interessanti e controllare il masking più che sterilizzarle.
6. Solo dopo misure validate, adattare spazializzazione, densità, timbro, durata e livello in modo multivariato, con vincoli di volume assoluti e criterio di reversibilità.

## 8. Riferimenti scientifici studiati (fonti e portata)

- Flater B., Brean A., Quintana D.S. (2026), *Music therapy and vagally mediated heart rate variability: A systematic review and narrative synthesis*, *Int. J. Psychophysiology* 219:113288. https://pubmed.ncbi.nlm.nih.gov/41205823/ — effetti potenziali, 28 studi, alta eterogeneità e rischio di bias.
- Dickson G.T., Schubert E. (2019), *How does music aid sleep?*, *Sleep Medicine* 63:142-150. https://pubmed.ncbi.nlm.nih.gov/31655374/ — sei meccanismi proposti, evidenza mista; sostegno particolare al masking.
- Dewig H. et al. (2024), *Are Wearable Photoplethysmogram-Based Heart Rate Variability Measures Equivalent to Electrocardiogram?* https://doi.org/10.1007/s40279-024-02066-5 — PRV e HRV non sono intercambiabili; errore RMSSD sensibile a pulse arrival time.
- *Putting back respiration into respiratory sinus arrhythmia or high-frequency heart rate variability* (2024), *Biological Psychology* 185:108728. https://www.sciencedirect.com/science/article/abs/pii/S030105112300248X — influenza della respirazione sulle misure di RSA indipendentemente dalla modulazione vagale.
- *Methods for Heart Rate Variability Biofeedback (HRVB): A Systematic Review and Guidelines* (2023). https://link.springer.com/article/10.1007/s10484-023-09582-6 — metodi individuali di biofeedback e limiti dei protocolli universali. Non è prova che questa strategia algoritmica specifica sia clinicamente efficace.
- ISO 226:2023 https://www.iso.org/standard/83117.html — curve isofoniche per toni puri a SPL noto, non misura automaticamente applicabile alla STFT digitale di SOMA.

## 9. Istruzioni permanenti per gli sviluppatori

Prima di una modifica leggere questo file e `STORICO_SOMA28.md`, poi sorgenti. Registrare ipotesi e parametri, separare dati reali da sintetici e l'input ambientale dalla risposta biologica. Identificare per ogni nuovo indicatore un'attendibilità e un evento di perdita. Non dichiarare «il suono ha rilassato l'ascoltatore» basandosi sulla sola PRV. Conservare almeno una prova A/B deterministica con stesso PPG e seed. Rigenerare HTML, eseguire i test e **aggiornare** questa tabella con esito ed evidenze: non promettere test live non eseguiti. Consegnare HTML singolo, sorgenti editabili, test e ZIP completo.
