# Scan Test v3.4.2 - verification

Build: `scan-test-v3.4.2-interactive-3d-viewer`

## Ambito

Nessuna modifica a tracking AlvaAR, ingestione video, Deep worker, modello ONNX o ottimizzazione di profondita. Solo viewer finale del passo 6.

## Verifiche eseguite

- `node --check app.js`: OK.
- `node tools/test_v342_viewer_navigation.mjs`: OK.
- la vista iniziale usa yaw 45 deg e pitch -35.264 deg; il test numerico verifica che produca gli stessi assi 2D della precedente funzione isometrica;
- stage 4 continua ad usare `renderIso()` fisso;
- stage 6 usa `renderInteractive3D()`;
- Pointer Events: orbit, pan e multi-touch;
- wheel con `passive:false` per zoom senza scroll della pagina;
- `touch-action:none` sul solo canvas 3D;
- preset Isometrica/Alto/Fronte/Lato;
- tastiera e reset;
- logging della camera al termine di una gesture;
- LOD temporaneo durante drag per evitare che cloud grandi blocchino il telefono; ridisegno completo al rilascio.

Il dock log v3.4.x rimane invariato e sempre visibile.
