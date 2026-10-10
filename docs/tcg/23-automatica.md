# 23 — Classificata automatica

**Stato:** fatto (2026-10-10): l'AI nel motore con gli stili e il bilanciamento, il server (modulo `auto`, migrazione `019_auto.sql`) e il client (lobby, notifiche, replay, storico). Prima del lancio resta da riequilibrare i mazzi oltre il 60% (sotto, *Bilanciamento*).

## L'idea

Con pochi giocatori la classificata non parte: chi apre la lobby non trova nessuno ed esce. Nella **classificata automatica** i due giocatori non devono essere online insieme.

1. Il giocatore sceglie **uno dei suoi mazzi**.
2. Sceglie uno **stile**: *Aggressive*, *Balanced* o *Defensive*.
3. Preme **Join the auto list · 1.000 STEEM**.

Quando un altro giocatore fa lo stesso, anche ore dopo, il server fa giocare **due AI identiche**, una per mazzo, ognuna con lo stile del suo giocatore. Entrambi ricevono il risultato in una notifica e possono guardare la partita sul tavolo, come un replay.

Vale per la **stessa stagione, la stessa classifica e lo stesso jackpot** della classificata normale, ma sposta il rating **un quinto** di una partita giocata a mano.

## Le regole

| Regola | Perché |
|---|---|
| Stessi requisiti della classificata: stagione in corso, `minFinishedCasualGames` partite casual finite oppure `minFinishedPracticeGames` partite contro l'AI (09). | Frena gli account creati solo per farmare. |
| Costa **un ingresso ranked** a giocatore, gli stessi biglietti dello shop (22). Si toglie **quando ci si mette in lista**. | Il prezzo si paga una volta, al momento della scelta. |
| **Una volta dentro, sei dentro:** dalla lista non si esce. Il biglietto aspetta finché arriva un avversario. | Nessuno entra e esce per scegliersi l'avversario. |
| **Un biglietto automatico per giocatore.** È indipendente dalla coda live e dalle sfide: si può stare in lista automatica e intanto giocare a mano. | Semplice da capire, e non toglie niente al PvP. |
| Mazzo e stile sono **congelati** nel biglietto, come nella coda (02, 17). Finché il biglietto aspetta non si cambiano. Un nuovo biglietto si mette solo dopo che il precedente è stato giocato. | Vendere o modificare carte dopo non cambia la partita. |
| Abbinamento come la classificata: il biglietto più vecchio contro il più vecchio che può affrontare, qualunque sia il rating. Mai contro sé stessi. | Nessuna regola nuova da spiegare. |
| Limite per coppia **separato**: al massimo `maxRatedGamesPerPairPerDay` (3) partite automatiche fra gli stessi due giocatori in 24 ore. Non consuma il limite della classificata live. | Con pochi giocatori, l'automatica non deve bloccare il PvP. |
| Il biglietto aspetta fino alla fine della stagione. A quel punto i biglietti ancora in attesa si chiudono e **l'ingresso torna indietro**. | Nessuno paga per una partita mai giocata. |
| Una manutenzione **sospende** gli abbinamenti ma non chiude i biglietti. | Il giocatore non è collegato e non va disturbato. |
| Non ci si arrende e non esiste il tempo scaduto: la partita la giocano le AI fino alla fine. | Niente rese concordate fra account alleati. |

## Il rating

