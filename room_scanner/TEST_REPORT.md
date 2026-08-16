# Static verification report — Depth Anything replacement V3

## Esito

**PASS** per logica della patch, sintassi, idempotenza e routing same-origin.

## Verificato

- La patch non fa più sostituzioni globali di `onnxruntime-web` nell'HTML.
- `sw.js` non viene aperto o scritto dal patcher/builder.
- Il fix runtime usa `new URL(runtimeSource).origin !== self.location.origin`.
- Il fallback interno del worker è `1.23.2`.
- Il trace è locale al solo `depth_ai_worker.js`.
- Il messaggio `init`, lo smoke e gli errori worker trasportano uno snapshot diagnostico.
- L'HTML memorizza lo snapshot nel solo stato `S.depthAI`.
- Un crash reale di worker conserva message/filename/line/column.
- Il pulsante `Copia log Depth AI` produce JSON e usa `window.prompt` come fallback se Clipboard API fallisce.
- `node --check` passa sul worker patchato della fixture.
- `node --check` passa sul JavaScript HTML patchato della fixture.
- `verify_depth_v3.py` passa.
- Una seconda applicazione produce zero modifiche (idempotenza).
- Test origin routing:
  - runtime locale GitHub Pages -> `remote=false`, `wasmPaths` locale;
  - runtime jsDelivr -> `remote=true`, `wasmPaths` jsDelivr 1.23.2.

## Limite della verifica statica

Un container desktop non può certificare un'inferenza WebXR/WebGPU sul browser Android reale. Il test definitivo rimane lo smoke inference già integrato nel V10 sul dispositivo. Questa patch corregge il routing degli asset e rende il fallimento osservabile in dettaglio senza alterare la pipeline geometrica.
