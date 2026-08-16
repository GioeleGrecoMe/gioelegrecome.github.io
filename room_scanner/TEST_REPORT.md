# Report di verifica — Room Scanner V10.0.9

## Esito

**PASS**: sintassi, contratti di flusso, gate metrico e asset locali sono stati
verificati. Il modello Q4 ha eseguito una reale inferenza ONNX Runtime/WASM con
output finito; il percorso Q4F16 WebGPU è presente e checksum-pinned.

## Copertura

- avvio WebXR immediato, con preflight Depth Anything parallelo e timeout non
  bloccante;
- smoke WASM Q4, shape dinamica, gate relativo→metrico e rifiuto delle mappe
  non coerenti con WebXR;
- foto manuale: preview RGB/profondità, conferma esplicita, fusione di punti RGB
  metrici e recupero da errore/timeout;
- viewer che chiude WebXR prima di usare il renderer finale;
- RAW esportabile/ripristinabile, cache versionata e checksum dei modelli.

Un test AR fisico resta necessariamente da svolgere su un telefono WebXR: la
pagina mostra comunque lo smoke con provider, variante, output e messaggio di
errore preciso direttamente sul dispositivo.
