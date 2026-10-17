# 22 — Ingressi ranked

**Stato:** 2026-10-03 (nome nel gioco: *ranked ticket*, dal 2026-10-17). Modulo `entries` del server, migrazione `016_entries.sql`, prodotto `data/economy/products/ranked_entry.json`, regola di stagione `entryFee` in `data/ranked/ranked.json`.

## Le regole

- Ogni partita classificata costa **1 STEEM a giocatore**, già dalla Beta season in corso e poi in Season 1.
- Si paga con gli **ingressi ranked**, che nel gioco si chiamano **ticket** (*Ranked Ticket*; dal 2026-10-17 ogni testo per i giocatori dice *ticket*, il codice e le API restano `entry`/`entries`), comprati nello shop a 1 STEEM l'uno. Se ne comprano quanti se ne vuole **con un solo trasferimento**: Keychain chiede conferma una volta sola, non prima di ogni partita.
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
| Schermata Ranked (dal 2026-10-17, doc 17) | la fascia *YOUR RANKED TICKETS*: i **biglietti** (vedi sotto), *3 tickets* (in rosso *None yet*), *A game uses 1 · 1.000 STEEM each*, *All go into the jackpot*, e **Get tickets** / **Get more**, che apre l'acquisto **lì** (dialogo: quantità, totale, *Buy 5 tickets · 5.000 STEEM*). La lista *READY TO PLAY?* dice se mancano ingressi. La ricerca è *Find a ranked match · 1 ticket*: la partita prende un ingresso, non STEEM (prima i pulsanti dicevano *· 1.000 STEEM*, refuso corretto). **How ranked works** (le tre figure) è nella barra. |
| Lobby, scheda Ranked senza ingressi | al posto di *Find a match* c'è **Get ranked tickets**, che apre lo shop sullo scaffale Ranked (*Back* torna alla lobby) |
| Sfide ranked | dalla schermata Ranked: *Challenge @bob to a ranked game*, con *The game takes 1 ranked ticket from each of you when it starts.*; senza ingressi *Send challenge* e *Accept* sono disattivati e c'è **Get tickets** |
| Shop, scaffale **Ranked** | *1 ranked game · 1.000 STEEM · into the jackpot*; nel dettaglio *Every ticket goes into the season's jackpot.*, quanti ingressi ha il giocatore, quantità fino a 50 per ordine. Sotto, i biglietti del giocatore e quanti ne aggiunge l'ordine (*+5 ranked tickets*, *You will hold 7 after this order.*); sul telefono i biglietti stanno accanto alle righe |
| Dopo l'acquisto | *Done: 5 ranked tickets are yours, and in the season's jackpot.* (niente rivelazione di carte) e la notifica *Your ranked tickets are ready*, che porta alla lobby |
| Pannello del jackpot | *grows with every pack sold and every ranked game* |

### I biglietti

Ogni ingresso è disegnato come un **biglietto di carta invecchiata** (`rendering/scenes/entries/EntryTickets.js`): oro del tema, cornice doppia stampata, *ADMIT ONE · RANKED*, il prezzo di un ingresso, la matrice da strappare con un **sigillo d'oro** che dice quanti ne ha il giocatore (*×3*) e il timbro *JACKPOT*. Più ne ha, più biglietti spuntano dietro (fino a tre). Senza ingressi resta il contorno tratteggiato in rosso, sigillo a *0*. L'usura (bordi bruniti, alone di caffè, macchie, piega) è generata da un seme, quindi sempre uguale per lo stesso biglietto. Solo disegno: nessuna logica nuova, i numeri vengono da `EntryService`.

## Come funziona

- **Acquisto: riusa lo shop.** `ranked_entry` è un prodotto normale. Il nuovo tipo di contenuto `entry` (`ref`: il tipo di ingresso, `ranked`) dà 0 carte. Ordine, memo, verifica del pagamento, rimborsi dei trasferimenti sbagliati e ricevuta on-chain sono quelli di sempre. Quando l'ordine viene evaso, `FulfilmentService` accredita gli ingressi tramite `EntryService.credit` nella stessa transazione: o succede tutto o niente.
- **Saldo e registro.** `entry_balances` tiene il saldo per giocatore e tipo, con `CHECK (balance >= 0)`. `entry_ledger` registra ogni movimento, solo in aggiunta, con chiave `(utente, tipo, motivo, riferimento)`:
  - `purchase`: riferimento l'ordine;
  - `game`: riferimento la partita, con la stagione addebitata;
  - `refund`: riferimento la partita.

  Tentativi ripetuti e processi concorrenti applicano ogni movimento una sola volta.
