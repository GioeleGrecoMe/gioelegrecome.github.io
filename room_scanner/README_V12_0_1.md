# Room Scanner V12.0.1

Sostituzione completa e pulita di `room_scanner_v12.html`.

## Installazione

1. Sostituire **solo** `room_scanner/room_scanner_v12.html` con il file incluso.
2. Lasciare nella stessa directory gli asset già esistenti del progetto: `depth_ai_worker.js`, `models/depth_anything_v2_small_q4.onnx` e `vendor/`.
3. Pubblicare su GitHub Pages e verificare che in alto compaia `Room Scanner · V12.0.1`.
4. Su Android/Chrome eseguire una scansione reale sia con depth XR disponibile sia con profilo degradato senza depth/mesh.

## Correzioni architetturali principali

- WebXR è l'unica autorità per posa e metrica.
- Depth XR viene raccolta continuamente con gate di movimento, non solo quando viene salvato un RGB keyframe.
- `XRView.camera` viene verificato sul frame corrente; la sola presenza di `XRWebGLBinding` non viene più trattata come prova di raw-camera access.
- I keyframe automatici richiedono realmente >= 0.28 m oppure >= 15 gradi; il tempo è soltanto un rate limiter.
- Il frame RGB mantiene l'aspect ratio della camera invece di essere forzato a 720x405.
- Ogni keyframe conserva RGB, projection/intrinsics, posa, griglia XR depth sincronizzata, coverage e quality.
- Inferenza Deep, ancoraggio metrico e ammissione 3D sono tre stadi distinti.
- Quando arriva una nuova vista, tutte le ammissioni Deep vengono rivalutate: un frame precedente può essere promosso da candidato ad ammesso.
- Il supporto dei piani è finito al poligono osservato, con margine metrico; non usa più il piano infinito.
- I surfel XR e Deep restano in mappe separate e conservano `sources`, `frames`, `evidence`, `confidence`.
- Le superfici partono da XR plane e possono essere integrate conservativamente da normali della depth XR.
- Gli oggetti sono cluster residuali 3D con OBB yaw-PCA; nessuna dipendenza da SAM.
- Le foto non vengono eliminate automaticamente: possono solo essere escluse/reincluse nella fusione.
- Viewer 3D senza Three.js/CDN, con livelli XR nativo / Deep ammesso / struttura / oggetti / candidati.
- Deep Q4/WASM non blocca l'avvio XR: se il modello fallisce, la scansione nativa continua.
- RAW V12.0.1 conserva foto, depth relativa, depth XR, pose, intrinseche, superfici, oggetti e provenienza/confidenza.

## Test inclusi

```bash
node tests/test_v12_0_1_static.js
node tests/test_v12_0_1_synthetic.js
```

I test sintetici coprono: piano finito, tavolo ruotato, divano/volume grande, parete parzialmente occlusa e fit metrico robusto con outlier.

## Limite della validazione consegnata

Sono stati eseguiti controllo sintattico Node, test statici e test sintetici. WebXR raw camera/depth/plane/mesh richiedono necessariamente una prova sul dispositivo Android/ARCore reale; questa parte non è simulabile in Node.
