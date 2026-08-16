# Room Scanner V12.0.0

Applicazione GitHub Pages per la scansione metrica di stanze con WebXR e Depth
Anything. La pagina principale corrente è `room_scanner_v12.html` e il
percorso utente è: **Scansione → Modello → Revisione**.

WebXR fornisce posa, geometria e scala metrica. Depth Anything lavora sui frame
nitidi, produce una profondità relativa e la fonde nella nuvola globale soltanto
dopo un controllo robusto contro le ancore WebXR. In V12, un pixel Deep entra
nella nuvola solo se ha posa XR, fit metrico con almeno otto ancore coerenti e
conferma dalla depth nativa, da un'altra vista o da un piano XR. I punti
accettati mantengono il colore RGB della foto. SAM non è parte del flusso.

## Modelli di profondità

- `models/depth_anything_v2_small_q4f16.onnx`: percorso WebGPU;
- `models/depth_anything_v2_small_q4.onnx`: percorso WASM universale verificato.

V12 carica prima il modello Q4/WASM e mostra un smoke test; solo dopo abilita
l'avvio AR. Durante la scansione usa piani, mesh e depth WebXR come autorità
metrica. Se `camera-access` non è esposto, continua con i dati WebXR nativi e
non inventa integrazioni Depth/RGB.

## Verifica e pubblicazione

Eseguire `node tests/test_v12_metric_pipeline.js`, quindi i test esistenti in
`./tests/run_v10_geometry_suite.sh`, poi pubblicare i file indicati in
`ISTRUZIONI_UPLOAD.txt`. Sul telefono, aprire `room_scanner_v12.html`,
controllare il build `V12.0.0`, il caricamento `Q4/WASM` e lo smoke test
con output finito.

Il pulsante **Scarica RAW** V12 conserva surfel, piani, oggetti, pose, foto RGB
e mappe relative in dati tipizzati codificati base64; **Carica RAW** riapre la
scena e permette di ricalcolare gli oggetti localmente.

## Diagnostica separata

`room_scanner_v11.html` isola il test della fotocamera + Depth Anything da
quello WebXR. Usarlo prima di investigare la fusione V10: la sessione WebXR
può iniziare soltanto dopo aver chiuso camera e worker Depth.
