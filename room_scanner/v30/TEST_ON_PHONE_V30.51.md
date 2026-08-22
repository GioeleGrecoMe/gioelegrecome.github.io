# V30.51 — test telefono

## 1. Nuova scansione
Serve una nuova scansione: gli archivi legacy non possiedono tutta la provenienza necessaria per dimostrare il comportamento del nuovo MVS post-scan.

Durante la misura verificare:
- feature consolidate/persistenti distinguibili dalle nuove;
- nessuna inferenza Deep nel critical path;
- quando Alva perde/riprende con salto evidente compare richiesta di tornare verso una zona riconosciuta;
- il contatore archivio RGB cresce mentre il telefono viene mosso lentamente e con immagini nitide.

## 2. Processing
Dopo `Fine`, non premere manualmente `Continua OPT UNICO` per ottenere la prima ricostruzione.

La schermata Processing deve attraversare automaticamente:
- RGB/Alva graph;
- Deep adattivo (prima tranche 16, poi tranche <=8 se utili);
- MVS;
- `final-opt`;
- surface consensus;
- TSDF/gate;
- REVIEW.

Durante Deep controllare RGB, Depth e vista world/Alva. Segnalare se il prior fa salti evidenti non coerenti con la camera.

## 3. TEST lab
In REVIEW aprire:
`TEST · osservabilità completa pipeline`.

Premere `Ricalcola`, quindi `Scarica snapshot TEST`.

Inviare insieme:
1. diagnostica completa RoomScan;
2. snapshot TEST;
3. `.r30`;
4. PLY/mesh solo se l'export è abilitato oppure se è una candidate diagnostica esplicitamente esportabile dalla build di test.

## 4. Metriche che ci interessano
Acquisizione:
- archived/selected sharp RGB;
- blur/motion rejects;
- Alva recovery events;
- persistent vs new feature counts.

RGB scaffold:
- photo edge import fraction;
- translation-direction edges;
- epipolar inlier/residual;
- direction residual;
- active/weak/rejected RGB edges.

Deep:
- numero inferenze usate / pool RGB;
- round/tranche;
- uncertainty prima/dopo;
- marginal gain;
- depth calibration residual/confidence.

MVS:
- pose-bound vs unbound factors;
- locally validated/committed;
- pose drift rejection;
- parallax/sensitivity/independent sources.

Surface consensus:
- input splats;
- clusters;
- authoritative representatives;
- cross-submap/verified clusters;
- confidence;
- occupied cells;
- reject reasons.

Mesh:
- raw component count;
- raw largest component fraction;
- cleanup discarded fraction;
- cleaned component count;
- scale ratio;
- final commit reason.

## 5. Criterio di successo
Non basta che compaia una mesh.

Una scansione è interessante quando:
- scaffold RGB è osservato;
- MVS è realmente pose-bound e non legacy;
- il consenso globale ha supporto distribuito;
- la mesh RAW non è composta da molte isole;
- il cleanup elimina soltanto una piccola coda di componenti;
- Gaussiane visibili sono poche ma ad alta confidenza e strutturalmente coerenti;
- il gate finale committa senza bypass diagnostici.
