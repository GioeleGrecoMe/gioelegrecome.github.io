# SOMA 30 — Contesto, decisioni e tracking permanente

**Release:** SOMA 30 — Harmonic Navigation, 18 ottobre 2026. **Stato:** prototipo software completato e test automatizzati superati; qualità musicale e circuito chiuso con persona reale **non ancora validati**.

## 1. Obiettivo permanente

SOMA suona **prima il corpo** e soltanto dopo lo guida, se e quando la risposta corporea è osservabile. La musica deve nascere dai dati PPG realmente rilevati: intervalli fra impulsi, variabilità, morfologia, energia, affidabilità e relativa memoria nel tempo. I temi restano riconducibili al corpo anche quando si trasformano in frasi ed ecologie sonore. Il microfono è secondario: influenza le risonanze e segnala disturbi, non costruisce indipendentemente il materiale biologico. Il meteo e l'ora aggiungono ambiente su tempi lunghi.

In SOMA29 quattro accordi per livello ritornavano identici; la tonalità nasceva da cinque opzioni grossolane; il vecchio `voiceChord()` utilizzava le prime tre note dell'accordo, quindi le estensioni non venivano suonate dalle parti armoniche. Obiettivo SOMA30: vera identità tonale individuale, armonia formale con sviluppo, modulazioni lente a chiavi prossime via accordi-pivot, voice leading a quattro parti ed evoluzione con feedback, senza costruire musica autonoma scollegata dal segnale.

## 2. Architettura reale

`SOMA_30_Harmonic_Navigation.html` è l'app autonoma per Chrome su localhost. NON modificarla come sorgente primaria: la genera `python3 soma30/rebuild.py` a partire da:

- `soma30/harmonic_navigation.js`: `SomaHarmony` (profilo biometrico, centri tonali, accordi diatonici, accordi-pivot e sequenze per obiettivo).
- `soma30/engine.js`: AudioWorklet, PPG, organismi, vera armonizzazione a 4 voci, bassi, melodie, inviluppi, sintesi e reports di telemetria.
- `soma30/adaptive_feedback.js`: baseline PPG, `PulseWindow`, tendenze PRV, valutazioni ritardate, conservazione/ritorno del percorso.
- `soma30/harmonic_ui.js`: sezione Developer 09 e A/B della navigazione.
- `soma30/ui_template.html`, `soma30/adaptive_ui.js`: UI principale e Developer 08.
- `soma30/ambient_harmony.js`, `soma30/spectral_lab.js`, `soma30/spectral_ui.js`: ambiente, STFT, controllo spettrale preservati.
- `soma30/tests/`: test unitari e funzionali correnti. `soma30/legacy_tests_29/`: vecchie regressioni su progressioni fisse non più applicabili, solo per tracciabilità storica.

Anche `STORICO_SOMA29.md`, `STORICO_SOMA28.md`, `STORICO_SOMA27.md` e le versioni HTML precedenti sono inclusi per continuità.

## 3. Personalizzazione fisiologica implementata

`SomaHarmony.profile(pulses)` elabora gli ultimi 8–16 impulsi con qualità >= 0,75, IBI tra 0,38 e 1,65 s e valori morfologici presenti. Estrae: media IBI, media ampiezza PPG, larghezza, tempo di salita, dispersione IBI e variazione da impulso a impulso, complessità della forma e tendenza recente. Il `hue` normalizzato combina queste dimensioni in modo trasparente:

`hue = .34*tempo + .25*ampiezza + .20*larghezza + .15*variabilita + .06*salita`, con ogni termine normalizzato e limitato a [0,1]. Il centro tonale iniziale prende una delle 12 classi di altezza con `floor(12*hue)`. È una **mappatura artistica ingegnerizzata**, non una relazione empirica fra ECG/PPG e preferenza tonale. La diversità non deriva dal random seed. `color` deriva dalla variabilità e dalla morfologia, e guida selezione di funzioni/estensioni delle frasi. Il tema e i gesti continuano a derivare da PPG come nelle versioni precedenti.

La finestra si rinnova. Se il PPG perde qualità, il sistema non crea né muta una firma inventata: non può generare nuova musica biologica. La versione corrente si basa su PPG simulato oppure CSV replay, **non su PPG live ESP32**.

## 4. Grammatica armonica e migrazione

