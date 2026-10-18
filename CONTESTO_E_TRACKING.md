# SOMA 31 — Contesto operativo, decisioni, tracking e istruzioni per continuare

**Data:** 2026-10-18  | **Release:** SOMA 31 / Somatic Onset  | **Base:** SOMA 30 Harmonic Navigation.

## 1. Identità non negoziabile

SOMA suona anzitutto il corpo, e solo successivamente lo accompagna verso un obiettivo. Le cellule, i motivi, le voci e le risonanze devono restare causalmente riconducibili al PPG attendibile acquisito; il microfono e il meteo intervengono come sorgenti secondarie. La varietà timbrica deve essere musicale e materica, non un insieme di effetti fine a sé stesso. Nessun materiale non biologico avvia autonomamente una composizione.

**Nuova priorità SOMA 31:** l'avvio deve rendere chiaramente percepibile che la musica sta nascendo da *questo* corpo, *in questo* stato. Non iniziare la musica prima di avere misurato un profilo temporale/morfologico sufficientemente attendibile. Mettere il battito in primo piano nella fase iniziale; armonizzare e trasformare gradualmente solo dopo.

## 2. Come prosegue il sistema (flusso reale)

```
PPG simulato o CSV letto dal browser (NO live ESP32 in questa release)
    -> validazione battiti e finestra mobile PulseWindow
    -> ONSET GATE: >=38 s, >=30 impulsi accettati, >=30 s di campioni
       nella finestra recente, >=27 validi, qualità media >=0.84,
       ultimo valido <=2.6 s, controllo robusto IBI/ampiezza
    -> prima della validazione: SOLO impulso cardiaco diretto udibile
       nessun organismo, nessuna partitura, nessuna nota armonica
    -> commit del profilo: media IBI, BPM, PRV-RMSSD esplorativa,
       mediana/MAD IBI, ampiezza/forma, qualità, mobilità compositiva
    -> DNA armonico dal PPG recente; primo organismo; 3 s di sola origine
    -> emersione delle note: fade-in dolce per ~23 s,
       impulso diretto che persiste e svanisce più lentamente (~51 s)
    -> navigazione tonalmente coerente e feedback del PPG a finestra ritardata
    -> tempo della musica, densità e armonia evolvono lentamente
       verso l'obiettivo SOLO con segnali sufficientemente affidabili.
```

Una baseline di 38 s costituisce una soglia *progettuale per l'avvio musicale*, non una finestra clinicamente validata per HRV. Il riferimento metodologico più solido per HRV a breve termine rimane spesso >=5 minuti in condizioni controllate. SOMA etichetta le misure come PPG/PRV e non come verità psicologica. Fonti: https://journals.physiology.org/doi/full/10.1152/ajpheart.00041.2026 e https://pmc.ncbi.nlm.nih.gov/articles/PMC11539922/ .

## 3. Feedback: stato osservato vs direzione desiderata

Il **PPG misurato determina l'attacco**: istanti di impulso, forza e inviluppo della pulsazione, velocità iniziale del battito musicale, tema, centro tonale, varietà delle parti, grado iniziale di densità. Il **modo** determina una direzione obiettivo *musicale*, non prescrive una modifica del battito cardiaco reale.

Per il tempo musicale, in notazione illustrativa:

```
B_0 = frequenza cardiaca media dalla baseline (BPM)
B_obs = stima recente (BPM), se affidabile
r(t) = smoothstep((t - ingresso_musica - 24 s) / 185 s)
F(t) = matching recente, da 0.80 a 0.27 in ~100 s
c(t) = 1 normalmente, 0.16 se feedback avverso affidabile,
       0.08 dopo giudizio esplicito "troppo intenso"
B_target(t) = B_0 + F(t)*(B_obs - B_0) + B_0*g(mode)*r(t)*c(t)
g(activate)=+0.075; g(wake)=+0.045
 g(meditate)=-0.045; g(sleep)=-0.085
```

Il target è limitato a ±11 BPM rispetto alla baseline; in modalità attivanti il drift viene ridotto quando la baseline è già alta (intervallo di cautela 90–112 BPM). Il tempo realmente suonato converge lentamente verso il target, senza salto istantaneo. **Non è un protocollo medico né una garanzia di entrainment o variazione fisiologica causata dal suono**.

