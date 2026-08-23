# Scan Test v3.4.0 - verification record

Build: `scan-test-v3.4.0-watchdog-live-log`

## Problemi riprodotti/individuati nella v3.3.0

1. `verifyDeployedBuild()` eseguiva fetch sequenziali senza timeout e includeva `HEAD` di `model_q4.onnx`. Una richiesta pendente lasciava il banner `verifica asset in corso` senza limite.
2. Durante il passo Deep, import del runtime, model load, creazione sessione e inferenze potevano trascorrere molto tempo senza uno stato persistente visibile.
3. Il buffer RGB di ogni job Deep veniva structured-cloned al worker, aumentando picco di memoria su mobile.
4. Il test Deep usava le dimensioni globali `W,H` invece delle dimensioni archiviate sul frame corrente.
5. Il profilo DPT locale a 518 era costoso per il banco mobile; il modello incluso usa shape dinamiche nel percorso gia validato dal progetto, quindi il processor locale viene portato a 336 mantenendo il vincolo multiplo di 14.

## Regressioni statiche

`test_v340_watchdog.mjs` verifica:

- fingerprint v3.4.0;
- dock log fixed sempre presente;
- self-check parallelo e bounded a 5 s;
- nessun accesso al Q4 nel self-check iniziale;
- stage + heartbeat del worker;
- timeout import runtime e pipeline;
- assenza di `HEAD` sul Q4 nel worker;
- trasferimento ownership del buffer RGBA;
- dimensioni Deep prese dal frame;
- profilo DPT 336.

`test_app_contract.mjs` continua a verificare:

- registrazione attiva prima del decoder file;
- `requestVideoFrameCallback` continuo;
- frame t=0 esplicito;
- singola sessione `play()`;
- raster Alva long-side 960;
- gate Deep prima di assegnare depth;
- cancellazione completa di batch Deep rifiutati.

`test_depth_noise_gate.mjs` continua a separare una matrice casuale ad alta frequenza da una depth spazialmente liscia.

## Browser regression Alva

Sul fixture indipendente `external_hallway_validation.mp4`, attraverso `CameraController.consumeDecodedFrames` e il tracker Alva bundled, il test eseguito a playback 1.0 ha prodotto:

- source: 480x270;
- raster Alva: 960x540;
- frame consegnati: 48;
- duplicati: 0;
- pose: 43/48 = 89.6%;
- prima posa: frame 5.

Questo test serve a verificare che le modifiche di osservabilita/Deep non abbiano rotto il percorso Alva.

## Limite della verifica locale

L'ambiente di packaging non riesce a raggiungere il deploy GitHub Pages fornito e non consente un test numerico completo della pipeline Transformers.js scaricata da CDN. Non viene quindi dichiarata una inferenza Deep end-to-end certificata in questo ambiente. Sul dispositivo target, il dock v3.4.0 rende ora esplicita la fase esatta e impone un timeout main-thread al job.
