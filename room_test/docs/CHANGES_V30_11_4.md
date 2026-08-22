# Room Scanner V30.12.0

## Fix principale

La transizione `aggancio metrico -> scansione` falliva sul telefono con:

`Must call super constructor in derived class before accessing 'this' or returning from derived constructor.`

La causa era `SlamEngine extends EventTarget`: il costruttore V30.11.3 accedeva a `this.frontend`, `this.K`, ecc. prima di chiamare `super()`.

V30.12.0 chiama `super()` come prima istruzione del costruttore e mantiene invariato il comportamento metrico/SLAM successivo.

## Regressioni aggiunte

- `tests/scan-runtime-constructor.test.mjs` istanzia realmente `SlamEngine`, applica la scala metrica e processa il primo frame.
- Il self-test browser include `scan-runtime-constructor`.
- `tools/check_eventtarget_constructors.mjs` controlla tutte le classi `extends EventTarget` e fallisce la build se `this` compare prima di `super()`.
- `npm run verify` include ora questo controllo permanente.

## Cache/versioning

Tutti i riferimenti runtime e il service worker sono stati portati a V30.12.0 per evitare il riuso del vecchio `slam_engine.js` dalla cache V30.11.3.
