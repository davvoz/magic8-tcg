# 16 — Illustrazioni delle carte

**Stato:** 2026-09-27.
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

La finestra dell'arte **non ha proporzioni fisse**: la carta piccola (mano, tavolo, collezione) e quella grande (ispezione, negozio) usano bande diverse. L'immagine viene ritagliata per coprire tutta la finestra, senza deformarla, centrata su `focus`.

| Vista | Finestra (px logici) | Proporzioni | Quanto resta di un'immagine 3:2 |
|---|---|---|---|
| Carta grande (`CardFaceProfile.FULL`, 380×540) | 334 × 227 | ~1,47 : 1 | quasi tutta |
| Carta piccola (`CardFaceProfile.COMPACT`, 130×182) | 114 × 46 | ~2,5 : 1 | tutta la larghezza, il 60% centrale dell'altezza |

Quindi:
- **Formato consigliato: 3:2 orizzontale, 1200 × 800 px.** Basta per la carta grande anche su schermi ad alta densità.
- **Il soggetto sta nella fascia centrale**: nella carta piccola il 20% in alto e il 20% in basso si perdono. Se il soggetto è più in alto o più in basso, sposta `focus` sull'asse y invece di ridisegnare.
- **WebP, qualità ~80**, idealmente sotto i 200 KB. Il server rifiuta file oltre i 5 MB.
- Niente testo, cornici o bordi nell'immagine: nome, cornice e vignettatura li disegna il gioco. Sopra l'illustrazione non compare l'emblema del tipo.
- I bordi vengono scuriti da una vignettatura nel tono della fazione: meglio non mettere dettagli importanti negli angoli.

## Note tecniche

- Le immagini arrivano dalla stessa origine (`/data/art/`), quindi la CSP resta `img-src 'self' data:`. Il server statico serve `.webp`, `.png`, `.jpg` e `.jpeg`.
- `Theme.illustrations` non viene da `theme.json`: lo aggiunge la composition root (`main.js`). Senza, ogni carta è procedurale, ed è il caso dei test.
- Il disegno resta sincrono. `CardIllustrations.imageFor` risponde subito (immagine o `null`) e avvia il download alla prima richiesta. Il loader è iniettato (`loadBrowserImage` nel browser, un finto loader nei test).
- Se un giorno le carte in partita diventassero tante e grandi da pesare sul frame, il passo successivo è tenere una copia già ridotta di ogni immagine per le carte piccole. Per ora non serve: il loop ridisegna solo quando qualcosa cambia.
