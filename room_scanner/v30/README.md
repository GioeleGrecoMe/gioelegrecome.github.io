# Room Scanner V30.11.4

Runtime V30 con boot UI-first e calibrazione WebXR minimale.

## Calibrazione
1. Apri **Calibra con WebXR**.
2. Porta il reticolo sul punto fisico desiderato.
3. Quando profondita e stabilita sono disponibili, premi **Aggiungi pin**.
4. Ripeti per almeno 3 pin ben distribuiti.
5. Muoviti lateralmente e osserva i pin da piu prospettive: la ROI multi-view viene acquisita in background.
6. Quando almeno 3 pin mostrano viste sufficienti, riportali insieme nell'inquadratura.
7. Appena compare **PRONTO**, premi **Applica**. Le pose globali aggiuntive migliorano la diagnostica ma non bloccano piu il salvataggio.

Ogni pin visuale corrisponde a un `XRAnchor`; non esiste fallback a coordinate 2D fisse.