La regia spettrale e l'energia iniziano da un profilo compositivo costruito con BPM iniziale, variabilità robusta degli intervalli e della morfologia. L'indice di mobilità *non misura direttamente eccitazione emotiva, livello simpatico o stadio del sonno*. Questo indice differenzia inizializzazioni con la stessa FC media ma variabilità/forma diverse. Le quattro modalità conservano evoluzioni musicali differenti e gli accordi-pivot reali di SOMA 30.

**Armonie di Attivazione**: centro maggiore luminoso, cadenze dominanti, successiva esplorazione di funzioni/tonalità vicine. **Sonno/Meditazione**: prevalenza di stabilità, continuità timbrica e tempo lentamente discendente. La risposta soggettiva resta disponibile tramite i pulsanti di SOMA 29. La valutazione ritardata può riconoscere trend fisiologici coerenti/incoerenti con la direzione, *non* effetti causali provati.

## 4. Architettura effettivamente modificata

- `soma31/somatic_onset.js` (nuovo): `SomaOnset.Gate` e controllo temporale di avvio, con funzioni pure in audio thread e stato esposto.
- `soma31/engine.js`: acquisizione del primo profilo, transizione affidabile, niente organismi prima del gate (anche nel ciclo ecologico), forma dell'impulso guidata da ampiezza/larghezza/salita, primo attacco armonico differito, mix musicale crescente, tempo inizialmente allineato al cuore, valutazione PPG successiva alla partenza, gain degli organismi basato sul profilo iniziale.
- `soma31/harmonic_navigation.js`: Attivazione con scala maggiore e armonizzazione più luminosa, senza perdere modulazioni comuni/pivot.
- `soma31/somatic_ui.js` (nuovo): Developer Studio /10 e indicatore di avvio nel pannello d'ascolto, dati etichettati per provenienza.
- `soma31/ui_template.html`: testo e controlli di visualizzazione; `rebuild.py` compila un HTML autonomo.
- `soma31/tests/test_onset31.js` (nuovo): controlli su gating, attacco PPG, risposta per obiettivi, feedback avverso, CSV incompleto, differenze A/B e finitezza audio.
- `soma31/tests/test_dsp.js`, `test_integration30.js`, `test_browser30.py`: regressioni adattate alle tempistiche del gate e alla disponibilità della scala maggiore per Attivazione. Restano presenti i vecchi test (SOMA 26–30).

È stata corretta anche la regola delle **note comuni mantenute**: una voce può essere legata durante la sua fase di rilascio, non soltanto entro `hold+0.2 s`. Il test lungo conta 24 note comuni effettivamente prolungate in una simulazione; tale numero dipende dalla configurazione.

## 5. Registro cronologico delle attività

### Completato [x]
- [x] Esaminato SOMA 30: music score già dopo 8 impulsi, organismi ecologici già dopo 2, attivazione con tempo musicale immediatamente accelerato.
- [x] Definita la separazione *acquisizione / ingresso / navigazione*.
- [x] Implementato gate robusto su qualità/durata, senza fallback inventati se manca PPG.
- [x] Eliminata anche la nascita degli organismi nel timer ecologico durante l'acquisizione.
- [x] Implementato impulso udibile prima della musica con ampiezza e forma legate al PPG.
- [x] Inizializzazione del DNA post-baseline e non più sui primi soli 8 battiti.
- [x] Allineamento iniziale del tempo alla baseline e al PPG più recente, deviazione musicale lenta e moderata, diversa per modalità.
- [x] Protezione del drift attivante quando la frequenza cardiaca iniziale è alta.
- [x] Attivazione con accordi diatonici maggiori e tensioni risolte, sempre personali per PPG.
- [x] Integrazione con score ritardato, controller del feedback e modulazioni SOMA 30.
- [x] UI / 10 con fase, progresso, baseline, affidabilità, tempo reale / musicale / obiettivo e distinzione CSV vs simulazione.
- [x] Eseguita la suite completa da shell: **9 gruppi PASS**.
- [x] Verificato layout statico a 1280 e 390 px con Chromium e assenza errori JS statici.