- Si calcola l'aggiornamento Glicko-2 normale (09), poi si applica **il 20%** della variazione di rating, deviazione e volatilità: `dopo = prima + 0,2 × (glicko − prima)`. Il fattore sta in `data/ranked/ranked.json` (`"auto": { "ratingWeightPercent": 20 }`, da 1 a 100; senza, 20).
- Una partita automatica **conta per diventare assestati** (le 3 partite di 09) e conta in vinte e perse. Senza questo, chi gioca solo in automatico non potrebbe mai vincere il jackpot.
- `rating_changes` registra la modalità (`mode`: `ranked` o `auto`) e il peso applicato (`weight`), così il ricalcolo dalla catena resta possibile: il risultato pubblicato porta `m = "auto"`.
- Il limite per coppia si conta per modalità: 3 partite automatiche al giorno fra gli stessi due giocatori, e a parte 3 classificate giocate a mano. Una partita automatica oltre il limite (non dovrebbe succedere: l'abbinamento non la crea) viene registrata senza cambiare il rating e segnalata (`repeat_pair`, con `mode: "auto"`). Le rese rapide non riguardano l'automatica: nessuno si arrende.
- Il rating si aggiorna nella stessa unità di lavoro che registra la partita, così la notifica dice già quanto è cambiato.

## Gli stili

**Fatto** (2026-10-10). La stessa AI (`BasicAi`, `packages/engine/src/domain/ai/BasicAi.js`) con tre gruppi di regole (`STYLE_RULES`). Tutto il resto (quale carta giocare, chi bersagliare con rimozioni, cure e potenziamenti) è uguale per i tre stili.

| Stile | Attacco | Blocco | Danni |
|---|---|---|---|
| **Aggressive** | attacca con chi non viene ucciso gratis; **con tutto** quando l'avversario ha 5 punti vita o meno | uccide e sopravvive, oppure fa da muro; **mai scambi alla pari**: tiene le creature per attaccare | **in faccia** appena l'avversario ha 8 punti vita o meno |
| **Balanced** | attacca con chi non viene ucciso gratis; con tutto solo se è letale | uccide e sopravvive, scambia alla pari, fa da muro; si sacrifica solo contro un colpo letale | in faccia se è letale, altrimenti sulla creatura più forte che uccide |
| **Defensive** | attacca **solo con chi nessun bloccante può uccidere** | come Balanced, e **si sacrifica** anche quando il colpo lo lascerebbe a metà vita o meno | come Balanced |

Balanced è l'AI che c'era prima: le partite contro il computer non cambiano.

**Bilanciamento.** `npm run simulate -- 25 --styles` fa giocare ogni coppia di mazzi precostruiti (mirror compresi) con ogni coppia di stili, 25 partite ciascuna: 22.500 partite. Obiettivi e risultati:

| Obiettivo | Risultato | |
|---|---|---|
| ogni stile vince fra il 45% e il 55% contro gli altri stili | Aggressive 47,9% · Balanced 51,4% · Defensive 50,7% | ✓ |
| nessuno scontro fra stili supera il 60% | il peggiore: Balanced contro Aggressive, 53,3% | ✓ |
| nessun mazzo supera il 60% di media contro gli altri | il migliore: Grave Harvest, 57,9% di media sui tre stili | ✓ |

| | Aggressive | Balanced | Defensive |
|---|---|---|---|
| **Aggressive** | — | 46,7% | 49,1% |
| **Balanced** | 53,3% | — | 49,4% |
| **Defensive** | 50,9% | 50,6% | — |

Ogni mazzo contro gli altri nove, per stile:

| Mazzo | Aggressive | Balanced | Defensive |
|---|---|---|---|
| Arcane Conclave | 51,3% | 53,0% | 57,7% |
| Spire Bastion | 40,4% | 42,3% | 47,9% |
| Ember Vanguard | **55,0%** | 51,3% | 44,1% |
| Iron Foundry | 40,8% | 44,8% | 49,6% |
| Grave Harvest | 50,8% | 58,5% | **64,3%** |
| Iron Legion | 47,5% | 50,0% | 53,2% |
| Shadow Pact | 49,4% | 53,8% | 52,0% |
| Verdant Grove | 43,9% | 45,0% | 43,2% |
| Ember Wildfire | 59,9% | **60,1%** | 49,6% |
| Wild Hunt | 48,1% | 49,7% | 42,9% |

- **Lo stile giusto dipende dal mazzo.** Ember Vanguard rende di più in Aggressive, Arcane Conclave e Grave Harvest in Defensive. La scelta dello stile conta: è la decisione che il giocatore prende oltre al mazzo.
- **Il problema sta nei mazzi, non negli stili.** Due combinazioni superano il 60%: Grave Harvest in Defensive (64,3%) ed Ember Wildfire in Balanced (60,1%). Erano già i due mazzi più forti con l'AI di prima (56,7% e 58,1%). Sono contenuti da riequilibrare, con `npm run simulate`, prima del lancio della classificata automatica.
- **Il primo giocatore vince il 68%**, come nelle partite normali (06, problemi aperti). Chi comincia si sorteggia, quindi in media è equo.
- La prima versione provata (Aggressive che attacca con tutto sotto i 10 punti vita e non blocca mai per fare muro) vinceva solo il 44%: per questo Aggressive ha le soglie a 5 e a 8 e continua a fare muro.

## Come gira la partita

- **Dove sta l'AI.** In `@magic8/engine` (`src/domain/ai/BasicAi.js`), così la usano client, server e simulatore. Nel client `BasicAiController` la avvolge come controller di un posto. `AI_VERSION` dice quale versione delle regole ha giocato una partita: ogni cambiamento a quello che l'AI decide è una versione nuova.
- **Una partita, una transazione.** Quando due biglietti si abbinano, il server, in una sola unità di lavoro (`AutoService` → `GameService.playAutoGame`):
  - crea la partita (`mode = "auto"`, protocollo di gioco v1: mosse come le ha registrate il server, senza firma);
  - fa giocare le due AI fino alla fine con il motore, in memoria (`gameplay/application/AutoGame.js`);
  - salva tutti gli eventi (`MOVE` per ogni mossa, un `STATE_CHECKPOINT` per turno, `GAME_FINISHED` che rivela segreto e mazzi);
  - segna i biglietti come giocati, aggiorna i rating, scrive la notifica a entrambi;
  - registra la fine e mette il risultato `m8tcg_result` nell'outbox.

  Se l'AI non ha una mossa che il motore accetta (un bug), il posto fa la mossa più piccola, come una mossa forzata (niente attacco, niente blocco, fine fase o turno), e il server lo scrive nel log: una partita finisce sempre. Dopo 20.000 mosse senza fine, o se la partita non si può creare, i due biglietti si chiudono (`FAILED`), gli ingressi tornano indietro e l'errore va nel log: una coppia rotta non blocca la lista.

  Gli ingressi sono già stati tolti in `auto.join`, nella stessa unità di lavoro che scrive il biglietto. Il registro (`entry_ledger`) usa due motivi nuovi, con riferimento il biglietto: `auto_ticket` quando si entra in lista, `auto_refund` se la stagione finisce prima dell'abbinamento.

  Una partita AI contro AI dura pochi millisecondi. Non c'è `GameActor`, né timer, né riconnessione. Gli ascoltatori di sempre (rating, notifiche, storico) ricevono la partita finita.
- **Il seme non lo sceglie nessuno.** La partita è deterministica: dati mazzi, stili, seme e versione dell'AI, il risultato è sempre lo stesso. Se il server conoscesse l'entropia dei giocatori prima di scegliere il suo segreto, potrebbe provare segreti finché non vince chi vuole. Per questo:
  1. aprendo la lista, il client chiede `auto.prepare`: il server crea il segreto del biglietto e manda solo il suo hash;
  2. il client risponde con `auto.join` (mazzo, stile, la sua entropia di 16 byte casuali).

  Il segreto della partita è `S = H("auto-secret", T_0 ‖ T_1)` (`autoGameSecret` di `@magic8/protocol`), dove `T_k` è il segreto del biglietto del posto k; l'impegno del biglietto è `seed_c` del suo segreto. Il seme del motore viene da `S`, dalle due entropie e dall'id della partita, come in ogni partita (03 §5). Ogni segreto è stato impegnato prima che arrivasse l'entropia del suo giocatore. Il giocatore non vede nessuno dei due passaggi. Il biglietto più vecchio siede in `s0`.
- **Verificabile.** `GET /api/auto/games/:gameId` (pubblico) dà gli eventi della partita, lo stile e la versione dell'AI di ogni posto, e per ogni biglietto il segreto, l'impegno che il giocatore ha ricevuto e la sua entropia. Chiunque può controllare gli impegni, ricalcolare `S`, ricostruire la partita con il motore e verificare che ogni mossa sia quella che `BasicAi` con quello stile avrebbe fatto (lo fa il test `test/auto/auto.test.js`).

## Cosa vede il giocatore

| Dove | Cosa |
|---|---|
| Lobby online | terza modalità accanto a *Casual* e *Ranked* (`OnlineScene`): **Auto**, con le stesse condizioni della classificata. La colonna si chiama *Auto ranked*. A sinistra i mazzi, come sempre; nella colonna di destra la spiegazione (*the AI plays it against the next player who joins, even hours from now…*) e quanti sono in lista, tre pulsanti per lo stile con una riga che dice cosa fa, e **Join the auto list · 1.000 STEEM**. Senza ingressi, *Get ranked entries* come nella classificata. Sul telefono il pulsante *Ranked* perde il prezzo, che resta sul pulsante principale. |
| Prima di entrare | una finestra: *The AI plays “Iron Foundry” defensive against the next player who joins, even hours from now. It costs 1.000 STEEM. Once you join you stay in the list until someone plays you.* con *Cancel* e *Join · Defensive*. |
| Lobby, in lista | *You joined 2 h ago with “Iron Foundry”, defensive. The AI plays it against the next player who joins: a notification will tell you the result. 3 players are in the auto list.* Il pulsante dice *In the auto list · waiting for an opponent* ed è spento; anche gli stili sono spenti, sullo stile del biglietto. Nessun modo di uscire. |
| Dopo | la lobby dice cosa è successo all'ultimo biglietto: partita giocata (*watch it from your notifications or your games*), stagione finita o partita impossibile (*your ranked entry is back*). |
| Notifica e toast | *Auto game vs @bob: you won* · *Your deck played Aggressive, @bob's Defensive. Rating 1500 → 1503. Watch the game.* Un clic, sul toast o nella lista delle notifiche, apre il replay. Un ingresso restituito: *Your ranked entry is back*. |
| Replay | `ReplayScene` legge la partita (`GET /api/auto/games/:id`), la rigioca per intero in memoria per controllare che arrivi alla fine registrata con le carte di questo client, poi la passa al tavolo di sempre: moneta, carte, suoni. Il giocatore la guarda **dal suo posto, come una sua partita PvP**: la sua mano scoperta e a grandezza piena, *Your turn*, *Victory* o *Defeat*, e il *?* dell'aiuto se lo accende; ma non può muovere nulla, perché i due posti sono dell'AI (niente *End turn* né *Concede*: solo *Leave*). Chi non ha giocato la partita la guarda da spettatore. Nel pannello laterale tre velocità (`ReplayPace`): *Normal* e *Fast* aspettano che il tavolo abbia mostrato tutta la mossa prima, poi una pausa (1 s o 0,3 s); *Very fast* va a ritmo fisso (0,26 s) e il tavolo, se resta indietro, salta le animazioni. Il replay successivo parte dall'ultima velocità scelta. *Leave* o *Watch another* tornano da dove si è venuti. Una partita giocata con carte diverse da quelle del client non si mostra: la schermata lo dice. |
| Storico | le partite automatiche hanno la modalità *auto* e *click to watch*: un clic apre il replay. |
| Classifica e jackpot | nessuna differenza: è lo stesso rating. |

## Messaggi

Client → server (WebSocket):

| `t` | `d` | Risposta |
|---|---|---|
| `auto.prepare` | `{}` | `auto.prepared` `{ "ticket", "commit" }` |
| `auto.join` | `{ "ticket", "deckId", "style", "entropy" }` | `auto.status` (sotto) |
| `auto.status` | `{}` | `auto.status` |

`auto.status` è `{ "state": "idle", "waiting" }` oppure `{ "state": "waiting", "waiting", "ticket", "since", "deckId", "style", "entries", "commit" }`; `waiting` è quanti biglietti aspettano nella lista. Il server lo manda anche da solo: dopo `auto.join`; quando il biglietto diventa una partita (`{ "state": "idle", "game" }`); quando si chiude senza partita (`{ "state": "idle", "reason": "season_ended" | "failed" }`).

Notifiche persistenti (15), che arrivano anche a chi non era collegato:
- `auto.finished` `{ "gameId", "opponent", "result": "win" | "loss" | "draw", "style", "opponentStyle", "rating": { "before", "after" } | null }`;
- `auto.refunded` `{ "ticket", "entries", "reason": "season_ended" | "failed" }`.

`entropy` sono 16 byte casuali in esadecimale minuscolo; `style` è uno fra `aggressive`, `balanced`, `defensive`. Errori: `ENTRY_REQUIRED`, `FORBIDDEN` (requisiti), `CONFLICT` (nessuna stagione, oppure già in lista), `NOT_FOUND` (biglietto non preparato da chi lo usa), `RATE_LIMITED` (più di 30 biglietti preparati in un'ora), `MAINTENANCE`, `VALIDATION`. Non esiste un messaggio per uscire dalla lista.

## Dati

Migrazione `019_auto.sql`:
- `auto_tickets`: un biglietto per riga, `PREPARED` → `WAITING` → `MATCHED` (oppure `REFUNDED` a fine stagione, `FAILED` se la partita non si può giocare). Il segreto del biglietto è cifrato a riposo come quello delle partite. Un solo biglietto `WAITING` per giocatore (indice unico). Mazzo, stile, entropia e stagione si fissano all'ingresso; partita, posto e versione dell'AI all'abbinamento. I biglietti preparati e mai usati si cancellano dopo un giorno.
- `rating_changes`: colonne `mode` e `weight` (`ranked` e 1 per le partite già registrate).
- `entry_ledger`: motivi `auto_ticket` e `auto_refund`, con riferimento il biglietto.
- `games.mode` accetta `auto`; nel protocollo `GameMode.AUTO` (anche nel risultato on-chain).

Lavori periodici (`main.js`): abbinamento ogni 30 s (un limite per coppia scaduto), chiusura dei biglietti delle stagioni finite ogni minuto, pulizia dei biglietti preparati ogni ora.

## Lavoro, in ordine

1. **AI e bilanciamento.** Fatto (2026-10-10): AI in `@magic8/engine`, tre stili, simulatore con gli stili, numeri qui sopra.
2. **Server.** Fatto (2026-10-10): modulo `auto` (biglietti, seme impegnato, partita giocata in una transazione, rating al 20%, ingressi, notifiche, replay), test in `test/auto/auto.test.js`.
3. **Client.** Fatto (2026-10-10): `AutoListService` (biglietto, entropia del browser dopo l'impegno del server), `AutoReplayService` (il replay come `MatchSession` con le mosse registrate; il motore si ricostruisce con l'adattatore `infrastructure/random/recordedGameEngine.js`, l'unico che usa il protocollo), `ReplayScene`, lobby, notifiche, storico.
4. **Prova.** Fatto (2026-10-10): `test/e2e/autoList.test.js`, con server e client veri: Alice compra un ingresso e entra in lista; tre ore dopo Bob fa lo stesso; la partita si gioca, entrambe le schede lo sentono, la notifica la nomina e il replay del client arriva allo stesso vincitore del server.

## Fuori dalla prima versione

Più biglietti contemporanei, guardare la partita mentre si gioca, scegliere l'avversario, stili personalizzati, replay delle partite live.
