# 14 — Vendite fra giocatori (bacheca)

**Stato:** M7.6, 2026-09-26.
- **Server:** modulo `sales` (`SalesService`: annunci, prenotazioni, bacheca; `SaleSettlement`: osserva la catena e consegna la carta). Escrow nel modulo collection, come per gli scambi.
- **Protocollo:** record `m8tcg_sale` in `@magic8/protocol` (`saleRecord`, `parseSaleRecord`).
- **Client:** schermata "Market", raggiungibile dal negozio ("Player market") e dalla collezione ("Market").

## L'idea

Un giocatore mette in vendita una sua copia a un prezzo in STEEM su una bacheca che vedono tutti, anche senza login. Un altro la compra pagando **direttamente il venditore**: il server non riceve, non custodisce e non inoltra mai fondi, e non tiene chiavi che possano muoverli (05, 06). Il server si limita a:

1. tenere la carta in escrow finché è in bacheca;
2. dire al compratore esattamente come pagare (destinatario, importo, memo);
3. leggere la catena e consegnare la carta quando il pagamento è irreversibile.

È la seconda strada indicata in 13 ("pagamento diretto al venditore con la carta bloccata fino alla conferma").

## Come funziona

| Momento | Cosa succede |
|---|---|
| **Annuncio** | Il venditore sceglie una copia scambiabile e un prezzo. La copia diventa `locked` (evento `LOCKED`, `ref = sale:<id annuncio>`): non vale per i mazzi, non si può offrire in uno scambio né mettere in bacheca due volte. L'annuncio dura 30 giorni. |
| **Prenotazione** | Un compratore preme "Buy". Il server tiene l'annuncio per lui 15 minuti e gli dà le istruzioni: pagare dall'**account del compratore** all'**account del venditore** esattamente il prezzo, con un memo casuale `m8sale-…` (130 bit, non dice nulla dell'acquisto). Intanto nessun altro può comprare e il venditore non può ritirare l'annuncio. |
| **Pagamento** | Keychain mostra il trasferimento esatto; il client non calcola né importi né destinatari. |
| **Rilevamento** | Il server legge lo storico del venditore **dal punto in cui era al momento della prenotazione**. Il trasferimento col memo giusto, dal compratore, dell'importo esatto, nella valuta giusta e con il blocco entro la scadenza porta l'acquisto a `DETECTED`. |
| **Consegna** | Quando almeno 2 nodi, interrogati direttamente, vedono il trasferimento sotto il blocco irreversibile e identico (T8, T21), in una sola transazione: la copia passa al compratore (`TRANSFERRED`, torna `active`), l'annuncio diventa `SOLD`, il record `m8tcg_sale` va nell'outbox. |
| **Rinuncia, scadenza** | Il compratore può rinunciare a un acquisto non pagato ("Give up this card"); una prenotazione non pagata scade dopo 15 minuti più 2 di tolleranza. L'annuncio torna libero. Un annuncio ritirato o scaduto restituisce la copia (`UNLOCKED`). |

Stati:

```
annuncio   ACTIVE ──vendita──▶ SOLD        ACTIVE ──ritiro / scadenza (nessuno sta pagando)──▶ CANCELLED / EXPIRED
acquisto   PENDING ──trasferimento visto──▶ DETECTED ──irreversibile──▶ COMPLETED
           PENDING ──rinuncia / scadenza──▶ CANCELLED / EXPIRED
           DETECTED ──il trasferimento sparisce (micro-fork)──▶ PENDING
```

Ogni cambio di stato è un compare-and-set; la riga dell'annuncio, bloccata, serializza prenotazione, ritiro e consegna. Più processi server possono eseguire il job insieme.

## Pagamenti sbagliati

Un trasferimento col memo dell'acquisto che **non** corrisponde (importo, valuta, mittente, destinatario, in ritardo) non consegna nulla: l'acquisto resta `PENDING`, il motivo (`problem`) viene mostrato al compratore e registrato nell'audit (`sales.payment_mismatch`), con il trasferimento. Un altro trasferimento corretto, entro la scadenza, paga ancora.

