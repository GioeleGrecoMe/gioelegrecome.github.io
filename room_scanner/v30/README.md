# Room Scanner V30.11.0

Runtime V30 con boot UI-first e calibrazione WebXR minimale.

## Calibrazione
1. Apri **Calibra con WebXR**.
2. Porta il reticolo sul punto fisico desiderato.
3. Quando profondita e stabilita sono disponibili, premi **Aggiungi pin**.
4. Ripeti per almeno 3 pin ben distribuiti.
5. Muoviti lateralmente e osserva i pin da piu prospettive: la ROI multi-view viene acquisita in background.
6. Premi **Fine** quando abilitato.

Ogni pin visuale corrisponde a un `XRAnchor`; non esiste fallback a coordinate 2D fisse.
