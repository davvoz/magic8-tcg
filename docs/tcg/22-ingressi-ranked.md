# 22 — Ingressi ranked

**Stato:** 2026-10-03. Modulo `entries` del server, migrazione `016_entries.sql`, prodotto `data/economy/products/ranked_entry.json`, regola di stagione `entryFee` in `data/ranked/ranked.json`.

## Le regole

- Da **Season 1** ogni partita classificata costa **1 STEEM a giocatore**. La Beta season resta gratuita.
- Si paga con gli **ingressi ranked** (*Ranked Entry*), comprati nello shop a 1 STEEM l'uno. Se ne comprano quanti se ne vuole **con un solo trasferimento**: Keychain chiede conferma una volta sola, non prima di ogni partita.
- Il pagamento va al wallet della banca (`@verdu.green`, lo shop account) come ogni acquisto dello shop. Il jackpot della stagione è una quota di quel wallet (doc 21), quindi cresce con ogni ingresso venduto.
- Una partita classificata toglie **un ingresso a ciascuno dei due giocatori** nel momento in cui viene creata (coda o sfida accettata in lobby).
- Una partita **annullata prima di cominciare** (un giocatore rifiuta la firma Keychain o non firma in tempo) **restituisce** gli ingressi a entrambi.
- Una partita cominciata non restituisce niente: resa, abbandono e tempo scaduto valgono come partite giocate.
- Gli ingressi non scadono: quelli non usati restano per le stagioni successive. Non sono rimborsabili.
- Le partite casual restano gratuite.

## Cosa vede il giocatore

Ai giocatori diciamo solo che **gli ingressi finiscono nel jackpot**, senza spiegare quale quota del wallet diventa jackpot.

| Dove | Cosa |
|---|---|
| Lobby online (colonna della partita) | sotto il rating: *You have 3 ranked entries · 1 entry a game · every entry goes into the season's jackpot.* In rosso quando non ne ha. |
| Lobby, modalità Ranked senza ingressi | al posto di *Find a match* c'è **Get ranked entries**, che apre lo shop sullo scaffale Ranked (*Back* torna alla lobby) |
| Sfide ranked | *Ranked game* e *Accept* sono disattivati senza ingressi, e il dialogo spiega perché |
| Shop, scaffale **Ranked** | *1 ranked game · 1.000 STEEM · into the jackpot*; nel dettaglio *Every entry goes into the season's jackpot.*, quanti ingressi ha il giocatore, quantità fino a 50 per ordine |
| Dopo l'acquisto | *Done: 5 ranked entries are yours, and in the season's jackpot.* (niente rivelazione di carte) e la notifica *Your ranked entries are ready*, che porta alla lobby |
| Pannello del jackpot | *grows with every pack sold and every ranked game* |

## Come funziona

- **Acquisto: riusa lo shop.** `ranked_entry` è un prodotto normale. Il nuovo tipo di contenuto `entry` (`ref`: il tipo di ingresso, `ranked`) dà 0 carte. Ordine, memo, verifica del pagamento, rimborsi dei trasferimenti sbagliati e ricevuta on-chain sono quelli di sempre. Quando l'ordine viene evaso, `FulfilmentService` accredita gli ingressi tramite `EntryService.credit` nella stessa transazione: o succede tutto o niente.
- **Saldo e registro.** `entry_balances` tiene il saldo per giocatore e tipo, con `CHECK (balance >= 0)`. `entry_ledger` registra ogni movimento, solo in aggiunta, con chiave `(utente, tipo, motivo, riferimento)`:
  - `purchase`: riferimento l'ordine;
  - `game`: riferimento la partita, con la stagione addebitata;
  - `refund`: riferimento la partita.

  Tentativi ripetuti e processi concorrenti applicano ogni movimento una sola volta.
- **Quanto costa.** `entryFee` della stagione in corso (ingressi a partita, 0–100; assente = gratis). `RankingService.entryFeeOf(mode)` lo legge, `EntryService` lo riceve come politica e non conosce le stagioni.
- **Coda.** `queue.join` ranked rifiuta chi non ha gli ingressi (`ENTRY_REQUIRED`, HTTP 402). Quando abbina due biglietti, `MatchmakingService` blocca i saldi dei due giocatori (`FOR UPDATE`, in ordine di id), crea la partita e addebita, tutto nella stessa unità di lavoro. Se nel frattempo un giocatore è rimasto senza ingressi, il suo biglietto viene annullato. Lui riceve `queue.status { state: "idle", reason: "entries" }`, l'altro resta in coda: la coda non si blocca mai.
- **Sfide.** La lobby controlla gli ingressi di entrambi quando la sfida parte e quando viene accettata (*@bob has no ranked entries left*). `startDirect` addebita nella transazione che crea la partita.
- **Restituzione.** `GameService.onGameAborted` chiama gli ascoltatori dentro l'unità di lavoro che annulla la partita. `EntryService.refundGame` restituisce esattamente quanto addebitato, una sola volta.
- **API.** `GET /api/entries` (con accesso) restituisce `{ entries: [{ kind: "ranked", balance, perGame, season }] }`.

## Configurazione

```json
{ "id": "season-1", "name": "Season 1", "startsAt": "2026-10-05T00:00:00Z", "endsAt": "2026-11-05T00:00:00Z", "prizePool": "bank-jackpot", "entryFee": 1 }
```

Il prezzo di un ingresso sta nel prodotto (`ranked_entry.json`, `prices`), come ogni prezzo dello shop. Si possono aggiungere confezioni, per esempio *10 ingressi* come prodotto con `{ "type": "entry", "ref": "ranked", "count": 10 }`: lo scaffale Ranked le mostra da solo. Un nuovo tipo di ingresso (un torneo) è un nuovo valore in `EntryKind` e una modalità di gioco con lo stesso nome.

## Rischi e limiti

- Il jackpot resta una quota del wallet della banca: un ingresso comprato e non ancora giocato fa già crescere il jackpot.
- Gli ingressi sono legati all'account di gioco: non si scambiano e non si vendono.
- Fair play (doc 09): le partite oltre il limite giornaliero fra la stessa coppia costano l'ingresso ma non cambiano il rating.
