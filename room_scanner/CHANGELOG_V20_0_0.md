# Changelog V20.0.0

## Geometria

- Rimossa la chiusura automatica vicino al primo angolo.
- Rimossi i limiti pratici su pareti e spigoli ravvicinati.
- Epsilon numerico di nucleo e interfaccia ridotto a `1e-5 m`, usato soltanto contro punti coincidenti; nessuna distanza minima operativa tra spigoli.
- Target fotografici adattivi anche su rientranze e pareti molto strette.
- Chiusura del perimetro esclusivamente tramite azione esplicita.

## Stabilità post-WebXR

- Aggiunto handoff end XR → cleanup → checkpoint → reload → restore prima di Deep.
- Bloccato il processing mentre WebXR o l’handoff sono attivi.
- Rilascio esplicito di hit test, anchor, Raw Camera reader, depth, buffer RGBA e contesto WebGL.
- Nessuna structured clone durante WebXR; i JPEG vengono salvati dopo `end` come record IndexedDB indipendenti.
- Checkpoint mobili compatti: cap su voxel/punti e texture derivate escluse.
- Decodifica immagini per piccoli batch e parete singola per ridurre i picchi RAM.
- Fallback conservativo se reload, IndexedDB o sessionStorage non sono disponibili.
- Corretto il riuso di ID foto tra una scansione ignorata e una scansione nuova: un nuovo frame sovrascrive sempre l’eventuale record `photo:<id>` obsoleto.
- Il service worker non restituisce più la pagina HTML come fallback di una risorsa JavaScript mancante.

## Oggetti RGB

- Punti voxel con RGB fotografico conservati nel modello.
- Mesh voxel esterna con colore per vertice e tinta RGB per triangolo nel viewer.
- Etichetta acustica `bottom/top/front/back/right/left` per ogni triangolo della mesh.
- Riepilogo RGB, volume occupato, volume OBB e fill ratio.
- Punti sintetici esplicitamente marcati per oggetti manuali.
- Trasformazione coerente dei punti quando un oggetto viene ridimensionato o ruotato.
- Viewer con punti RGB, forma voxel e OBB.
- PLY con colore, ID oggetto e flag sintetico; OBJ con colori per vertice opzionali.

## Acustica

- Superfici indipendenti per pavimento, soffitto, pareti e sei facce di ogni oggetto.
- Bande 125–8000 Hz e scattering.
- Libreria e prior visivo/materiale adattati dalla V10.
- Confidenza automatica limitata a 0.28 e marcata come non misurata.
- Modifiche manuali autorevoli e persistenti.
- Aree parete nette delle aperture.
- Mappa di assorbimento nel viewer.
- Export acustico JSON e CSV.

## Compatibilità

- Schema RAW V20 con migrazione da `room-scanner-v15-raw`.
- Asset eseguibili V20 versionati e service worker network-first.
- Modello ONNX eseguito solo dopo il riavvio post-XR.
