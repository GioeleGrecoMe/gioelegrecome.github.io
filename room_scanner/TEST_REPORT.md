# Test report — Room Scanner V20.0.0

Data build: 2026-08-18

## Esito automatico

```text
PASS core_geometry
PASS close_geometry_v20
PASS photo_targets
PASS depth_fit
PASS object_voxels
PASS rgb_object_points
PASS acoustic_surfaces
PASS deep_worker_contract
PASS static_contract
PASS bootstrap
PASS workflow_state
PASS completion_guard
PASS coverage_guidance
PASS overlay_render
PASS post_xr_cleanup
PASS navigation_recovery
PASS checkpoint_recovery
PASS http_smoke
PASS manifest_json
PASS build_info_json
ALL TESTS PASSED
```

## Copertura rilevante

- perimetri metrici, auto-intersezioni, portali e shell con aperture;
- pareti sub-millimetriche nel nucleo e nessuna chiusura automatica vicino al primo punto;
- target AR fisici rossi/gialli/verdi e chiusura senza deadlock;
- fit robusto della depth relativa diretta/inversa;
- persistenza multi-vista e separazione degli oggetti per vano;
- RGB su punti e mesh voxel, trasformazione coerente dopo editing e colore per triangolo;
- etichetta acustica per ogni triangolo della mesh e sei gruppi editabili per oggetto;
- superfici stanza, aperture, scope intelligente e override acustici manuali, inclusi valori esattamente zero;
- contratto worker ONNX con input fisso e dinamico;
- singolo stack camera WebXR e singolo callsite Raw Camera;
- checkpoint con JPEG separati, cleanup WebGL, marker, reload e ripristino post-XR;
- sovrascrittura sicura dei record foto quando una scansione nuova riusa gli ID numerici;
- nessun fallback HTML per richieste JavaScript critiche;
- workflow a due vani nello stesso riferimento metrico;
- alias/versioned asset identici, HTTP 200 e JSON validi.

## Browser headless

È stato tentato Chromium headless con viewport 390×844. Nel container il processo non è terminato entro il timeout e non ha prodotto uno screenshot utilizzabile; i messaggi osservati erano relativi a D-Bus del container. Non viene quindi dichiarata una prova visuale browser completata.

## Non validato in questo ambiente

- sessione fisica Chrome Android/ARCore;
- texture Raw Camera reale;
- WebXR Depth reale;
- evento di chiusura del compositor sul singolo telefono;
- consumo RAM/temperatura del modello ONNX;
- qualità percettiva della forma RGB degli oggetti;
- accuratezza acustica sperimentale, che richiede misure RIR.

Seguire `TEST_ON_PHONE.md`.
