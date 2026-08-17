# Third-party notices

Questo pacchetto sorgente non include binari ONNX Runtime o modelli neurali. La app puo' scaricarli al primo batch Deep oppure usarne copie locali predisposte dal deployer.

## ONNX Runtime Web

- Progetto: Microsoft ONNX Runtime
- Uso: inferenza ONNX nel Web Worker via WebAssembly
- Versione configurata: 1.23.2
- Licenza upstream: MIT
- Sito: https://onnxruntime.ai/
- Repository: https://github.com/microsoft/onnxruntime

Conservare la licenza upstream insieme ai file runtime se vengono copiati in `vendor/onnxruntime-web/`.

## Depth Anything V2 Small ONNX

- Repository modello: `onnx-community/depth-anything-v2-small`
- File primario: `onnx/model_q4.onnx`
- Uso: stima depth monoculare relativa in batch
- Licenza indicata dal repository: Apache-2.0
- Dimensione indicativa: 27.4 MB
- SHA-256: `5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`
- Pagina: https://huggingface.co/onnx-community/depth-anything-v2-small

Conservare notice e licenza Apache-2.0 se il modello viene redistribuito localmente.

## Specifiche WebXR

L'implementazione usa API definite o incubate nelle specifiche WebXR Device API, WebXR AR, Raw Camera Access, Depth Sensing, Hit Test, Anchors, Plane Detection, DOM Overlays e Lighting Estimation. Le specifiche non sono incorporate nel pacchetto.
