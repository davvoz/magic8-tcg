# 16 — Illustrazioni delle carte

**Stato:** 2026-09-27; aggiornato il 2026-09-29 (finestra dell'arte 7:4, grafica del tavolo e dei menu).
- **Dati:** `data/art/illustrations.json` (quali carte hanno un'illustrazione) e i file immagine accanto, in `data/art/`.
- **Client:** `IllustrationManifest` (legge e valida il file), `CardIllustrations` (scarica le immagini su richiesta), `paintCardArt` (disegna l'illustrazione se è pronta, altrimenti l'arte procedurale).

## L'idea

Le carte nascono con un'arte **procedurale** (motivo della fazione + emblema del tipo, `CardArt.js`). Le illustrazioni dipinte la sostituiscono **una carta alla volta**: una carta elencata nel manifest mostra la sua immagine, tutte le altre restano procedurali. I due sistemi convivono senza data di scadenza, e l'arte procedurale resta comunque come ripiego:

| Situazione | Cosa si vede |
|---|---|
| Carta non elencata nel manifest | arte procedurale |
| Immagine in caricamento | arte procedurale, poi l'immagine appena è decodificata (ridisegno automatico) |
| Immagine mancante, danneggiata o vuota | arte procedurale per tutta la sessione, con un avviso nel log |
| Manifest assente o malformato | tutte le carte procedurali, con un avviso nel log; il gioco parte comunque |

Il gioco scarica tutte le illustrazioni in background dopo l'avvio (4 alla volta), così è raro che una carta appaia prima procedurale. L'arte non è una regola di gioco: sta accanto a `GameContent` come le rarità, e cambiare un'immagine non tocca `core.cards.json`.

## Aggiungere un'illustrazione

1. Copia il file in `data/art/`, per esempio `data/art/ember_imp.webp`.
2. Aggiungi la carta al manifest:

```json
{
  "schemaVersion": 1,
  "cards": {
    "ember_imp": { "file": "ember_imp.webp", "focus": [0.5, 0.35] }
  }
}
```

3. Controlla il risultato con il tool di preview: `/tools/preview/?scene=editor&inspect=1` (carta grande) e `/tools/preview/?scene=match` (carte piccole). Con `&art=procedural` le stesse schermate mostrano le carte senza illustrazioni, per il confronto.

Nessuna modifica al codice. Regole del manifest (un errore invalida tutto il file, così un refuso si vede subito):
- `file`: solo il nome, minuscolo, senza cartelle, con estensione `.webp`, `.png`, `.jpg` o `.jpeg`.
- `focus` (facoltativo, predefinito `[0.5, 0.5]`): il punto dell'immagine da tenere in vista quando viene ritagliata, da 0 a 1 su ogni asse (`[0, 0]` è l'angolo in alto a sinistra).
- Una carta che il catalogo non conosce viene ignorata, con un avviso nel log.
- Per sostituire un'immagine già pubblicata conviene cambiare nome al file (`ember_imp_v2.webp`), così i browser non tengono quella vecchia in cache.

## Specifiche per chi disegna

La finestra dell'arte ha **proporzioni fisse 7:4** (1,75 : 1), le stesse delle illustrazioni dipinte (1344 × 768), in ogni vista: è larga l'88% della carta e alta quanto serve per mantenere il rapporto (`ART_ASPECT` in `CardFace.js`). Un'immagine 7:4 si vede quindi **intera**, senza ritagli. Un'immagine con proporzioni diverse viene ritagliata per coprire la finestra, senza deformarla, centrata su `focus`.

| Vista | Carta (px logici) | Finestra dell'arte |
|---|---|---|
| Carta grande (ispezione, negozio) | 380 × 560 | ~334 × 191 |
| Carta in mano | 170 × 238 | ~150 × 85 |
| Carta sul tavolo | 150 × 210 | ~132 × 75 |

Quindi:
- **Formato consigliato: 7:4 orizzontale, 1344 × 768 px** (quello delle illustrazioni attuali). Basta per la carta grande anche su schermi ad alta densità.
- Con un altro formato (per esempio 3:2) si perde una parte dell'altezza: sposta `focus` sull'asse y per tenere in vista il soggetto invece di ridisegnare.
- **JPEG o WebP, qualità ~80–95**, idealmente sotto i 200–300 KB. Il server rifiuta file oltre i 5 MB.
- Niente testo, cornici o bordi nell'immagine: nome, cornice e vignettatura li disegna il gioco. Sopra l'illustrazione non compare l'emblema del tipo.
- I bordi vengono scuriti da una vignettatura nel tono della fazione: meglio non mettere dettagli importanti negli angoli.

## Note tecniche

- Le immagini arrivano dalla stessa origine (`/data/art/`), quindi la CSP resta `img-src 'self' data:`. Il server statico serve `.webp`, `.png`, `.jpg` e `.jpeg`.
- `Theme.illustrations` non viene da `theme.json`: lo aggiunge la composition root (`main.js`). Senza, ogni carta è procedurale, ed è il caso dei test.
- Il disegno resta sincrono. `CardIllustrations.imageFor` risponde subito (immagine o `null`) e avvia il download alla prima richiesta. Il loader è iniettato (`loadBrowserImage` nel browser, un finto loader nei test).
- Se un giorno le carte in partita diventassero tante e grandi da pesare sul frame, il passo successivo è tenere una copia già ridotta di ogni immagine per le carte piccole. Per ora non serve: il loop ridisegna solo quando qualcosa cambia.

## Grafica del tavolo e dei menu

Con lo stesso principio (immagine dipinta se pronta, altrimenti disegno procedurale, nessun errore se manca) il client carica anche altre immagini da `data/art/`. Sono fisse nel codice (`main.js`), non in un manifest:

| Oggetto | Classe | File |
|---|---|---|
| Tappeto della partita, dorso delle carte, pietra dei pannelli | `TableArt` (`TablePiece.MAT`, `CARD_BACK`, `PANEL`) | `Tappeto.jpg`, `Dorso.jpg`, `Texture.jpg` |
| Sfondo dei menu, angoli dei pannelli, medaglione dei divisori, pulsanti primari e secondari | `UiArt` (`UiPiece`) | `Sfondo_Menu.jpg`, `Angolo_decorativo_pannelli.jpg`, `DIVISORE_TITOLI.jpg`, `BOTTONE_PRIMARIO.jpg`, `BOTTONE_SECONDARIO.jpg` |
| Moneta del sorteggio iniziale (testa e croce, 1024²) | `CoinArt` | `coin_testa.png`, `coin_croce.png` |

- Le immagini dei menu sono oro su nero, 1168 × 784 o 784 × 1168. `UI_ART.layout` in `main.js` dice dove stanno le parti utili in ogni immagine, in frazioni: se si rigenera un file, quelle misure vanno riprese.
- La pietra dei pannelli non si ripete senza cuciture, quindi viene stirata, mai affiancata.
- `TableArt` e `UiArt` derivano da `PieceArt` (un insieme fisso di pezzi, un'immagine ciascuno, caricata su richiesta tramite `ImageCache`).
