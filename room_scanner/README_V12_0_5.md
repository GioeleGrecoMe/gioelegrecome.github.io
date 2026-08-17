# Room Scanner V12.0.5

## Obiettivo della patch

V12.0.5 corregge due errori indipendenti osservati sul dispositivo reale in V12.0.4:

1. `UWA_PREP_FAILED "Permission denied"` durante la preparazione della camera 0.5x.
2. `XR_START_FAILED "The specified session configuration is not supported."` per tutti i profili WebXR.

La geometria/fusione introdotta in V12.0.4 viene mantenuta; questa revisione rende robusti accesso camera e bootstrap WebXR.

## 1. Permesso camera 0.5x

### Browser con HTMLUserMediaElement

Quando il browser espone `HTMLUserMediaElement`, il pulsante **Concedi e prepara camera 0.5x** è contenuto nel capability element `<usermedia>`.

Il browser, non uno script, possiede il gesto fisico che concede/ripristina il permesso. Al successivo evento `stream`, Room Scanner:

- registra il consenso;
- enumera le camere;
- chiude lo stream temporaneo;
- prova le camere tramite `deviceId` esatto;
- sceglie la candidata più ampia;
- la lascia chiusa finché non parte WebXR.

Questo evita di ripetere `getUserMedia()` dopo un diniego e fornisce il percorso di recovery previsto dai browser che supportano il capability element.

### Browser legacy

Se `<usermedia>` non è supportato, il pulsante usa una sola chiamata diretta `getUserMedia()`.

Se il permesso è già stato bloccato a livello sito, la pagina non continua a martellare l'API: mostra istruzioni per riabilitare **Fotocamera** da Informazioni sito/Permessi e ricaricare.

### Diagnostica nuova

Il RAW conserva anche:

- modalità permesso: `usermedia` o `legacy-getUserMedia`;
- stato permission quando interrogabile;
- secure context;
- Permissions Policy camera;
- top-level/visibility;
- user activation;
- ultimo errore con `name`, `message` e stage.

Eventi principali:

- `UWA_PERMISSION_MODE`
- `UWA_PERMISSION_INITIAL`
- `UWA_PERMISSION_SNAPSHOT`
- `UWA_CAPABILITY_STREAM`
- `UWA_PERMISSION_CANCEL`
- `UWA_PERMISSION_ERROR`
- `UWA_PREP_FAILED`
- `UWA_SELECTED`
- `UWA_STREAM_NOT_STARTED`

## 2. Nessun prompt camera dentro WebXR

V12.0.4 tentava comunque di aprire la 0.5x dopo l'ingresso in AR, anche senza una preparazione valida.

V12.0.5 è fail-closed:

- se la camera non è già stata autorizzata e selezionata, WebXR parte senza Deep 0.5x;
- non viene generato un nuovo prompt `getUserMedia()` durante `immersive-ar`;
- il log emette `UWA_STREAM_NOT_STARTED`.

Questo separa chiaramente un problema di permesso camera da un problema XR.

## 3. Bootstrap WebXR corretto

V12.0.4 inseriva `local-floor` e `dom-overlay` in `requiredFeatures` in tutti i profili. Un runtime senza DOM Overlay poteva quindi respingere anche il profilo apparentemente "base".

V12.0.5 esegue **una sola** richiesta `requestSession('immersive-ar', ...)` dal tap dell'utente.

`requiredFeatures` è vuoto.

Sono opportunistiche:

- `local-floor`
- `dom-overlay`
- `depth-sensing`
- `plane-detection`
- `mesh-detection`
- `camera-access`

Se `local-floor` non viene concesso, la reference space degrada a `local` con log `XR_REFERENCE_SPACE_FALLBACK`.

Eventi principali:

- `XR_SESSION_REQUEST`
- `XR_SESSION_GRANTED`
- `XR_REFERENCE_SPACE`
- `XR_REFERENCE_SPACE_FALLBACK`
- `XR_DEPTH_PROPERTIES_UNREADABLE`
- `XR_START_FAILED`

`XR_START_FAILED` include ora nome errore, messaggio, risultato `isSessionSupported`, secure context e Permissions Policy XR.

## 4. Procedura consigliata sul telefono

1. Aprire la pagina HTTPS direttamente in Chrome, non dentro un iframe/WebView se evitabile.
2. Toccare **Concedi e prepara camera 0.5x**.
3. Concedere la fotocamera nel controllo gestito dal browser.
4. Attendere `UWA_SELECTED` e il messaggio "Permesso camera OK".
5. Toccare **Avvia scansione AR**.
6. Verificare `XR_SESSION_GRANTED`.
7. Se `camera-access`, depth, plane o mesh non sono presenti fra le feature concesse, la scansione continua con le capacità realmente disponibili.
8. Salvare il RAW se rimane un errore: V12.0.5 conserva fino a 900 eventi diagnostici.

## 5. Compatibilità RAW

V12.0.5 esporta `room-scanner-v12.0.5-raw` e reimporta:

- V12.0.5
- V12.0.4
- V12.0.3
- V12.0.2
- V12.0.1
- schema V12 legacy

## 6. File da sostituire

Sostituire:

`room_scanner/room_scanner_v12.html`

Gli asset locali esistenti, incluso `depth_ai_worker.js` e il modello Depth Anything Q4/WASM, restano invariati.
