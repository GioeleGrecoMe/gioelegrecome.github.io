# Room Scanner V10.0.9

Applicazione GitHub Pages per la scansione metrica di stanze con WebXR e Depth
Anything. Il percorso utente è: **Scansione → Modello → Frame e qualità**.

WebXR fornisce posa, geometria e scala metrica. Depth Anything lavora sui frame
nitidi, produce una profondità relativa e la fonde nella nuvola globale soltanto
dopo un controllo robusto contro le ancore WebXR. I punti accettati mantengono
il colore RGB della foto. SAM non è parte del flusso V10.

## Modelli di profondità

- `models/depth_anything_v2_small_q4f16.onnx`: percorso WebGPU;
- `models/depth_anything_v2_small_q4.onnx`: percorso WASM universale verificato.

La sessione WebXR viene richiesta prima del preflight AI, così il caricamento
del modello non consuma il gesto utente necessario per l'AR. Se Depth Anything
non è pronta entro 18 secondi, la scansione WebXR continua e la diagnostica
mostra il motivo esatto.

## Verifica e pubblicazione

Eseguire `./tests/run_v10_geometry_suite.sh`, poi pubblicare i file indicati in
`ISTRUZIONI_UPLOAD.txt`. Sul telefono, aprire `room_scanner_v10.html` e
controllare nei dettagli che il build sia `v10.0.9-depth-wasm-verified` e che
lo smoke Depth indichi un output finito.

La guida completa del flusso, delle foto e dei file RAW è in `V10_GUIDE.md`.

## Diagnostica separata

`room_scanner_v11.html` isola il test della fotocamera + Depth Anything da
quello WebXR. Usarlo prima di investigare la fusione V10: la sessione WebXR
può iniziare soltanto dopo aver chiuso camera e worker Depth.
