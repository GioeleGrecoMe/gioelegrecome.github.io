# Room Scanner v10.0.6 — fusione metrica

Aprire `room_scanner_v10.html` su un dispositivo WebXR compatibile.

Il percorso ha tre fasi, sempre raggiungibili dai controlli in alto. SAM non viene caricato né usato in V10.

1. **Scansione** — muoversi lungo pareti, pavimento e angoli. WebXR costruisce la metrica e fornisce pose/ancore di profondità. Depth Anything elabora automaticamente soltanto i frame nitidi; la sua profondità relativa viene convertita in metrica solo se il fit con WebXR è robusto. Con **+ Foto** una foto manuale viene analizzata ma **non** modifica ancora la mappa.
2. **Modello** — controllare la base metrica e tornare alla scansione se occorre migliorarla. L'apertura del viewer finale chiude WebXR per liberare il renderer; per acquisire nuovi dati bisogna poi avviare una nuova scansione.
3. **Frame e qualità** — per ogni foto manuale mostra affiancati RGB e mappa di profondità relativa di Depth Anything, con ancore e qualità del fit. Solo **Applica alla mappa** fonde i punti RGB metrici. **Non applicare** conserva la foto ma esclude i suoi punti. Se il fit viene rifiutato, la mappa WebXR resta invariata e conviene ripetere la foto con più geometria visibile.

La diagnostica registra, per ogni frame, il risultato del gate metrico Depth Anything, ancore/inlier/residui e gli eventuali motivi di rifiuto. La pulizia elimina solo punti deboli e contemporaneamente contraddetti da spazio libero o reproiezione; un rifiuto di Depth Anything non è mai da solo una causa di eliminazione. Audio, sweep e calibrazione non fanno parte del percorso V10; rimangono nel workflow sperimentale V9.
