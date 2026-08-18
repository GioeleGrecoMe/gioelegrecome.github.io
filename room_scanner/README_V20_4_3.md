# Room Scanner V20.4.3

Patch conservativa sopra V20.4.2.

- Deep keyframe motion/coverage gated, con rolling retention cap.
- Celle predette non contano piu come richieste Deep.
- Snapshot riserva spazio a Gaussian confermate: i punti verdi non spariscono.
- Soglie green piu realistiche per XR multi-view.
- Propagazione verticale dei target sulle pareti fino al soffitto.
- Markpoint ripristinati con fallback hit-test se manca il center depth.
- Pruning conservativo di outlier sul modello derivato; RAW invariati.
- Viewer 3D: orbit/pan/pinch, export PLY RGB binario e re-import PLY.
