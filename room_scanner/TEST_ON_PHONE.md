# Validazione fisica V20 su smartphone

Queste prove devono essere eseguite su Chrome Android, HTTPS e dispositivo ARCore reale. Prima della prima prova cancellare i dati del sito della V15.

## 1. Identificazione build

Verificare nella landing:

```text
V20.0.0 · RGB + ACOUSTIC SURFACES
```

Aprire `build_info.json` e controllare la revisione:

```text
v20.0.0-rgb-acoustic-safe-handoff-20260818
```

## 2. Spigoli ravvicinati e nicchia

1. Avviare WebXR.
2. Inserire un vano rettangolare.
3. Aggiungere una nicchia con due spigoli distanti circa 1–3 cm.
4. Tornare molto vicino al primo angolo senza premere **Chiudi vano**.
5. Verificare che l’app resti in acquisizione angoli e non chiuda da sola.
6. Premere **Chiudi vano**.

Esito atteso: nessun messaggio di “muro troppo corto”; la nicchia appare nella planimetria. Un doppio tap sullo stesso identico punto può essere rifiutato.

## 3. Due o più vani nello stesso WebXR

1. Completare il primo vano.
2. Premere **Attraversa passaggio**.
3. Attraversare la porta e confermare il nuovo vano.
4. Acquisire il secondo perimetro senza uscire da WebXR.
5. Ripetere con un terzo vano o corridoio stretto.

Esito atteso: un solo riferimento metrico, porte collegate e nessuna registrazione libera tra stanze.

## 4. Caselle fotografiche

1. Inquadrare una casella rossa finché viene acquisita.
2. Verificare che una casella bassa diventi gialla dopo la prima posizione.
3. Spostarsi lateralmente di circa mezzo metro e riprenderla.
4. Verificare il passaggio a verde.
5. Lasciare volontariamente alcune caselle rosse e completare il vano con almeno tre foto da due posizioni.

Esito atteso: le caselle residue non bloccano la chiusura.

## 5. Uscita sicura e riavvio

1. Durante uno scatto automatico, premere **Salva e chiudi** oppure usare Indietro.
2. Verificare che lo scatto venga completato o annullato senza pagina bianca.
3. Attendere la chiusura XR.
4. Osservare un breve reload della stessa pagina.
5. Verificare che si apra automaticamente la revisione con vani e fotografie presenti.
6. Verificare che **Processa Deep + acustica** sia disabilitato prima del reload e abilitato dopo il ripristino.

Esito atteso: nessun crash del tab e nessuna perdita del checkpoint.

## 6. Stress memoria post-XR

1. Acquisire almeno 3 vani e 20–30 fotografie totali.
2. Chiudere WebXR e avviare il profilo **Bilanciato**.
3. Monitorare temperatura, uso memoria e log diagnostico.
4. Ripetere con **Rapido** se il dispositivo è di fascia bassa.

Esito atteso: le pareti vengono processate una alla volta; il browser non chiude la pagina. Un errore Deep deve lasciare disponibili modello metrico, RGB esistente, editing ed export.

## 7. Oggetto RGB acquisito

1. Fotografare un mobile da almeno due posizioni distinte.
2. Processare.
3. Aprire il viewer 3D e attivare **Punti RGB**, **Forma voxel** e **Oggetti**.
4. Verificare che colore e ingombro approssimativo siano riconoscibili.
5. Ruotare e ridimensionare l’oggetto nell’editor.
6. Verificare che i punti si spostino con il nuovo OBB e non restino come fantasma.
7. Nascondere, rimuovere e ripristinare l’oggetto.

Esito atteso: punti, forma e superficie acustica seguono lo stato dell’oggetto.

## 8. Oggetto manuale

1. In planimetria scegliere **Aggiungi oggetto**.
2. Definire il rettangolo e l’altezza.
3. Aprire il viewer.

Esito atteso: compaiono punti RGB sintetici e forma cuboide. Nel PLY il flag `synthetic` vale 1.

## 9. Superfici acustiche

1. Aprire **Caratterizzazione acustica**.
2. Verificare pavimento, soffitto, ogni parete e sei facce per oggetto.
3. Selezionare una parete e cambiare materiale.
4. Selezionare “Gruppo geometrico”, impostare tutti i coefficienti e lo scattering a `0.00`, applicare e verificare che lo zero non venga sostituito da un default.
5. Ripristinare Auto, poi modificare almeno un coefficiente per banda e lo scattering.
6. Salvare, chiudere la revisione, riaprirla e verificare la persistenza.
7. Attivare **Mappa α** e cambiare banda.
8. Esportare JSON e CSV acustici.
9. Importare il RAW e controllare che la modifica manuale resti autorevole.
10. Nel RAW verificare che ogni oggetto abbia un `triangleFaceKeys` per triangolo e che le sei superfici abbiano un `geometryRef.triangleFaceKey` corrispondente.

Esito atteso: le superfici automatiche mostrano bassa confidenza e indicazione “non misura RIR”; le modifiche manuali hanno sorgente `user`.

## 10. Export geometrico

- Aprire il PLY in CloudCompare o MeshLab e controllare RGB, `object_id` e `synthetic`.
- Aprire l’OBJ in un lettore che supporta colori per vertice; in un lettore che li ignora, la geometria deve comunque essere valida.
- Verificare nel RAW `shape`, `rgbSummary`, `acousticSurfaces` e `acousticSummary`.

## 11. Offline e fallback

1. Caricare una volta la shell online.
2. Riavviare in modalità aereo.
3. Verificare apertura, revisione, editing ed export.
4. Senza modello locale, il Deep può non avviarsi: l’app non deve perdere la scansione.
5. Per Deep interamente offline, installare runtime e modello nelle cartelle documentate.

## Dati da riportare in caso di errore

- modello smartphone;
- versione Android e Chrome;
- build V20 visibile;
- fase esatta;
- numero di vani/foto/oggetti;
- profilo processing;
- log Diagnostica esportato o copiato;
- disponibilità Raw Camera e XR Depth;
- se il reload post-XR è avvenuto;
- memoria libera approssimativa e temperatura percepita.
