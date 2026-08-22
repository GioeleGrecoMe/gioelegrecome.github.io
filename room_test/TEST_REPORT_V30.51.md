# Test report — V30.51

Build: `v30.51.0-20260822-global-surface-consensus-test-lab`

## Syntax
PASS per tutti i moduli V30.51 modificati principali:
- app.js
- config.js
- joint_optimizer.js
- geometry_commit_policy.js
- single_optimizer_runtime.js
- submap_fusion.js
- surface_display_policy.js
- mesh_quality.js
- global_surface_consensus.js
- pipeline_diagnostics.js

## Regressioni mirate
`node --test` su confidence-clean-surface, adaptive Deep/Alva recovery, V30.51 surface/test-lab ed ESM closure:
- 25 test
- 25 PASS
- 0 FAIL

Coprono in particolare:
- Gaussiane unknown/low-confidence non visualizzate;
- TSDF più severa dello storage diagnostico;
- MVS legacy-only non può autorizzare geometria committed;
- topologia equivalente al PLY reale da 181 componenti rifiutata;
- MVS pose-bound coerente può ancora committare;
- selezione geometrica Deep adattiva 16 + <=8;
- pipeline decode/preprocess overlapped;
- cache resize maps;
- microbatch solo capability-gated;
- feature Alva persistenti/nuove + recovery;
- MVS sulle pose accettate più recenti;
- global surface consensus;
- cleanup componenti con accounting RAW;
- TEST lab identifica il primo failure;
- Processing esegue automaticamente optimizer + rebuild prima di REVIEW.

## Suite completa disponibile nell'overlay
`npm test`:
- 81 test totali
- 77 PASS
- 4 FAIL

I quattro FAIL sono esclusivamente test storici che tentano di aprire file base invariati assenti dall'overlay cumulativo:
- `js/xr/xr_calibration.js` (3 test)
- `styles.css` (1 test)

Non sono failure di runtime V30.51. Il precedente failure di identità build è stato corretto e passa.

## Layout / import
- `node tools/check_v30_layout.mjs`: PASS (`85 file sotto una sola radice v30/` nel layout di test)
- ESM closure singolo optimizer: 3/3 PASS
- nessun riferimento runtime/test residuo a V30.50.

## Replay su `.r30` reale V30.45/46
File: `roomscan-1787388793897.r30`.

Risultati principali:
- RGB scaffold recuperato: `observed=true`;
- 72 translation-direction edges;
- mean direction disagreement ~22.0 deg;
- epipolar plane residual ~2.09 deg;
- global surface consensus: 491 rappresentanti autoritativi nel replay limitato;
- MVS validati: 6035 / 25000 considerati;
- 8771 campioni rigettati per `mvs-relative-pose-drift-high`;
- tutti i fattori MVS autorizzabili del vecchio archivio risultano legacy;
- geometria finale: **NOT COMMITTED** con motivo `legacy-mvs-not-authoritative`;
- raw mesh: 64 componenti prima del cleanup;
- cleanup scarta ~59.8% dei vertici raw;
- cleaned mesh resta 14 componenti, largest component ~15.8%;
- il gate continua quindi correttamente a rifiutare la superficie.

Questo replay è intenzionalmente conservativo: V30.51 non trasforma un archivio legacy geometricamente incoerente in una falsa mesh valida.

## Analisi PLY reale allegato
`roomscan-mesh-base-1787393207707.ply`:
- 17010 vertici;
- 27096 facce;
- 181 componenti;
- largest component = 6346 vertici = 37.31%;
- fragmentation score = 0.6269;
- diagonale bbox = 26.16.

Con i gate V30.51 questa topologia non è considerata stabile.