- Modalità **Sonno**: minore naturale, toniche aperte con nona aggiunta senza una settima minore obbligatoria, funzioni poco tese (III/iv/VI) e permanenza lunga; intervalli più ampi fra cambi.
- **Meditazione**: scala dorica, accordi con nona aggiunta e funzioni di colore all'interno di un centro stabile; armonie aperte e transizioni lente.
- **Risveglio**: armonia maggiore, sostituzioni di accordi diatonici più vivaci, traiettorie verso dominante e tonicizzazione.
- **Attivazione**: minore, maggiore attività armonica, settime/nove, dominante maggiore contestuale (sensibile introdotta solo dove richiesto), tensioni musicali dirette verso risoluzione.

`Navigator.plan()` prepara 4 accordi di una frase, cambiando funzioni e possibili estensioni in base all'impronta PPG e al ciclo musicale. Dopo sufficiente permanenza (almeno due cicli completi di quattro accordi) può cambiare verso una tonalità **adiacente sul circolo delle quinte** (±5 o ±7 semitoni equivalenti come classi di altezza). Non può accumulare spostamenti oltre ±10 semitoni dall'area iniziale; nessun salto armonico lontano.

Per modulare, `pivotBetween()` costruisce triadi diatoniche nelle **due tonalità** e verifica l'identità esatta dell'insieme di tre pitch classes. Scelta una triade veramente condivisa (preferibilmente con funzione predominante), il ciclo passa attraverso pivot → funzione di preparazione → dominante/modale → nuova tonica. In mancanza di triade comune, il salto è rinviato. Il profilo PPG decide variante e direzione. Risposta PPG sfavorevole con confidenza sufficiente inibisce nuova esplorazione e può suggerire un ritorno verso l'origine; l'indicazione esplicita “Troppo intenso” ha priorità conservativa per ~240 s. Una fluttuazione casuale non è prova che un certo accordo abbia provocato il cambiamento.

Le tonalità seguono una teoria musicale di riferimento **occidentale** e una scelta artistica sperimentale; non si tratta di leggi universali del piacere o dell'efficacia terapeutica.

## 5. Condotta delle parti e spettro

`SomaEcology.voiceChord()` realizza **quattro note vere** per l'accompagnamento (radice, terza, quinta/settima e settima/nona secondo i casi). Minimizza i salti fra le quattro parti, penalizza salti ampi e quinte/ottave perfette parallele e premia note comuni a pitch identico. I vincoli di contrappunto classico sono **penalità morbide**, non garanzia di assenza assoluta di ogni parallelo. La singola nota resta sempre stabile: niente portamenti continui. All'entrata di un nuovo accordo le note comuni attive vengono **prolungate** (contatore cumulativo `tiedTones` esposto in Developer 09 e verificato da `test_integration30.js`), le altre subentrano con attack e release sovrapposti; sul pivot gli attacchi sono più morbidi e la brillantezza leggermente inferiore. Le voci dei motivi e gli organismi vengono entrambi riarmonizzati sui toni del nuovo accordo. La sorgente microfonica continua ad accoppiarsi solo ai toni ambientali compatibili.

L'EQ e la compressione di SOMA28 rimangono disponibili; la STFT post-elaborazione monitora il segnale digitale stereo. Non è una calibrazione SPL/phon; le curve isofoniche ISO226 non misurano automaticamente lo stato emotivo, il comfort o la profondità del sonno.

## 6. Developer Studio / 09

La nuova sezione include: toggle A/B della navigazione armonica (progressioni fisse precedente compositore vs nuovo motore, stessa sorgente biologica), centro tonale personale, successione dei quattro accordi, motivo dello sviluppo/migrazione, contatore delle modulazioni, fingerprint IBI/variabilità/ampiezza/larghezza, note MIDI reali del voicing corrente, contatore delle note comuni effettivamente mantenute e cronologia delle tonalità con segnalazione pivot. Le sezioni 06, 07 e 08 rimangono intatte. La telemetria documenta decisioni algoritmiche, non inferenze diagnostiche.

## 7. Tracking dello sviluppo e risultati verificati

