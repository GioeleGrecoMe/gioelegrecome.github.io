# Third-party notices

Questo pacchetto sorgente non include binari ONNX Runtime o il modello neurale. La shell geometrica/acustica, il worklet e i test sono inclusi.

## ONNX Runtime Web

- Progetto: Microsoft ONNX Runtime
- Uso: inferenza ONNX nel Web Worker via WebAssembly
- Versione configurata: 1.23.2
- Licenza upstream: MIT
- Sito: https://onnxruntime.ai/
- Repository: https://github.com/microsoft/onnxruntime

Conservare la licenza upstream con i file copiati in `vendor/onnxruntime-web/`.

## Depth Anything V2 Small ONNX

- Repository modello: `onnx-community/depth-anything-v2-small`
- File primario: `onnx/model_q4.onnx`
- Uso: depth monoculare relativa post-XR
- Licenza indicata dal repository: Apache-2.0
- Dimensione indicativa: 27.4 MB
- SHA-256 atteso: `5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`
- Pagina: https://huggingface.co/onnx-community/depth-anything-v2-small

Conservare notice e licenza Apache-2.0 se il modello viene redistribuito localmente.

## Implementazione DSP

Le routine ESS, FFT, Kirkeby, filtri, rilevamento picchi e stima del decadimento presenti in `roomscan_signal_v20_1_0.js` sono implementazione sorgente del progetto e non incorporano una libreria DSP esterna.

## Specifiche browser

L'app usa WebXR Device API, Raw Camera Access, Depth Sensing, Hit Test, Anchors, DOM Overlay, Web Audio, AudioWorklet, Media Capture and Streams, IndexedDB e Service Workers. Le specifiche non sono incorporate nel pacchetto.
