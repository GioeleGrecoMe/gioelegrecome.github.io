# Room Scanner V30.51 — Global Surface Consensus + Pipeline TEST Lab

Build: `v30.51.0-20260822-global-surface-consensus-test-lab`

## Scopo
V30.51 chiude due problemi strutturali rimasti dopo V30.50:

1. il post-processing raccoglieva RGB/Deep/MVS ma non eseguiva automaticamente il rebuild finale dell'unico `ProbabilisticJointOptimizer` prima di REVIEW;
2. la fusione densa concatenava evidenze locali/submap senza un vero consenso globale prima della TSDF, permettendo a piccoli errori di posa di creare superfici parallele, isole e Gaussiane visivamente rumorose.

Questa versione conserva l'architettura V30.50 (archivio RGB nitido, Deep adattivo, recovery Alva, MVS post-scan) e aggiunge un'autorità geometrica globale esplicita.

## Pipeline finale

Durante SCAN:
- Alva + tracking RGB restano nella fast lane;
- vengono archiviati i frame nitidi/stabili in JPEG compresso;
- le feature Alva persistenti e nuove restano distinte;
- loss/jump Alva mette in quarantena i frame e chiede all'utente di tornare verso una zona riconosciuta;
- Deep e plane-sweep MVS non governano il clock della scansione.

Dopo FINE:
1. flush archivio RGB;
2. selezione geometrica di un pool fino a 240 viste;
3. solve RGB + Alva;
4. Deep adattivo: 16 viste iniziali, poi tranche <=8 scelte dalla uncertainty map, max 56;
5. feedback nello stesso `ProbabilisticJointOptimizer` dopo ogni tranche;
6. MVS sulle pose accettate più recenti;
7. **final optimization automatica** (default +10 passaggi accettati, massimo 30 tentativi);
8. **global surface consensus** tra submap/evidenze;
9. TSDF solo sui rappresentanti globalmente verificati;
10. controllo topologico raw + cleanup di sole isole piccole + gate finale;
11. REVIEW.

## Global Surface Consensus
Prima del meshing le ipotesi di superficie vengono clusterizzate in world-space per:
- prossimità spaziale;
- compatibilità della normale (anche con orientamento equivalente +/- quando appropriato);
- supporto indipendente/multi-view;
- final-pose validation;
- provenienza cross-submap quando disponibile.

Ogni cluster produce al massimo un rappresentante robusto. Surfels isolati, non validati o con confidenza insufficiente non diventano autorità di superficie.

Statistiche diagnostiche aggiunte:
- input hypotheses;
- clusters;
- authoritative representatives;
- authoritative fraction;
- verified/cross-submap/strong clusters;
- occupied cells;
- median/P10 confidence;
- reject reasons.

## Gaussiane
La visualizzazione è deliberatamente più severa:
- confidenza ignota NON equivale più a 1;
- candidate: soglia default 0.60;
- review: 0.52;
- live: 0.48;
- weak/candidate non possono bypassare la soglia;
- i dati esclusi dalla visualizzazione restano nel solver/log: non vengono cancellati.

## Mesh
Il cleanup topologico può rimuovere soltanto piccole componenti isolate, ma il gate finale vede anche la topologia RAW. Una mesh non può diventare apparentemente valida nascondendo una grossa frazione di geometria frammentata.

Nuovi motivi di rifiuto includono:
- `global-surface-consensus-insufficient`;
- `mesh-fragmented-before-cleanup`;
- `mesh-catastrophically-fragmented`;
- `legacy-mvs-not-authoritative`.

L'MVS legacy/reloaded può restare diagnostico, ma non è sufficiente da solo per autorizzare una superficie committed.

## TEST · osservabilità completa pipeline
In REVIEW è presente una nuova sezione TEST che raccoglie sei stadi:
1. Acquisizione RGB / Alva;
2. Scaffold RGB;
3. Deep adattivo;
4. MVS finale;
5. Consenso superficie;
6. Mesh / TSDF.

Per ogni stadio mostra:
- stato `ok / warn / fail`;
- cause quantitative;
- metriche principali;
- intervento consigliato.

La sezione identifica il **primo failure causale**, per evitare di diagnosticare sempre e soltanto l'ultimo sintomo (`mesh fragmented`).

Il pulsante `Scarica snapshot TEST` esporta un JSON `ROOMSCAN-V30-PIPELINE-TEST-1` con:
- graph summary;
- optimizer baseline/candidate/gate;
- processing/adaptive Deep;
- tracking/Alva recovery;
- photo archive;
- fast lane;
- dense/MVS;
- surface consensus;
- raw mesh + cleaned mesh;
- eventi warning/error recenti.

## Nota sul pacchetto
Il `.tar.gz` V30.51 è **cumulativo rispetto alle modifiche V30 precedenti**: contiene tutti i file runtime/test/tool attualmente modificati necessari per portare la cartella V30 esistente allo stato V30.51. Non ricopia modelli, vendor o file base invariati.