- **Quanto costa.** `entryFee` della stagione in corso (ingressi a partita, 0–100; assente = gratis). `RankingService.entryFeeOf(mode)` lo legge, `EntryService` lo riceve come politica e non conosce le stagioni.
- **Coda.** `queue.join` ranked rifiuta chi non ha gli ingressi (`ENTRY_REQUIRED`, HTTP 402). Quando abbina due biglietti, `MatchmakingService` blocca i saldi dei due giocatori (`FOR UPDATE`, in ordine di id), crea la partita e addebita, tutto nella stessa unità di lavoro. Se nel frattempo un giocatore è rimasto senza ingressi, il suo biglietto viene annullato. Lui riceve `queue.status { state: "idle", reason: "entries" }`, l'altro resta in coda: la coda non si blocca mai.
- **Sfide.** La lobby controlla gli ingressi di entrambi quando la sfida parte e quando viene accettata (*@bob has no ranked tickets left*). `startDirect` addebita nella transazione che crea la partita.
- **Restituzione.** `GameService.onGameAborted` chiama gli ascoltatori dentro l'unità di lavoro che annulla la partita. `EntryService.refundGame` restituisce esattamente quanto addebitato, una sola volta.
- **API.** `GET /api/entries` (con accesso) restituisce `{ entries: [{ kind: "ranked", balance, perGame, season }] }`.

## Configurazione

```json
{ "id": "2026-s1", "name": "Beta season", "startsAt": "2026-09-01T00:00:00Z", "entryFee": 1 },
{ "id": "season-1", "name": "Season 1", "startsAt": "2026-10-05T00:00:00Z", "endsAt": "2026-11-05T00:00:00Z", "prizePool": "bank-jackpot", "entryFee": 1 }
```

Il prezzo di un ingresso sta nel prodotto (`ranked_entry.json`, `prices`), come ogni prezzo dello shop. Si possono aggiungere confezioni, per esempio *10 ingressi* come prodotto con `{ "type": "entry", "ref": "ranked", "count": 10 }`: lo scaffale Ranked le mostra da solo. Un nuovo tipo di ingresso (un torneo) è un nuovo valore in `EntryKind` e una modalità di gioco con lo stesso nome.

## Classificata automatica

Un biglietto della lista automatica (23) costa lo stesso ingresso ranked di una partita a mano, ma lo toglie quando il giocatore entra in lista (`auto_ticket`, riferimento il biglietto), non quando la partita viene creata: dalla lista non si esce. Se la stagione finisce prima che arrivi un avversario, o la partita non si può giocare, l'ingresso torna indietro (`auto_refund`).

## Rischi e limiti

- La banca è anche un giocatore (@verdu.green): i suoi acquisti di ingressi sono trasferimenti a sé stessa. Il server li accetta come ogni pagamento, ma il saldo della banca, e quindi il jackpot, non cambia.
- Il jackpot resta una quota del wallet della banca: un ingresso comprato e non ancora giocato fa già crescere il jackpot.
- Gli ingressi sono legati all'account di gioco: non si scambiano e non si vendono.
- Fair play (doc 09): le partite oltre il limite giornaliero fra la stessa coppia costano l'ingresso ma non cambiano il rating.

## Come si scrivono gli importi

**Stato:** 2026-10-17. STEEM ha tre decimali, ma il gioco non li mostra quando non servono (`application/money/moneyText.js`):

- **Importi esatti** (prezzi, totali, trasferimenti, vendite): senza gli zeri finali e con le migliaia separate: *1 STEEM*, *0.5 STEEM*, *12.5 STEEM*, *1,250 STEEM*. Niente si perde: *0.125* resta *0.125*.
- **Cifre da colpo d'occhio** (il jackpot e i suoi premi, il portafoglio nella barra in alto): arrotondate per difetto, intere da 10 in su, al massimo due decimali sotto: *866 STEEM*, *86 STEEM*, *9.99 STEEM*. Per difetto, così non promettono più di quanto c'è.
- Il trasferimento vero (Keychain, chiave attiva) e i dati del server restano con i tre decimali.
