# 09 — Classificata

**Stato:** M7.1, 2026-09-24. Modulo `ranking` del server, impostazioni in `data/ranked/ranked.json`.

## Rating

- **Glicko-2** (Glickman 2012). Ogni giocatore ha tre valori:
  - un rating (si parte da 1500);
  - una deviazione, cioè quanto è incerto il rating (si parte da 350);
  - una volatilità (si parte da 0,06).
- **Ogni partita è un periodo di rating.** I due giocatori vengono aggiornati insieme, a partire dai valori che avevano prima della partita. L'implementazione è verificata con l'esempio del paper (1464,06 / 151,52 / 0,05999).
- **Un giocatore nuovo si muove in fretta; uno con molte partite si muove poco.** Battere chi ha un rating molto più alto vale di più.
- **Rating provvisorio:** finché un giocatore non ha 3 partite classificate valutate nella stagione, il suo rating è provvisorio: compare in classifica dopo i rating assestati, senza posizione, e non vince premi. Alla terza partita diventa "assestato" e riceve una posizione.
- **Stagioni:** i rating ripartono da capo a ogni stagione. Il calendario sta nel database (tabella `seasons`, migrazione 018). Al primo avvio su una tabella vuota il server ci copia le `seasons` del file dei dati; da lì in poi il file non viene più letto per le stagioni e le si gestisce dal pannello `/admin.html` (sezione *Seasons*, doc 07). Una stagione futura si crea, si modifica e si cancella liberamente; di una in corso si cambiano solo il nome e la fine (sempre nel futuro); una finita non cambia più, così nessun rating e nessun jackpot viene riscritto. Ogni modifica è nell'audit (`admin.season_created`, `admin.season_changed`, `admin.season_deleted`) e arriva subito a tutti i processi (NOTIFY `m8_seasons`). Una partita conta nella stagione in cui è finita. Una stagione finisce al suo `endsAt`, o altrimenti quando comincia la successiva; fra una stagione finita e la prossima la classificata è chiusa. Una stagione può avere un jackpot (doc 21).
- **Ricalcolabile:** ogni partita finita pubblica il suo risultato sulla catena (`m8tcg_result`: account, `m = "ranked"`, vincitore; 03 §9), quindi chiunque può ricalcolare i rating. Il ricalcolo coincide a meno di arrotondamenti, perché le funzioni matematiche possono differire di un bit fra motori JavaScript diversi.

## Coda classificata

- **Requisiti per entrare:** serve una stagione in corso e un numero minimo di partite casual finite (`eligibility.minFinishedCasualGames`, default 3). Frena gli account nuovi creati solo per gonfiare il rating.
- **Ingresso:** una stagione può far pagare ogni partita (`entryFee`, oggi in tutte le stagioni: un ingresso ranked a giocatore, comprato nello shop a 1 STEEM). Senza ingressi la coda rifiuta; la partita li toglie quando viene creata e li restituisce se viene annullata prima di cominciare (doc 22).
- **Abbinamento:** tutti contro tutti, con una sola regola: due giocatori che hanno raggiunto il limite giornaliero per coppia (vedi fair play) non vengono abbinati fra loro. Il biglietto più vecchio affronta subito il più vecchio fra quelli che può affrontare, qualunque sia il rating; il server guarda i 20 biglietti più vecchi. Se fra chi aspetta nessuno può affrontare nessuno, ognuno resta in coda e riceve una volta per ricerca `queue.status` con `reason: "pair_limit"`, l'avversario (`opponent`), quando potranno rigiocare (`nextAt`) e il testo da mostrare (`message`), che dice con chi, fra quanto e perché.

- **Sfide dirette:** una partita classificata si può anche proporre a un giocatore online dalla lobby, se entrambi soddisfano i requisiti (17). Conta come una partita della coda, limite giornaliero per coppia compreso: oltre il limite la sfida classificata viene rifiutata (`LIMIT_REACHED`, con `opponent` e `nextAt` nei dettagli e nel messaggio quanto manca e perché).

## Fair play (T24)

- **Limite giornaliero per coppia.** Due giocatori che hanno giocato `maxRatedGamesPerPairPerDay` partite contate fra loro nelle ultime 24 ore (finestra mobile, non giorno di calendario) non possono giocarne un'altra in classificata: la coda non li abbina e le sfide classificate fra loro vengono rifiutate. Possono di nuovo quando la `maxRatedGamesPerPairPerDay`-esima partita più recente fra loro compie 24 ore; a entrambi viene detto quanto manca e perché. Le partite casual non hanno limiti.
- **Rete di sicurezza.** Una partita che passa comunque (creata fuori da coda e sfide, o finita mentre l'altra veniva creata) viene registrata ma non cambia il rating (`counted = false`, `reason = "repeat_pair"`), e la coppia riceve una segnalazione `repeat_pair`.
- **Rese rapide ripetute.** `earlyConcedesToFlag` rese entro il turno `earlyConcedeTurn`, fra gli stessi giocatori, nell'arco di `earlyConcedeWindowDays` giorni, producono una segnalazione `early_concedes`.
- **Le segnalazioni informano, non puniscono.** Gli operatori le vedono in `/api/admin/ranking-flags`. Da Season 1 i primi tre vincono una parte del jackpot (doc 21): le segnalazioni si controllano prima di pagare i premi.

## Registrazione

- Ogni risultato si registra una sola volta per partita e giocatore (`rating_changes`, append-only).
- Arriva subito dal modulo gameplay, appena la partita finita è salvata.
- Un job ogni 10 minuti recupera le partite degli ultimi due giorni sfuggite (per esempio per un riavvio).
- I due rating vengono bloccati sempre nello stesso ordine: due partite con un giocatore in comune non si bloccano a vicenda.

## API

| Richiesta | Cosa |
|---|---|
| `GET /api/ranking/leaderboard[?season=id]` | i primi 100 rating della stagione: prima gli assestati con posizione (`rank`), poi i provvisori con `rank: null` e `provisional: true` (pubblica, in cache 30 s) |
| `GET /api/ranking/me` | rating, deviazione, provvisorio, posizione, partite vinte e perse, se si può giocare in classificata |
| `GET /api/admin/seasons` | (operatori) il calendario: ogni stagione con fase e fine effettiva, e i prize pool che si possono assegnare |
| `POST /api/admin/seasons` · `PUT /api/admin/seasons/:id` · `DELETE /api/admin/seasons/:id` | (operatori) crea, modifica, cancella una stagione; orari UTC al secondo (`2026-10-08T00:00:00Z`), `endsAt` null = finisce quando comincia la successiva |
| `queue.join` con `mode: "ranked"` | coda classificata (WebSocket) |

Client: nella lobby online si sceglie fra casual e classificata. Si vedono il proprio rating e, dalla lobby, la classifica.
