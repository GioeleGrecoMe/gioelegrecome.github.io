# Audit V12.2.0

## Decisione architetturale

La V12.1.x tentava ancora di ricostruire automaticamente struttura e oggetti da evidenze dense. Il collo di bottiglia osservato sul dispositivo era sia computazionale sia geometrico: una monocular depth per foto poteva generare superfici quasi coincidenti ma con slope differente.

V12.2.0 riduce il problema prima dell'ottimizzazione:

- struttura orizzontale di base = poligono scelto/corretto dall'utente in coordinate WebXR;
- pareti = estrusioni dei lati del poligono;
- variabili Deep = scala/shift della depth, classificazione lungo il raggio, quota soffitto e residuo davanti alle pareti.

## Bug/rischi eliminati

1. **Fogli Deep ruotati**: eliminati per costruzione; i wall samples sono proiettati sul piano noto.
2. **Auto-keyframe e RAM**: eliminati; solo foto esplicite.
3. **TSDF live**: disabilitata nel workflow guidato.
4. **Plane/mesh structural clustering live**: disabilitato; non necessario alla pianta manuale.
5. **ONNX + WebXR simultanei**: evitati; Deep è batch dopo la chiusura XR.
6. **Perimetro auto-intersecante**: bloccato prima della conferma.
7. **Lati troppo corti**: bloccati.
8. **Cambio topologia dopo foto pareti**: le foto wall precedenti vengono escluse per non mantenere wallIndex non più affidabili.
9. **Double tap durante cattura**: il pulsante primario viene disabilitato finché il keyframe non è acquisito o scade.
10. **Mobili usati come parete nel fit**: quando la depth XR same-view è sufficientemente distribuita, il fit usa solo XR; il wall render è fallback. Quando serve il fallback, RANSAC tratta mobili/occlusioni come outlier.
11. **Depth dietro parete**: rifiutata; non può espandere la stanza.
12. **Soffitto da singolo pixel/foto**: stima aggregata tra cluster alto e upper envelope dei wall-inlier su più foto, con fallback sicuro.

## Residual risk

- Il `local-floor` può subire drift/relocalizzazione: per questo il workflow rende i punti correggibili in AR prima della conferma.
- Se una parete è completamente coperta in tutte le foto e la CPU depth XR è assente, il fit di quella foto può essere ambiguo. Il batch la marca debole invece di deformare la parete.
- La quota del soffitto resta più incerta del footprint. Il RAW conserva confidence e può essere ricalcolato.
- Gli oggetti sono ancora mesh coarse da voxel/residuo; il loro raffinamento semantico/materiale è volutamente successivo alla stabilizzazione della stanza.
