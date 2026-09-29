# 10 — Spettatori

**Stato:** M7.2, 2026-09-24. Modulo `gameplay` del server (`GameActor`, `GameService`), prospettiva `SPECTATOR` nel motore, schermata "Watch a game" nel client.

## Cosa vede uno spettatore

- **Il tavolo, mai una mano.** Il motore ha una terza prospettiva, `SPECTATOR`, oltre a quella di un giocatore e a quella omnisciente:
  - tutte e due le mani sono nascoste (si vede solo quante carte ha ciascuno);
  - gli eventi perdono ogni campo privato (per esempio quale carta è stata pescata);
  - non ci sono mosse legali.
- **Non serve un ritardo.** Il documento 02 §3.8 prevedeva uno streaming ritardato per non passare informazioni a un giocatore. Non serve: lo spettatore vede **meno** di ciascuno dei due giocatori, cioè solo ciò che entrambi vedono già. Uno spettatore d'accordo con un giocatore non ha niente da dirgli. Il ritardo servirebbe solo se gli spettatori vedessero le mani (come in una trasmissione con commento); in quel caso andrà aggiunto insieme a quella modalità.
- **Le partite sono pubbliche.** Gli account dei due giocatori e l'esito finiscono comunque sulla catena (`m8tcg_result`, 03 §9); le mosse restano nel DB del server. Per questo non c'è un'opzione "non guardarmi"; se servirà (partite private fra amici) sarà un campo della partita.

## Regole

- Serve una sessione (il canale è il WebSocket autenticato). La lista delle partite in corso è invece pubblica.
- Chi gioca una partita non può guardarla (`PLAYER_CANNOT_WATCH`): vede già la sua prospettiva.
- **Una partita alla volta per utente.** Chiedere un'altra partita smette di guardare la prima.
- **Al massimo 50 spettatori per partita** (`MAX_SPECTATORS`, `SPECTATORS_FULL` oltre). Ogni mossa viene mandata a ciascuno: il limite tiene costante il costo di una partita molto seguita.
- **Fine della visione:**
  - lo spettatore chiede `watch.stop`;
  - lo spettatore si disconnette;
  - la partita finisce (`watch.over`, poi più nulla).
- **Dopo una riconnessione** il server non ricorda più lo spettatore: il client richiede `watch.start` da solo e riprende con lo stato completo.
- Se l'attore di una partita viene ricostruito (scrittura fallita, 01 §7.3), il nuovo attore continua a trasmettere agli stessi spettatori.

## Protocollo

| Direzione | Messaggio | Contenuto |
|---|---|---|
| HTTP | `GET /api/games/live` | `{ "games": [{ "gameId", "mode", "players": [{ "seat", "account" }], "turn", "spectators", "startedAt" }] }`, prima le più seguite, al massimo 50; pubblica, limite per indirizzo, cache 5 s |
| client → server | `watch.start { gameId }` | risposta `watch.state` con la **vista dello spettatore**; errori `NOT_FOUND` (partita inesistente o finita) e `CONFLICT` con `details.code` = `PLAYER_CANNOT_WATCH`, `SPECTATORS_FULL`, `GAME_NOT_ACTIVE` |
| client → server | `watch.stop {}` | risposta `watch.stopped` |
| server → client | `watch.events` | la vista dello spettatore più `events` redatti, dopo ogni mossa |
| server → client | `watch.over` | `{ "gameId", "winner", "reason" }` |

Vista dello spettatore: `{ "gameId", "mode", "status", "players": [{ "seat", "account" }], "version", "lastSeq", "head", "snapshot": <snapshot SPECTATOR>, "clock", "spectators" }`. Come per i giocatori, il client sostituisce il suo stato con lo snapshot ricevuto.

## Client

- Nella lobby online, "Watch" apre la lista delle partite in corso ("@alice vs @bob", modalità, turno, spettatori).
- La partita si apre nella stessa schermata di gioco, in sola lettura:
  - il primo posto sta in basso;
  - le mani di tutti e due sono dorsi di carta;
  - il banner dice di chi è il turno per nome;
  - l'unico pulsante è "Leave";
  - a fine partita: "@bob wins", poi "Watch another".
- La sessione è una `RemoteMatchSession` senza posto: `submit` rifiuta tutto (`SPECTATOR`) senza contattare il server.

## Minacce

- **T31, spettatori usati per sovraccaricare:** limite per partita, una partita per utente, limite di messaggi della connessione, lista pubblica con limite per indirizzo e cache.
- **Informazioni nascoste (T11):** la prospettiva `SPECTATOR` è calcolata dal motore; il server non costruisce viste a mano. I test controllano che nessuna carta pescata arrivi a uno spettatore.