| ID | Attività | Stato | Evidenza / limitazioni |
|---|---|---|---|
| 30-01 | Audit della ripetizione armonica SOMA29 | FATTO | 4 accordi fissi/livello; 5 tonalità; 3 voci senza vere estensioni |
| 30-02 | Studio di accordi-pivot e condotta delle parti | FATTO | Riferimenti §9, forme codificate in `harmonic_navigation.js` |
| 30-03 | Fingerprint PPG e scelta tonicità | IMPLEMENTATO E TESTATO | `test_harmony30.js`, `test_integration30.js`; 12 classi di altezza |
| 30-04 | Grammatica per 4 modalità, varianti funzionali | IMPLEMENTATO E TESTATO | `test_integration30.js`; accordi con vere estensioni |
| 30-05 | Modulazione chiavi vicine e pivots realmente comuni | IMPLEMENTATO E TESTATO | 4 modi x quattro spostamenti di quinta: 16 verifiche di triadi identiche |
| 30-06 | Harmonic feedback e qualità del PPG | IMPLEMENTATO E TESTATO | blocco inaffidabilità / ritorno prudente; `test_harmony30.js` |
| 30-07 | Voice leading 4 parti e legatura dei toni comuni | IMPLEMENTATO E TESTATO a livello DSP | ricerca di voicing, allineamento pitch class; assert `tiedTones>0` sul run da 225 s |
| 30-08 | Attivazione di accordi e bassi coerenti in quattro modalità | PASS TEST SIMULAZIONE | 4 modi x 2 corpi simulati, 85 s ciascuno; note appartenenti alla grammatica |
| 30-09 | Long run con modulazione | PASS TEST | `test_integration30.js`: 225 s Attivazione, almeno una modulazione, no NaN/peak >1 |
| 30-10 | Differenze personali a seed costante | PASS TEST | A e B non hanno la stessa combinazione tonalità/progressione per ciascun modo |
| 30-11 | Gating PPG, A/B, compatibilità microfono e spettro | PASS TEST | `test_integration30.js`, `test_dsp.js`, `test_ambient.js`, `test_spectral.js`, `test_real_fft.js` |
| 30-12 | UI desktop / mobile | PASS STATICO | `test_browser30.py`, 1280 px e 390 px, niente errori JS né scroll orizzontale |
| 30-13 | Suite unica in `TEST_RAPIDI.sh` | PASS | Eseguito con otto gruppi, tutti PASS |
| 30-14 | Ascolto soggettivo in cuffia, A/B a pari loudness | DA FARE | valutare dissonanza, roughness, prevedibilità, belle transizioni e fatica |
| 30-15 | WebAudio AudioWorklet + microfono, macOS Chrome | DA FARE | ambiente di test senza collaudo end-to-end affidabile |
| 30-16 | PPG ESP32 live, timestamp, qualità, ritardo rete | DA FARE | necessario per closed loop umano e attribuzione risposta |
| 30-17 | Studio riproducibile N-of-1 e preferenze | DA FARE | confronti randomizzati, comfort e misure PRV con controlli e baselines |
| 30-18 | Regia spettrale avanzata inharmonicità e mascheramento | DA PROGETTARE | serve ispezione timbrica percettiva e strumenti di misura reali |

## 8. Comandi di lavoro

Dalla cartella del progetto:

```sh
python3 soma30/rebuild.py
bash TEST_RAPIDI.sh
python3 -m http.server 8000
```

Aprire `http://localhost:8000/SOMA_30_Harmonic_Navigation.html` in Chrome. Il test Chromium statico e i test JS non sostituiscono una prova live AudioWorklet su hardware/macOS. I vecchi `test_regression29.js`/`test_long29.js` sono in `legacy_tests_29`: controllavano percorsi **volutamente fissi** e non sono validi per il motore 30.

## 9. Letteratura musicale di riferimento

- *Modulation to closely related keys*, Multimodal Musicianship, Macalester: https://pressbooks.macalester.digital/multimodalmusicianship/chapter/modulation-to-closely-related-keys/ — definisce gli accordi comuni con doppia funzione, passaggi a tonalità vicine e cadenze di conferma.
- *Common Chord / Pivot Chord Modulation*, Harmony and Musicianship with Solfège: https://pressbooks.pub/harmonyandmusicianshipwithsolfege/chapter/common-chord-pivot-chord-modulation/ — esempi concreti di modulazione tramite accordo-pivot.
- *Objectionable Parallels*, Open Music Theory, University of Puget Sound: https://musictheory.pugetsound.edu/mt21c/ObjectionableParallels.html — ragione teorica di penalizzare quinte e ottave parallele nella scrittura polifonica tradizionale.
- Fonte scientifica e limiti PPG/PRV e musica fisiologica: `STORICO_SOMA29.md` §8. Nessuna fonte è invocata come prova dell'efficacia terapeutica di SOMA30.

## 10. Prossime istruzioni permanenti

Quando si interviene su SOMA: (1) leggere questo file e `STORICO_SOMA29.md`; (2) modificare file sorgenti in `soma30/`; (3) mantenere esperimento A/B a stesso PPG e seed; (4) dichiarare quali quantità sono rilevate, simulate o stimate; (5) aggiornare le righe tracking prima di distribuire; (6) ricostruire HTML e rieseguire `TEST_RAPIDI.sh`; (7) consegnare sorgenti, test, HTML e ZIP con Markdown aggiornato. Non dichiarare confermata una relazione causale musica-corpo fino a misurazioni live controllate.
