# ONNX Runtime Web locale opzionale

La app tenta prima:

`./vendor/onnxruntime-web/ort.min.js`

Copiare in questa cartella `ort.min.js` e tutti i file WASM/MJS richiesti dalla stessa release ONNX Runtime Web 1.23.2. Non mescolare file di versioni diverse: il loader risolve `ort.env.wasm.wasmPaths` in questo percorso locale.

Una distribuzione tipica include, a seconda della build upstream, file come:

- `ort.min.js`
- `ort-wasm-simd-threaded.mjs`
- `ort-wasm-simd-threaded.wasm`
- `ort-wasm-simd-threaded.jsep.mjs`
- `ort-wasm-simd-threaded.jsep.wasm`

Conservare la licenza MIT upstream. Verificare il deploy in modalita' aereo dopo almeno un caricamento della shell.
