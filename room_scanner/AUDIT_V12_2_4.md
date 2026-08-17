# Audit V12.2.4

## Problemi affrontati

### Instabilità dei corner metrici

Problema precedente: il vertice del footprint poteva essere sostituito da una singola misura WebXR successiva. Con oscillazioni metriche di decine di centimetri la parete cambiava visibilmente posizione durante il workflow.

Correzione: ogni corner conserva una lista di sight-rays multi-vista. `solveCornerAnchor()` stima un'unica linea verticale tramite robust least squares/IRLS e mantiene un prior debole sul punto iniziale. Vengono misurati numero viste, baseline angolare, residuo e confidence.

### Corner inferiori coperti

Il ray osservato non deve colpire necessariamente il pavimento. Dopo che XZ del corner verticale è stimato, un sight-ray sul raccordo parete-soffitto fornisce una quota Y della stessa linea verticale. Le quote persistenti alimentano `cornerCeilingSamples`.

### Shell apparentemente aperta

La mesh era già costruita con floor/ceiling faces ma la preview poteva renderle poco leggibili. `drawRoomCaps()` rende esplicitamente i due poligoni nel viewer isometrico.

### Pareti WebXR spesse

I raw surfel WebXR restano disponibili come evidenza, ma `buildSnappedXrModel()` crea una rappresentazione strutturale separata proiettando soltanto surfel persistenti/compatibili sulle superfici parametriche della stanza.

### Perdita degli oggetti dopo lo snapping

Il PLY non deve usare soltanto la cloud XR snapped. V12.2.4 costruisce transitoriamente una `objectMap` dalle point cloud degli oggetti XR+Deep e la esporta come `source=4`.

### Foto incomplete di pareti lunghe

La coverage è per superficie, non per fotografia. Il completamento della fase foto richiede una soglia minima per ogni parete, consentendo più scatti parziali della stessa parete.

## Audit statico finale

- 299 funzioni nominate / 299 uniche;
- 90 ID DOM / 90 unici;
- 37 listener diretti / 37 unici;
- una sola `navigator.xr.requestSession()`;
- zero `getUserMedia()`;
- zero `setInterval()`;
- raw camera solo tramite `camera-access` della stessa sessione WebXR.

## Test automatici

PASS:

- `node --check` del modulo JavaScript;
- `test_v12_2_4_static.js`;
- `test_v12_2_4_runtime.js`;
- `test_v12_2_4_package.js`.

Il runtime sintetico verifica esplicitamente che un corner inizialmente spostato venga recuperato da tre viste e che la quota soffitto derivi da più osservazioni del raccordo superiore.

## Limite

WebXR raw camera/depth/plane/mesh e la stabilità reale ARCore restano verificabili soltanto su hardware Android compatibile.