### Da eseguire [ ]
- [ ] **Collegare ESP32 PPG live** via WebSocket/Wi-Fi con sequenza, timestamp monotoni, qualità e segnalazione dropout. Senza live non è possibile dimostrare reale closed loop con l'ascoltatore.
- [ ] Registrazioni umane etichettate, confronti A/B a parità di segnale e seed e misure soggettive su comfort, sonno e attivazione.
- [ ] Calibrazione dell'intensità SPL e risposta in frequenza di cuffie/dispositivo prima di rivendicare target phon o sicurezza percettiva.
- [ ] Esaminare la robustezza all'artefatto PPG, al movimento e alle aritmie; confrontare PPG/PRV con riferimento ECG quando rilevante.
- [ ] Definire protocollo fisiologico multi-minuto per apprendimento di caratteristiche affidabili e adattamento dinamico delle soglie personali.
- [ ] Quantificare il legame tra cambiamenti della musica e risposta fisiologica controllando respirazione, attività fisica, orientamento e confondenti.
- [ ] Ascolto reale per attacchi, code, transitori ed envelope del battito; tarare volume, contrasto ed evoluzione per ogni modalità.
- [ ] Valutare la migrazione armonica in più sessioni per evitare una ripetizione troppo lunga o un'esplorazione eccessiva.

## 6. Test riproducibili

Aprire un terminale dentro `SOMA_31_Somatic_Onset/` e lanciare `./TEST_RAPIDI.sh`. Il comando rigenera l'HTML e lancia 9 gruppi: onboarding PPG31, feedback PPG29, armonia/voci30, spettrogramma, toni, FFT, DSP, simulazioni lunghe e Chromium statico. Log ultimo test: **9/9 PASS**, senza campioni non finiti nelle simulazioni. Un test 225 s produce almeno una modulazione e prolunga note comuni. Non sono test live con persona, ESP32 e cuffie.

## 7. Principali scelte e limiti

1. Le soglie 38 s / 30 impulsi si possono parametrizzare dopo la prova pratica; non estendere automaticamente la raccolta con «dati» simulati se il PPG è assente.
2. La PRV a finestra breve serve a caratterizzare e monitorare il comportamento *relativo* del PPG; non va attribuita direttamente a vagotonia o rilassamento clinico.
3. Audio del battito non silenziato durante l'acquisizione salvo scelta esplicita dell'utente. Nessun respiro fisiologico viene inventato: la voce `breathe` è musicale.
4. SIMULAZIONE e CSV hanno provenienza chiaramente segnalata: il CSV può contenere una persona, ma non può cambiare in risposta ai suoni generati durante la riproduzione.
5. Attivazione cerca una percezione di maggiore luce, energia e movimento; maggiore frequenza musicale non deve significare «forzare» una maggior frequenza cardiaca.
6. La logica di armonia e la guida spettrale rimangono separate; la migrazione si basa su qualità PPG e controllo del feedback, non sulla novità arbitraria.

## 8. Come riprendere il lavoro

1. Leggere questo file e `LEGGIMI.md`.
2. Modificare i sorgenti sotto `soma31/`, **non** direttamente l'HTML compilato, poi eseguire `python3 soma31/rebuild.py`.
3. Lanciare `./TEST_RAPIDI.sh`.
4. Verificare prima la soglia di acquisizione e il matching del battito; poi la composizione, la qualità dello spettro e il feedback verso l'obiettivo.
5. Aggiornare le sezioni "completato", "da eseguire", formule, risultati e limiti di questo documento in ogni iterazione successiva. Conservare `STORICO_SOMA30.md` e gli storici precedenti.

---

## 9. Distribuzione GitHub Pages — 18 ottobre 2026

### Obiettivo

Trasformare SOMA 31 in un sito statico caricabile direttamente nel repository GitHub e utilizzabile via HTTPS **senza eseguire alcun server sul computer dell'ascoltatore**. Questa iterazione non cambia il compositore, il PPG gate, le modalità o i sintetizzatori; cambia soltanto la confezione di distribuzione e i messaggi di compatibilità.

