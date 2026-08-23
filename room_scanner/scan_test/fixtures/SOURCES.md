# Debug / validation fixtures

## `tum_freiburg1_xyz_debug_replay.mp4`

Derivato localmente dalla preview pubblica del TUM RGB-D Benchmark Freiburg1. E intenzionalmente quasi statico e viene mantenuto solo come test deterministico del decoder/crop/EOF; **non e un test valido di visual odometry** e zero pose AlvaAR e l'esito atteso.

- Dataset: https://cvg.cit.tum.de/data/datasets/rgbd-dataset
- Download/debug: https://cvg.cit.tum.de/data/datasets/rgbd-dataset/download
- Formati/intrinsics: https://cvg.cit.tum.de/data/datasets/rgbd-dataset/file_formats

Il benchmark dichiara CC BY 4.0 salvo diversa indicazione.

## `alva_dynamic_regression.mp4`

Fixture sintetico/deterministico creato per Scan Test con texture, traslazione e parallasse. Serve a verificare che il decoder consegni frame distinti e che il binding AlvaAR riesca effettivamente a inizializzare e produrre pose. Non rappresenta una metrica di accuratezza geometrica.

## `external_hallway_validation.mp4`

Clip di validazione ricavata dal pannello RGB di `figures/demo.gif` del repository pubblico `raahimnawaz/monocular-vo` (licenza MIT). Il repository descrive la demo come una camminata indoor in corridoio di 5 m misurata con metro e pubblica anche la versione MP4 ad alta qualita.

- Repository: https://github.com/raahimnawaz/monocular-vo
- Demo: https://github.com/raahimnawaz/monocular-vo/blob/main/figures/demo.mp4

La clip inclusa e usata esclusivamente come regressione esterna per verificare che AlvaAR non dipenda dal fixture sintetico.
