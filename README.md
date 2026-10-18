# SOMA 31 — Somatic Onset | GitHub Pages

Questa directory è **già pronta per essere pubblicata su GitHub Pages**. Non servono Node.js, Python, build remoti, un server sul tuo PC o dipendenze CDN per ascoltare SOMA. L'applicazione è interamente dentro `index.html` (HTML + CSS + Web Audio + AudioWorklet generato in memoria).

## Pubblicare da interfaccia GitHub

1. Crea su GitHub un nuovo repository, ad esempio `soma`, oppure usa un repository esistente. Su un account GitHub Free, il repository per Pages deve normalmente essere **pubblico**.
2. **Estrai lo ZIP sul computer**: non caricare lo ZIP come unico file. Apri la cartella estratta `SOMA_31_GitHub_Pages` e caricane il **contenuto nella radice** del repository (`index.html`, `.nojekyll`, `README.md`, `CONTESTO_E_TRACKING.md`, cartella `soma31` e `storico`). Su GitHub: **Add file → Upload files → Commit changes**. Su macOS puoi mostrare i file nascosti con `Cmd + Shift + .` per vedere `.nojekyll`.
3. Nel repository entra in **Settings → Pages**. In **Build and deployment** scegli **Deploy from a branch**, branch **main**, cartella **/(root)** e premi **Save**.
4. Quando GitHub ha terminato la pubblicazione, apri il link **Visit site** nella stessa pagina. Sarà simile a `https://TUO-UTENTE.github.io/soma/`. L'indirizzo esatto dipende dal nome del repository.
5. Premi **Ascolta** per iniziare. La modalità simulata funziona senza sensori; il microfono è facoltativo e richiede di concedere l'autorizzazione dal browser. Per l'ascolto è consigliato **Chrome/Edge desktop con cuffie**.

Se usi una pagina organizzazione con nome del repository `TUO-UTENTE.github.io`, il sito può apparire direttamente su `https://TUO-UTENTE.github.io/`.

## Come è distribuita l'applicazione

- `index.html`: **file pubblicato**, autosufficiente, derivato da SOMA 31.
- `.nojekyll`: impedisce la trasformazione tramite Jekyll del progetto statico.
- `soma31/*.js`, `soma31/ui_template.html`: sorgenti per continuare lo sviluppo.
- `soma31/rebuild.py`: rigenera **il file `index.html` nella radice** dopo modifiche ai sorgenti. È uno strumento per chi sviluppa, non serve agli ascoltatori e non viene eseguito su GitHub.
- `soma31/tests/`: regressioni facoltative per chi sviluppa.
- `CONTESTO_E_TRACKING.md`: scelte progettuali, cambiamenti, verifiche e passi futuri.
- `storico/`: cronologia tecnica SOMA 27–30.

I link e le risorse necessarie alla sintesi non usano percorsi assoluti: il sito può stare nella radice di Pages **o nella sottocartella del repository**. AudioWorklet viene registrato da un Blob generato nello stesso browser, senza richiedere un endpoint o file `.js` esterno. Meteo e geocodifica sono **opzionali** e usano API HTTPS di Open-Meteo: per queste funzioni è comunque necessaria connettività Internet.

## Uso, privacy e limiti

- **Nessun server sul PC**: il browser scarica la pagina statica ospitata da GitHub e produce il suono localmente.
- **HTTPS**: GitHub Pages fornisce il contesto sicuro necessario a `getUserMedia`, geolocalizzazione e AudioWorklet nei browser compatibili. Il microfono richiede consenso esplicito. Non è previsto un caricamento automatico di CSV/audio/PPG a GitHub da parte dell'applicazione.
- **PPG**: in SOMA 31 sono disponibili i corpi simulati A/B e l'importazione manuale di CSV locali; il collegamento PPG live ESP32 **non è ancora implementato**. Il CSV riprodotto non è un vero circuito chiuso fisiologico con la persona.
- **Registrazione**: la funzione di registrazione salva un file nel browser se l'utente la avvia; supporto e formato dipendono dal browser.
- **Open-Meteo**: se attivi il meteo o la geolocalizzazione, le richieste a quel fornitore usano le coordinate selezionate. È indipendente dalla sintesi offline.
- **Sicurezza d'ascolto**: intensità, phon e SPL reali non sono calibrati per le cuffie in uso; inizia a volume basso.
- **Pubblicazione**: tutto ciò che carichi nel repository Pages può diventare pubblicamente accessibile. Non inserire CSV PPG personali, password, token, log con dati sensibili o altri file privati.

## Riprendere lo sviluppo

Modifica i file in `soma31`, poi rigenera il singolo HTML:

```sh
python3 soma31/rebuild.py
```

Per eseguire le regressioni su un computer di sviluppo (facoltativo):

```sh
./TEST_RAPIDI.sh
```

Non serve eseguire questi comandi su GitHub Pages per pubblicare la versione già pronta. Il tracking è in `CONTESTO_E_TRACKING.md`.

## Se non funziona

- **Pagina 404**: controlla che `index.html` sia in radice, che Pages punti a `main / (root)` e che la pubblicazione abbia finito.
- **AudioWorklet o suono assente**: apri il sito tramite `https://`, premi **Ascolta** (gesto richiesto da molti browser), prova Chrome/Edge recente e controlla audio/cuffie e console. L'anteprima `file://` o la preview di un file HTML dentro un'app possono essere limitate.
- **Microfono non disponibile**: concede l'autorizzazione all'origine GitHub Pages; verifica che il dispositivo non sia occupato e che il browser supporti `getUserMedia`. Il microfono resta facoltativo.
- **Nessuna musica nei primi secondi**: è intenzionale. SOMA attende almeno 38 s e 30 battiti PPG attendibili prima di fare emergere la composizione; durante l'acquisizione ascolti il battito. Con qualità insufficiente può attendere più a lungo.

Documentazione GitHub: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
