# SOMA 30 — Harmonic Navigation

## Avvio

1. Estrai `SOMA_30_Harmonic_Navigation` e apri un terminale **all'interno** della cartella.
2. Esegui `python3 -m http.server 8000`.
3. Apri `http://localhost:8000/SOMA_30_Harmonic_Navigation.html` in Chrome desktop.
4. Imposta un volume di ascolto fisico inizialmente basso, usa cuffie, premi **Ascolta** e scegli Meditazione, Risveglio, Attivazione o Sonno.
5. Seleziona Corpo A e Corpo B **con lo stesso seed**: nel pannello **Developer Studio / 09** leggi la tonalità PPG, la progressione, il colore biologico, gli accordi-pivot e l'evoluzione delle voci. I due corpi simulati servono a verificare differenze software, non costituiscono persone reali.
6. Lascia la riproduzione attiva per alcuni cicli armonici: il compositore prima sviluppa progressioni nella tonalità personale; modulazioni per quinte vicine possono avvenire dopo sufficienti cicli, non a ogni accordo. I cicli del Sonno sono più lunghi degli altri.
7. Disattiva la checkbox **Esplorazione armonica personale** per A/B con le progressioni fisse precedenti (il nuovo criterio di base PPG e la sintesi rimangono gli stessi). Riattiva per riesplorare il centro tonale.
8. Rimangono Developer 06 (spettro stanza e STFT), 07 (rifinitura spettrale), 08 (feedback PRV) e microfono ambientale secondario. Prima di attribuire una variazione PPG alla musica, occorre una misura PPG realmente acquisita durante l'ascolto.

## Che cosa è nuovo

- **Identità tonale deterministica dal PPG:** 8–16 impulsi validi; tempi IBI, ampiezze, larghezze, tempi di salita, variazioni e tendenza determinano tonalità iniziale, colori e alternative armoniche; non viene sorteggiata una chiave dal seed.
- **Grammatica per obiettivo:** maggiore per Risveglio; dorico per Meditazione; minore naturale e accordi a nona aggiunta per Sonno; minore con dominanti maggiori opzionali in Attivazione. Le tensioni dipendono dall'obiettivo e dal profilo.
- **Modulazioni reali:** tonalità vicine sul circolo delle quinte; accordo-pivot calcolato per identità dei tre pitch class condivisi; preparazione e risoluzione nella nuova tonalità. Limite agli spostamenti dall'area iniziale; niente migrazioni quando la misura PPG è inaffidabile o il feedback è sfavorevole (salvo possibile ritorno verso l'origine).
- **Quattro voci effettive:** le estensioni delle triadi vengono effettivamente eseguite, minimizzando i salti, premiando le note comuni e penalizzando i paralleli perfetti come vincolo musicale morbido. Le note comuni attive vengono prolungate, le altre entrano con envelope morbida, senza portamenti.
- **Provenienza esplicita:** il tema melodico viene sempre dai battiti. Il microfono contribuisce soltanto come risonanza secondaria nei punti armonicamente compatibili.

## Test

Dalla cartella del progetto: `bash TEST_RAPIDI.sh`.

Sono coperti via test automatici: accordi-pivot nelle 4 modalità e 4 spostamenti adiacenti (16 combinazioni), tonicità personale su profili biometrici differenti, stabilità/variazione della progressione, 4 modalità × 2 sorgenti simulate nella sintesi, effettiva condotta a 4 voci e note appartenenti agli accordi, un'esecuzione lunga di Attivazione (~225 s) con modulazione, test dello stop A/B, PPG scadente, finitezza audio e picchi, microfono, tracciamento spettrale, layout Chromium desktop/mobile.

Il test browser statico non è una validazione di WebAudio e microfono sul Mac. Non sono state misurate caratteristiche SPL, phon o preferenze soggettive: niente promesse terapeutiche. Il PPG live ESP32 resta lavoro aperto. La PRV non è sempre equivalente alla HRV da ECG.

## Sviluppo

Sorgenti editabili in `soma30/`: `harmonic_navigation.js` (tonalità, accordi, pivot e scelte PPG), `engine.js` (sintesi, partitura, voicing e sovrapposizioni), `harmonic_ui.js` (telemetria 09), `ui_template.html` (interfaccia), `adaptive_feedback.js` (feedback prudente ereditato da 29), `ambient_harmony.js` / `spectral_lab.js` (moduli preservati) e `rebuild.py` (HTML autonomo). Dopo ogni modifica rigenera e prova.

Il diario di riferimento **`CONTESTO_E_TRACKING.md`** include ipotesi, risultati dei test, limiti, decisioni e prossimi passi. `STORICO_SOMA29.md` contiene il diario precedente; gli ulteriori storici sono inclusi. Gli script legacy 29 in `soma30/legacy_tests_29` non sono regressioni valide per la nuova grammatica e non vengono eseguiti da `TEST_RAPIDI.sh`.
