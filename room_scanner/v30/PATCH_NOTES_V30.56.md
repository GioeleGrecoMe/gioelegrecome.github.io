# Room Scanner V30.56 — closure RGB → MVS → Deep → TSDF

V30.56 chiude il ramo V30 sostituendo la risoluzione congiunta di posa, profondità e superficie con una pipeline ordinata e con autorità esplicite.

## Pipeline di produzione

1. Il grafo RGB e i prior Alva risolvono pose e landmark; il modello camera `K + distorsione` resta bloccato.
2. Le pose finali e l'unica gauge della scansione vengono congelate.
3. Un solo planner sceglie fino a 28 keyframe atomici. Gli stessi `frameId` sono reference MVS e input Deep.
4. MVS viene eseguita e rivalidata sulle pose finali. Solo i minimi fotometrici osservabili diventano anchor di profondità.
5. Deep viene calibrata in inverse depth con un solo modello globale `rho = aD + b` (due gradi di libertà per scansione), verificato leave-one-frame-out e con coerenza ordinale.
6. I pixel Deep con anchor locale sono ad alta confidenza; quelli senza anchor locale ma confermati da almeno due altre viste sono a media confidenza e committable; il single-view resta un prior.
7. I campioni densi cross-view sono la rappresentazione geometrica primaria e alimentano direttamente la TSDF. Splat e mesh sono prodotti successivi e indipendenti.

## Autorità e gate

- I landmark per la calibrazione Deep privilegiano track a tre o più viste con cheiralità, parallasse, ray-gap e leave-one-view-out reprojection validi. I 2-view entrano solo se geometricamente forti o MVS final-pose validati.
- La camera non è una variabile dell'optimizer e Deep non può spostare le pose.
- Senza bridge WebXR/pin affidabile, la scansione resta esplicitamente up-to-scale: la depth monoculare non inventa una scala assoluta.
- La dense cloud richiede almeno 1000 campioni autorevoli prima del commit. Una mesh frammentata viene rifiutata senza cancellare dense cloud, TSDF diagnostica o splat validi.
- La diagnostica segue l'ordine reale `RGB/Alva → MVS final-pose → Deep globale → dense cloud → TSDF → mesh`.

## Compatibilità

Il solver gerarchico e lo scheduler Deep adattivo restano importabili per test e lettura di diagnostiche precedenti, ma non sono più nel percorso di chiusura dell'app. L'alias storico del planner MVS punta al nuovo planner atomico unico.

