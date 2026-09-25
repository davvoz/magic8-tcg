# 13 — Scambi fra giocatori

**Stato:** M7.5, 2026-09-25.
- **Server:** modulo `trading` (`TradeService`); escrow nel modulo collection (`InventoryService.escrow/release/transfer`).
- **Protocollo:** record `m8tcg_trade` in `@magic8/protocol` (`tradeRecord`, `parseTradeRecord`).
- **Client:** schermata "Trades", raggiungibile dalla collezione.

## Cosa si può scambiare

- **Carta contro carta.** Un giocatore offre alcune sue copie (fino a 10) a un altro giocatore e chiede in cambio fino a 10 carte, per tipo e quantità. Chiedere niente è un regalo.
- **Solo copie comprate** (ordini e pacchetti). Le carte gratuite (mazzo iniziale, omaggi) non si scambiano: altrimenti chiunque potrebbe creare molti account, prendere lo starter con ciascuno e passare tutto a un account solo.
- **Niente vendite contro STEEM.** È una scelta di sicurezza, non una mancanza:
  - un escrow vero dei fondi richiederebbe che il server firmi con una chiave active (o che faccia da agente di `escrow_transfer`);
  - il server non tiene mai chiavi con autorità sui fondi (05, 06).
  - Se servirà: `escrow_transfer` di STEEM con un agente **esterno** e indipendente, oppure pagamento diretto al venditore con la carta bloccata fino alla conferma. In entrambi i casi va affrontato il rimborso quando qualcosa va storto.

## Come funziona l'escrow

| Momento | Cosa succede alle copie |
|---|---|
| Offerta | Le copie offerte diventano `locked` (evento `LOCKED`): non valgono per i mazzi e non si possono offrire in un altro scambio |
| Accettazione | In una sola transazione: le copie del destinatario (scelte da lui, oppure quelle col seriale più alto) e quelle in escrow cambiano proprietario (`TRANSFERRED`) e tornano `active`. Nella stessa transazione si mette in coda il record `m8tcg_trade` |
| Rifiuto, annullamento, scadenza (72 ore) | Le copie in escrow tornano al proponente (`UNLOCKED`) |

- **Chi può fare cosa:** accetta o rifiuta solo il destinatario, annulla solo il proponente, e una volta sola. Gli altri ricevono "no such trade", perché uno scambio non si rivela a chi non ne fa parte.
- **Concorrenza:** le righe si bloccano sempre in ordine di id, e lo stato passa da `OPEN` con un compare-and-set. Due accettazioni simultanee producono un solo scambio.
- **Idempotenza:** un'offerta porta un `Idempotency-Key`. La stessa chiave con un'offerta diversa è un errore.
- **Limiti:** 10 offerte aperte per giocatore; limiti di frequenza sulle rotte.
- **Mazzi:** un mazzo che usava carte date via, o in escrow, diventa non giocabile finché non si sistema. Le partite in corso non cambiano, perché usano il mazzo congelato.

## Sulla catena

Ogni scambio concluso è pubblicato dal pool di broadcaster:

```json
{"a":{"cards":[["<id copia>","ember_imp",4,"f"]],"u":"alice"},"b":{"cards":[["<id copia>","iron_watcher",9,"s"]],"u":"bob"},"t":"<id scambio>","v":1}
```

`a` ha proposto e ha dato le sue carte a `b`; `b` ha dato le sue ad `a`. Con le ricevute di acquisto (03 §12) si ricostruisce da chi è passata ogni copia, dal conio a oggi. Il tracker segue questi record come gli altri: un `m8tcg_trade` firmato dal nostro broadcaster e sconosciuto al database genera l'allarme `UNKNOWN_ON_CHAIN`.

## Verificare una copia

```
node tools/verify-card.js <id copia> [--root account] [--nodes urls] [--json]
```

Legge dalla sola catena la ricevuta che ha coniato la copia e ogni scambio che l'ha spostata (`verifyCopyOnChain` in `@magic8/protocol`). Contano solo le operazioni firmate dai broadcaster che il root ha autorizzato.

| Esito | Significato |
|---|---|
| `VALID` | Coniata da un solo ordine, e ogni scambio l'ha ceduta chi la possedeva in quel momento. Stampa il proprietario di oggi |
| `UNKNOWN` | Nessuna ricevuta la nomina: una carta gratuita (non si pubblica e non si scambia), oppure non ancora pubblicata |
| `INVALID` | La catena si contraddice: coniata da due ordini, ceduta da chi non la possedeva, scambiata prima di essere coniata, o come un'altra stampa, oppure due record diversi per lo stesso scambio |

## API

| Richiesta | Cosa |
|---|---|
| `GET /api/trades` | Gli scambi del giocatore, dal più recente |
| `POST /api/trades` + `Idempotency-Key` | `{ "to", "give": [id copia], "want": [{ "definitionId", "count" }] }` |
| `POST /api/trades/:id/accept` | `{ "copies"?: [id copia] }`: le copie scelte; senza, il server sceglie quelle col seriale più alto |
| `POST /api/trades/:id/decline`, `/cancel` | |

WebSocket: `trade.updated { tradeId }` a entrambi i giocatori a ogni cambiamento.

## Da fare

- Un limite giornaliero di scambi fra gli stessi due account, se i ranking o i premi acquisteranno valore: oggi scambiarsi carte non dà vantaggi in classificata.
