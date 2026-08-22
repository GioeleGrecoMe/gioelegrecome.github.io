# TEST REPORT — V30.49

Build: `v30.49.0-20260822-sharp-rgb-visual-postprocess`

## Regressioni mirate
Overlay V30.49 sopra V30.47:

- V30.42 RGB/submap regressions
- V30.44 RGB pose scaffold
- V30.44 Alva translation authority
- V30.45 async Deep lane — aggiornato al nuovo ordine post-scan
- V30.46 canonical RGB/post-scan
- V30.47 REVIEW + pose-bound MVS
- V30.48 confidence-clean surface
- V30.49 sharp RGB + visual processing

Risultato: **53/53 PASS**.

## ESM closure unico optimizer
`single_optimizer_runtime.js` e il suo grafo ESM transitive:

**3/3 PASS**

I moduli modificati usano il cache tag V30.49; dipendenze invarianti possono restare su precedenti tag esplicitamente ammessi dal test.

## Layout/version audit
`tools/check_v30_layout.mjs`:

**PASS**

Verificati build info, HTML e service worker sulla stessa identità V30.49.

## Suite completa disponibile nell'overlay incrementale
Risultato: **61/65 PASS**.

I 4 failure sono esclusivamente test storici che tentano di aprire file invariati non presenti nell'overlay incrementale:
- `js/xr/xr_calibration.js`
- `styles.css`

Non sono failure della V30.49 e non vengono introdotti stub o copie inutili nel patch per nasconderli.

## Syntax
`node --check` PASS per:
- `js/app.js`
- `js/config.js`
- `js/boot.js`
- moduli probabilistici/reconstruction modificati
- `workers/photo_archive_worker.js`

## Contratti verificati V30.49
1. Nessuna inferenza Deep è necessaria durante Scan.
2. L'acquisizione archivia RGB nitidi con compressione off-thread.
3. La fase processing esiste realmente nel DOM.
4. RGB, Deep e vista Alva/world sono sincronizzati per frame.
5. Le foto selezionate vengono registrate `depthPlanned` prima del loro Deep esatto.
6. Deep archivio è sequenziale: non accumula centinaia di raster decompressi.
7. I salti Alva vengono mostrati e down-weighted.
8. MVS resta post-scan.
9. Gaussiane low-confidence vengono nascoste ma non eliminate dal factor graph.
10. Mesh legacy-only / catastrophicamente frammentate non diventano autoritative.
