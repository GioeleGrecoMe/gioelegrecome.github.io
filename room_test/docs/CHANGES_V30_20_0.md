# V30.20.0 - Sparse Depth Quality Gate

## Obiettivo

Mantenere AlvaAR come sorgente autorevole per pose, geometria e scala comune, usando Depth Anything V2 Small Q4 soltanto come prior denso relativo. La depth neurale viene accettata solo se strutturalmente coerente, calibrata sugli anchor metrici/Alva e verificata multi-view prima della fusione.

## Problemi trovati in V30.19

1. La scansione aveva due percorsi aggiuntivi di preview Deep quasi a 1 Hz oltre all'inferenza selettiva dei keyframe. Questo aumentava costo e contesa senza aggiungere informazione 3D utile.
2. Il controllo WebGPU cercava soprattutto bande/strisce direzionali. Un output isotropicamente rumoroso, come una mappa a neve/confetti, poteva avere rapporto direzionale vicino a 1 e quindi risultare falsamente valido.
3. Il test esplicito poteva eseguire due inferenze WASM diagnostiche oltre alle WebGPU e ricaricare il modello, peggiorando il tempo totale.
4. La calibrazione Deep -> Alva copriva affine in raw e affine in 1/raw, ma non la relazione disparity-like 1/z = a*raw+b.
5. La preview neurale mostrata e la depth usata per la geometria potevano provenire da percorsi di inferenza diversi.

## Correzioni

- Rimossi il controller neurale free-running e `requestLiveDepth`: Deep viene richiesto solo dal `DeepKeyframeSelector`.
- Target dinamico mobile ridotto da 518 a 392 pixel sul lato di riferimento, mantenendo dimensioni multiple di 14; 518 resta il limite/fallback di compatibilita'.
- Aggiunto `depthQualityDiagnosis` con coerenza spaziale far-neighbor / near-neighbor: rumore isotropo viene riconosciuto anche senza stripe.
- Aggiunto controllo di equivarianza al flip orizzontale nel test esplicito.
- Se una prima mappa WebGPU e' sospetta, viene eseguito un solo riferimento WASM. WebGPU viene disabilitato automaticamente soltanto quando il confronto indica divergenza e il riferimento WASM e' strutturato.
- Riutilizzati temporaneamente i byte del modello nel controllo A/B per evitare una seconda lettura/download del Q4 da circa 27 MB.
- La preview durante la scansione e' ora esattamente la depth del keyframe selezionato che viene candidata alla calibrazione e alla geometria.
- La calibrazione robusta Deep -> Alva prova tre famiglie: `z=a*raw+b`, `z=a*(1/raw)+b`, `1/z=a*raw+b`, scegliendo quella con residuo metrico robusto migliore.
- Diagnostica aggiornata con coerenza spaziale, flip-equivalence, A/B WASM e decisione di fallback.

## Verifica automatica

`npm run verify` passa integralmente in V30.20.0: 78/78 test Node, diagnostica depth, chiusura dipendenze, layout, costruttori EventTarget, mock UI e contratto runtime AlvaAR.

Il test sintetico di rumore isotropo produce un rapporto stripe vicino a 1 (quindi non sospetto per il vecchio criterio) ma un rapporto di coerenza circa 1.03, sotto la soglia 1.28, e viene correttamente rifiutato.

## Limite della verifica locale

Il container non replica il browser WebGPU dello smartphone. La qualita' effettiva del kernel Q4/WebGPU va quindi confermata sul dispositivo; la build ora rende pero' esplicito il verdetto e dispone del fallback WASM controllato invece di fondere silenziosamente una mappa incoerente.