### Modifiche completate [x]

- [x] Portato l'HTML compilato al nome convenzionale `index.html` nella radice del repository. File autosufficiente: CSS e JS inline; processore AudioWorklet creato tramite Blob e `audioWorklet.addModule`, non recuperato con una chiamata di rete a file locali.
- [x] Creato `.nojekyll` per la pubblicazione statica da `main / (root)`.
- [x] Preservati i file sorgente `soma31/` e i test in modo da evitare modifiche dirette all'HTML compilato. `soma31/rebuild.py` ora rigenera `index.html` nella radice.
- [x] Adattati i riferimenti a `index.html` nei test dell'integrazione, DSP, onset e UI statica.
- [x] Aggiornati i messaggi di errore da `localhost` a HTTPS/GitHub Pages e introdotto un controllo esplicito `window.isSecureContext` prima dell'inizializzazione AudioWorklet. Nessuna modifica intenzionale delle mappe PPG, delle progressioni armoniche o dei filtri audio.
- [x] Creati `README.md` (procedura di pubblicazione, permessi microfono, privacy e troubleshooting), `verifica_pacchetto.py` (audit statico) e `TEST_RAPIDI.sh` (regressioni di sviluppo); archiviati gli storici in `storico/`.
- [x] Confermato con ispezione statica che il sito non richiede script, CSS, librerie o asset da `/` o da un server locale; l'unico traffico opzionale è verso Open-Meteo se il meteo viene richiesto. Il CSV è caricato nel browser tramite selezione locale di un file.
- [x] Il file `index.html` è pubblicabile nella radice o sotto un prefisso (`https://utente.github.io/repository/`), perché non impiega path assoluti per il motore e i pannelli.

### Verifiche e limiti

- Validazione statica con `python3 verifica_pacchetto.py`: **PASS**.
- Regressioni principali: `./TEST_RAPIDI.sh` eseguito integralmente dopo la conversione Pages: **9/9 PASS** (onset31, feedback29, armonia30, Spectral Lab, toni ambientali, FFT, DSP, simulazione lunga e layout statico Chromium a 1280/390 px).
- Tentativo di collaudo E2E del sito con Chromium all'indirizzo locale `http://127.0.0.1:8899/SOMA_31_GitHub_Pages/` e su un'origine HTTPS intercettata: **non eseguibile in questo ambiente**, perché Chromium restituisce `net::ERR_BLOCKED_BY_ADMINISTRATOR` prima del caricamento della pagina. Questo limite non è un risultato negativo sulla compatibilità di GitHub Pages e **non autorizza a dichiarare testato AudioWorklet e microfono sul sito effettivamente pubblicato**.

### Da eseguire [ ]

- [ ] Pubblicare il contenuto della directory su GitHub e abilitare Settings → Pages → Deploy from a branch → `main`, `/(root)`.
- [ ] Aprire l'URL HTTPS restituito da GitHub, verificare l'entrata del processore AudioWorklet e la riproduzione del battito in SIM, quindi il gate 38+ s e l'entrata armonica.
- [ ] Abilitare facoltativamente il microfono e controllare permessi, tonal tracking, risposta spettrale della stanza e STFT d'uscita; verificare che il microfono non introduca feedback acustico (preferire cuffie).
- [ ] Provare il sito su Chrome/Edge desktop e sui browser mobili d'interesse (Safari/iOS da verificare separatamente).
- [ ] Riprendere gli sviluppi originali: PPG live ESP32 tramite collegamento di rete, calibrazione SPL, valutazione con soggetti reali e stabilità del feedback autonomico. GH Pages fornisce solo hosting statico; non è un bridge verso l'ESP32 e non risolve da solo connettività, mixed content o permessi di rete locale.

### Come riprendere

Lavorare in `soma31/`, eseguire `python3 soma31/rebuild.py`, poi `./TEST_RAPIDI.sh`. La pubblicazione richiede solo un commit del nuovo `index.html`; non è necessaria una build GitHub Actions. Il modulo principale e il suo comportamento fisiologico non cambiano in questa release di packaging.