**Limite accettato:** i soldi sono già del venditore. Il server non può restituirli (non ha le chiavi, ed è voluto) e non c'è una coda rimborsi come per il negozio. Il compratore deve chiederli al venditore; l'audit e la catena provano cosa è successo. Per ridurre il rischio:

- il client paga solo con le istruzioni del server, e Keychain blocca l'account mittente (`enforce`);
- il client **non rinuncia mai da solo** a un acquisto quando il wallet fallisce: un Keychain che ha risposto tardi potrebbe inviare comunque il trasferimento. Offre "Pay again" o "Give up";
- prima di chiudere una rinuncia il server rilegge lo storico: un pagamento già fatto non viene mai abbandonato;
- un pagamento visto aspetta la catena, non l'orologio: una prenotazione `DETECTED` non scade;
- chi paga due volte (fuori dal client) paga due volte: il secondo trasferimento non è osservato.

**Micro-fork:** se un trasferimento rilevato sparisce, l'acquisto torna `PENDING` e lo storico si rilegge dall'inizio della prenotazione, ignorando lo stesso trasferimento allo stesso blocco (un nodo in ritardo potrebbe ancora mostrarlo). Se la stessa transazione rientra in un altro blocco, paga.

## Sulla catena

Ogni vendita conclusa è pubblicata dal pool di broadcaster:

```json
{"b":"bob","c":["<id copia>","ember_imp",4,"f"],"p":"1.500 STEEM","s":"alice","t":"<id annuncio>","v":1,"x":"<id transazione del pagamento>"}
```

`s` ha venduto a `b` la copia `c` per `p`, pagata con la transazione `x` (un trasferimento da `b` a `s`, che chiunque può controllare). Con ricevute (03 §12) e scambi (13) si ricostruisce da chi è passata ogni copia. Il tracker segue questi record come gli altri: un `m8tcg_sale` del nostro broadcaster sconosciuto al database genera l'allarme `UNKNOWN_ON_CHAIN`.

## Limiti

| Cosa | Valore (`DEFAULT_SALES_POLICY`) |
|---|---|
| Annunci attivi per giocatore | 50 |
| Durata di un annuncio | 30 giorni |
| Prezzo | da 0,001 a 100 000 STEEM (3 decimali), solo gli asset accettati dal negozio (oggi STEEM) |
| Prenotazione | 15 minuti, più 2 di tolleranza |
| Acquisti in corso per compratore | 2 |
| Bacheca | 50 annunci per pagina, filtro per carta o venditore, ordinata per novità o prezzo |

Nessuna commissione: il venditore riceve tutto il prezzo. Una commissione richiederebbe un secondo trasferimento del compratore verso l'account shop (due firme in Keychain) oppure un custode dei fondi; se servirà, va decisa a parte.

## API

| Richiesta | Cosa |
|---|---|
| `GET /api/listings?card=&seller=&sort=newest\|cheapest&offset=` | **Pubblica.** `{ listings, total, offset, pageSize }` |
| `GET /api/listings/mine` | `{ listings, purchases }` del giocatore |
| `POST /api/listings` + `Idempotency-Key` | `{ "copy", "price": "1.5", "asset": "STEEM" }` |
| `POST /api/listings/:id/cancel` | Il venditore ritira l'annuncio (se nessuno sta pagando) |
| `POST /api/listings/:id/buy` | Prenota; risponde con l'acquisto e le istruzioni di pagamento. Ripetuta dallo stesso compratore, restituisce la stessa prenotazione |
| `GET /api/purchases/:id` | Solo per il compratore |
| `POST /api/purchases/:id/payment-hint` | `{ "txId" }`: fa guardare prima; l'id non vale come prova di niente |
| `POST /api/purchases/:id/release` | Rinuncia a un acquisto non pagato |

WebSocket: `sale.updated { listingId }` al venditore e al compratore a ogni cambiamento.

## Da fare

- Mostrare nell'annuncio lo storico della copia (conio, scambi, vendite) con un link alla catena.
- Un prezzo di riferimento (ultime vendite di quella carta) accanto al prezzo chiesto.
- Se le vendite crescono molto: leggere lo storico una volta per venditore, non per acquisto.
