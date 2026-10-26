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
- **Classificata automatica** (23): le partite che il server fa giocare all'AI con il mazzo e lo stile di ogni giocatore contano nello stesso rating, ma spostano solo il 20% della variazione Glicko-2 (`auto.ratingWeightPercent`). Contano per diventare assestati; il limite giornaliero per coppia si conta a parte.
- **Deterioramento** (dal 2026-10-27): chi sta in cima deve giocare. Vedi sotto.
- **Ricalcolabile:** ogni partita finita pubblica il suo risultato sulla catena (`m8tcg_result`: account, `m = "ranked"` o `"auto"`, vincitore; 03 §9), quindi chiunque può ricalcolare i rating. Il ricalcolo coincide a meno di arrotondamenti, perché le funzioni matematiche possono differire di un bit fra motori JavaScript diversi.

## Deterioramento del rating

**Perché:** chi arrivava primo poteva smettere di giocare e restare primo fino alla fine della stagione, con il 65% del jackpot (doc 21). Nessuno poteva batterlo, perché non entrava più in coda.

**La regola:**

- Ogni giorno UTC, i primi tre rating **assestati** della stagione che quel giorno **non hanno giocato una classificata a mano valida** perdono: **1° −50, 2° −15, 3° −5** (`decay.places`).
- **Valida:** una partita `ranked` (coda o sfida diretta, anche contro un bot, doc 25), che ha contato per il rating (non oltre il limite per coppia) e che **non è finita con una resa entro il turno `earlyConcedeTurn`** (2), di chiunque dei due. Chi abbandona una partita la perde per resa, quindi anche l'abbandono rapido non salva. Vinta o persa non importa.
- **Le partite automatiche non salvano** (doc 23).
- Le posizioni sono quelle della classifica **a mezzanotte, prima del deterioramento del giorno**. Se primo e secondo sono vicini e nessuno dei due gioca, possono scambiarsi il posto ogni giorno: è voluto, chi gioca li supera.
- **Si ferma da solo:** fuori dai primi tre non si perde niente, quindi non serve un minimo. I provvisori non hanno posizione e non perdono niente.
- Conta solo un giorno che la stagione copre per intero, da `decay.from` (la prima mezzanotte UTC in cui vale) alla fine della stagione.

**Come funziona:**

- Un job ogni 5 minuti (`rating decay`) prende ogni giorno finito da almeno 5 minuti e non ancora trattato. Prima recupera le partite sfuggite (come il job di recupero), così una partita finita alle 23:59 conta.
- Ogni giorno si tratta **una sola volta**, anche con più processi: chi inserisce la riga in `rating_decay_days` (migrazione 024) lo fa, gli altri saltano. I rating si bloccano nello stesso ordine di quando si registra una partita, così non c'è deadlock.
- Ogni perdita è in `rating_decays` (append-only: giorno, posto, punti, rating prima e dopo) e arriva al giocatore come notifica `ranking.decay` (doc 15).
- **Prima di chiudere il jackpot** di una stagione finita, il modulo jackpot fa girare il deterioramento: i premi si calcolano sempre dopo l'ultimo giorno.
- `GET /api/ranking/me` restituisce `decay`: `{ points, safe, at }` se il giocatore oggi è fra i primi tre (`safe` se ha già giocato una partita valida, `at` la mezzanotte del controllo), altrimenti `null`. La lobby avvisa: *Play a ranked game by 00:00 UTC or lose 50 rating.* Anche la scheda Season della Home e le info *Ranked games* lo dicono.
- **Ricalcolo dalla catena:** le posizioni dipendono solo dai rating, e le partite di ogni giorno sono sulla catena. Il turno in cui una partita è finita invece non è nel record `m8tcg_result` (03 §9): per sapere se una resa era "entro il turno 2" serve la storia della partita, che il server mostra.

**Configurazione** (`data/ranked/ranked.json`; senza `decay`, nessun deterioramento):

```json
"decay": { "from": "2026-10-27T00:00:00Z", "places": [50, 15, 5] }
```

`from` deve essere una mezzanotte UTC; `places` da 1 a 10 valori, punti da 0 a 1000 (0: quel posto non perde niente).

## Coda classificata

- **Requisiti per entrare:** serve una stagione in corso e, in alternativa, un numero minimo di partite casual finite (`eligibility.minFinishedCasualGames`, default 3) oppure di partite di pratica contro l'AI finite da loggati (`eligibility.minFinishedPracticeGames`, default 3). Frena gli account nuovi creati solo per gonfiare il rating.
- **Partite contro l'AI che contano:** la pratica si gioca nel browser, senza il server. Da loggati, a fine partita il client invia seed, mazzi (in ordine di turno) e tutte le mosse (`POST /api/practice/games`); il server la rigioca con il proprio engine e la conta solo se ogni mossa è legale e l'ultima chiude la partita. Una partita persa per resa non conta; lo stesso seed conta una volta sola, per un solo giocatore (tabella `practice_games`). Non prova che l'avversario fosse davvero l'AI, ma richiede comunque una partita intera e valida. Queste partite non vanno on-chain né nello storico.
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
| `GET /api/ranking/me` | rating, deviazione, provvisorio, posizione, partite vinte e perse, se si può giocare in classificata, cosa costa oggi il deterioramento (`decay`) |
| `GET /api/admin/seasons` | (operatori) il calendario: ogni stagione con fase e fine effettiva, e i prize pool che si possono assegnare |
| `POST /api/admin/seasons` · `PUT /api/admin/seasons/:id` · `DELETE /api/admin/seasons/:id` | (operatori) crea, modifica, cancella una stagione; orari UTC al secondo (`2026-10-08T00:00:00Z`), `endsAt` null = finisce quando comincia la successiva |
| `queue.join` con `mode: "ranked"` | coda classificata (WebSocket) |

Client: nella lobby online si sceglie fra casual e classificata. Si vedono il proprio rating e, dalla lobby, la classifica.
