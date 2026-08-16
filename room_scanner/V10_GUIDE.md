# Room Scanner v10.0.8 — fusione metrica, verifica Depth e stanze RAW

Aprire `room_scanner_v10.html` su un dispositivo WebXR compatibile.

Prima di aprire WebXR, V10.0.8 mostra una barra di caricamento di Depth Anything e compie una smoke inference reale. Il log dichiara provider/runtime, dimensione dell'output e tempo di risposta; se il modello non è disponibile, WebXR può comunque iniziare ma il motivo preciso resta nei log e le foto si possono ricalcolare in seguito.

Il percorso ha tre fasi, sempre raggiungibili dai controlli in alto. SAM non viene caricato né usato in V10.

1. **Scansione** — muoversi lungo pareti, pavimento e angoli. WebXR costruisce la metrica e fornisce pose/ancore di profondità. Depth Anything elabora automaticamente soltanto i frame nitidi; la sua profondità relativa viene convertita in metrica solo se il fit con WebXR è robusto. Con **+ Foto** una foto manuale viene analizzata ma **non** modifica ancora la mappa.
2. **Modello** — controllare la base metrica e tornare alla scansione se occorre migliorarla. L'apertura del viewer finale chiude WebXR per liberare il renderer; per acquisire nuovi dati bisogna poi avviare una nuova scansione.
3. **Frame e qualità** — per ogni foto manuale mostra affiancati RGB e mappa di profondità relativa di Depth Anything, con ancore, qualità del fit e **punti candidati dopo il gate WebXR**. Il riepilogo separa i candidati dai punti realmente applicati dalle foto manuali. Solo **Applica N punti** fonde i punti RGB metrici; il totale applicato diventa visibile subito nel riepilogo e nell'HUD. **Non applicare** conserva la foto ma esclude i suoi punti. Se il fit viene rifiutato, la mappa WebXR resta invariata e conviene ripetere la foto con più geometria visibile.

Se una preview fallisce, resta visibile insieme al motivo e al pulsante **Ricalcola Depth**. Il log distingue coda AI, riavvio/timeout del worker, disponibilità del modello e fallimento del gate metrico. Alla conferma, i campioni passati vengono trasformati da profondità relativa a metri tramite le ancore WebXR e riproiettati, con posa della foto, nella nuvola 3D globale.

La diagnostica registra, per ogni frame, il risultato del gate metrico Depth Anything, ancore/inlier/residui e gli eventuali motivi di rifiuto. La pulizia elimina solo punti deboli e contemporaneamente contraddetti da spazio libero o reproiezione; un rifiuto di Depth Anything non è mai da solo una causa di eliminazione. Audio, sweep e calibrazione non fanno parte del percorso V10; rimangono nel workflow sperimentale V9.

## Salvare e riaprire una stanza

Usare **⇩ Scarica RAW** dal pannello dettagli o dalla fase **Frame e qualità**. Lo ZIP contiene la nuvola di surfel già verificata (con colori RGB), percorso e pose WebXR, frame di profondità WebXR, geometria XR grezza e le foto manuali come RGBA senza perdita. Non contiene solo un'anteprima: può essere riaperto da **Apri stanza RAW salvata** nella schermata iniziale, anche senza avviare WebXR.

Una stanza ripristinata è già navigabile nel modello 3D. Nella fase **Frame** ogni foto RAW ha **Ricalcola Depth**: rigenera la preview di Depth Anything e ripete il controllo relativo→metrico contro le ancore WebXR archiviate. Solo i campioni che superano il gate possono essere nuovamente confermati per entrare nella nuvola globale.
