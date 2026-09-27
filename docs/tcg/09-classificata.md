# 09 — Classificata

**Stato:** M7.1, 2026-09-24. Modulo `ranking` del server, impostazioni in `data/ranked/ranked.json`.

## Rating

- **Glicko-2** (Glickman 2012). Ogni giocatore ha tre valori:
  - un rating (si parte da 1500);
  - una deviazione, cioè quanto è incerto il rating (si parte da 350);
  - una volatilità (si parte da 0,06).
- **Ogni partita è un periodo di rating.** I due giocatori vengono aggiornati insieme, a partire dai valori che avevano prima della partita. L'implementazione è verificata con l'esempio del paper (1464,06 / 151,52 / 0,05999).
- **Un giocatore nuovo si muove in fretta; uno con molte partite si muove poco.** Battere chi ha un rating molto più alto vale di più.
- **Rating provvisorio:** con deviazione sopra 110 il rating è provvisorio e non compare in classifica. Diventa "assestato" dopo alcune partite.
- **Stagioni:** i rating ripartono da capo a ogni stagione (`seasons` nel file dei dati). Una partita conta nella stagione in cui è finita.
- **Ricalcolabile:** i risultati delle partite sono pubblicati sulla catena (`GAME_CREATED.mode = "ranked"`, `GAME_FINISHED.win`), quindi chiunque può ricalcolare i rating. Il ricalcolo coincide a meno di arrotondamenti, perché le funzioni matematiche possono differire di un bit fra motori JavaScript diversi.

## Coda classificata

- **Requisiti per entrare:** serve una stagione in corso e un numero minimo di partite casual finite (`eligibility.minFinishedCasualGames`, default 3). Frena gli account nuovi creati solo per gonfiare il rating.
- **Abbinamento:**
  - il biglietto in coda porta il rating del giocatore;
  - il biglietto più vecchio viene abbinato al rating più vicino dentro una finestra di `baseWindow + windowPerSecond × secondi di attesa`, fino a `maxWindow` (default 100 + 10/s, massimo 800);
  - finché esiste un'alternativa, due giocatori non vengono abbinati se hanno già giocato fra loro il numero massimo di partite contate del giorno;
  - **la finestra è una preferenza, non un muro:** dopo `relaxAfterSeconds` di attesa (default 20) il biglietto prende l'avversario col rating più vicino fra quelli in coda, per quanto lontano sia, e come ultima risorsa anche uno già affrontato oltre il limite giornaliero — quella partita viene registrata ma non conta (vedi fair play). Con pochi giocatori online si gioca comunque, invece di cercare all'infinito;
  - rientrare in coda (altro mazzo, altro tentativo) non azzera l'attesa: la finestra continua ad allargarsi dal primo ingresso.

## Fair play (T24)

- **Limite giornaliero per coppia.** Oltre `maxRatedGamesPerPairPerDay` partite contate fra gli stessi due giocatori in 24 ore, le partite successive restano registrate (`counted = false`, `reason = "repeat_pair"`) ma non cambiano il rating. Vale anche per le partite create fuori dalla coda. La coppia riceve una segnalazione `repeat_pair`.
- **Rese rapide ripetute.** `earlyConcedesToFlag` rese entro il turno `earlyConcedeTurn`, fra gli stessi giocatori, nell'arco di `earlyConcedeWindowDays` giorni, producono una segnalazione `early_concedes`.
- **Le segnalazioni informano, non puniscono.** Nella v1 i rating non hanno valore economico. Gli operatori le vedono in `/api/admin/ranking-flags`.

## Registrazione

- Ogni risultato si registra una sola volta per partita e giocatore (`rating_changes`, append-only).
- Arriva subito dal modulo gameplay, appena la partita finita è salvata.
- Un job ogni 10 minuti recupera le partite degli ultimi due giorni sfuggite (per esempio per un riavvio).
- I due rating vengono bloccati sempre nello stesso ordine: due partite con un giocatore in comune non si bloccano a vicenda.

## API

| Richiesta | Cosa |
|---|---|
| `GET /api/ranking/leaderboard[?season=id]` | i 100 migliori rating assestati della stagione (pubblica, in cache 30 s) |
| `GET /api/ranking/me` | rating, deviazione, provvisorio, posizione, partite vinte e perse, se si può giocare in classificata |
| `queue.join` con `mode: "ranked"` | coda classificata (WebSocket) |

Client: nella lobby online si sceglie fra casual e classificata. Si vedono il proprio rating e, dalla lobby, la classifica.
