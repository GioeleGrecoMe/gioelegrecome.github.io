# Test report V30.56

Data: 2026-08-23

## Esito

- `npm test`: **295/295 pass**
- `npm run check:public`: pass (TUM RGB-D pubblico, precisione matching 0.988, reprojection finale 0.031 px nel fixture)
- `npm run check:depth`: pass
- `npm run check:layout`: pass, 337 file sotto `v30/`
- `npm run check:deps`: pass, 63 riferimenti locali risolti e 5 root ESM importate
- `npm run check:constructors`: pass, 5/5 classi `EventTarget`
- `npm run check:mock`: pass
- `npm run check:alva`: pass
- `npm run verify`: **pass**

## Nuovi contratti V30.56

- planner atomico: ogni reference MVS richiede Deep sullo stesso `frameId`;
- profilo camera: intrinseci e distorsione restano congelati per l'intera scansione;
- ordine di produzione: scaffold RGB/Alva, pose freeze, MVS final-pose, Deep affine globale, dense fusion, TSDF;
- calibrazione `rho=aD+b`: due soli gradi di libertà globali, validazione leave-one-frame-out e ordinale;
- gerarchia Deep: anchor locale / conferma da almeno due viste / prior single-view;
- dense cloud: gate a migliaia di campioni e autorità indipendente dal risultato della mesh;
- identità build, boot module e service worker coerenti a V30.56.0.
