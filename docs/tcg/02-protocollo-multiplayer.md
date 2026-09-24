# 02 — Protocollo multiplayer, API HTTP e WebSocket

**Stato:** proposta, 2026-09-24.

## 1. Regole generali

- Tutto su HTTPS/WSS dietro reverse proxy. JSON UTF-8. Nessun dato sensibile nelle URL.
- **Autenticazione:** cookie di sessione `m8_session` (256 bit casuali, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`). Il DB conserva solo `sha256(token)`: un dump del DB non contiene sessioni utilizzabili. Scadenza assoluta 7 giorni, di inattività 24 ore, revocabile.
- **CSRF:** `SameSite=Strict` più, per ogni richiesta che modifica stato, controllo dell'header `Origin` contro una allowlist e presenza di `X-M8-Request: 1` (un form di un altro sito non può impostarlo).
- **Validazione:** ogni corpo di richiesta ha uno schema esplicito (campi ammessi, tipi, lunghezze); campi sconosciuti → 400. Dimensione massima del corpo 16 KiB.
- **Idempotenza:** le richieste che creano risorse con valore (ordini, pagamenti) richiedono `Idempotency-Key` (UUID). La coppia `(utente, chiave)` è univoca: una ripetizione restituisce la risposta originale; la stessa chiave con un corpo diverso → 409.
- **Errori:** `{ "error": { "code": "ORDER_EXPIRED", "message": "…" } }`, codici stabili, messaggi senza dettagli interni (stack, SQL).
- **Rate limit** per IP e per utente, token bucket, con `429` e `Retry-After`.
- **Header di sicurezza:** `Content-Security-Policy` restrittiva (niente `unsafe-inline`/`unsafe-eval`), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`.

## 2. API HTTP

### Identity

| Metodo | Percorso | Corpo | Risposta | Note |
|---|---|---|---|---|
| POST | `/api/auth/challenges` | `{ "account": "alice" }` | `{ "challengeId", "message", "expiresAt" }` | Nome account validato con le regole STEEM. 10/min per IP. |
| POST | `/api/auth/sessions` | `{ "challengeId", "signature" }` | `{ "user": {…} }` + cookie | Challenge consumato anche in caso di errore. |
| DELETE | `/api/auth/sessions/current` | — | 204 | Revoca la sessione. |
| GET | `/api/me` | — | `{ "user": { "id", "account", "network" } }` | |

### Catalog, collection, decks

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/api/content/current` | `{ hash, engineVersion }` dei contenuti attivi. Pubblico. |
| GET | `/api/content/{hash}` | Il payload canonico, identico byte per byte a quello che l'hash certifica; `Cache-Control: immutable`. Pubblico, anche per i verificatori. |
| GET | `/api/starter` | `{ claimed, choices: [{ id, name, faction, size, cards }] }`: i tre starter fra cui scegliere |
| POST | `/api/starter` | `{ "starterId": "precon_harvest" }` → 201 `{ deck, cardsGranted }`. Una volta per account: in seguito 409 `STARTER_ALREADY_CLAIMED`, anche con richieste concorrenti. Le carte vengono coniate e salvate come mazzo giocabile in un'unica transazione. |
| GET | `/api/collection` | `{ cards: [{ definitionId, copies: [{ id, edition, serial, finish, status }] }] }` |
| GET | `/api/collection/cards/{instanceId}` | Dettaglio e storia di una copia propria; le copie altrui risultano 404 |
| GET/POST | `/api/decks` | Elenco `{ decks, limit }` / creazione `{ name, faction, cards: [{ cardId, count }] }` |
| GET/PUT/DELETE | `/api/decks/{id}` | Solo il proprietario (per gli altri 404). La versione viaggia come `ETag`; `PUT` richiede `If-Match` (manca → 428, versione vecchia → 412). `DELETE` è logica: le partite continuano a riferirsi al mazzo. |

**Regole dei mazzi.** Un mazzo si salva solo se usa carte possedute, nelle quantità possedute (altrimenti 422 `CARDS_NOT_OWNED`, con l'elenco delle mancanti). Può essere incompleto: in quel caso è una bozza con `playable: false` e l'elenco dei `problems` (dimensione, copie, fazione). `playable` si ricalcola a ogni lettura, perché il possesso può cambiare. Il matchmaking (M4) accetterà solo mazzi giocabili.

### Marketplace

| Metodo | Percorso | Corpo | Note |
|---|---|---|---|
| GET | `/api/products` | — | Prodotti attivi con prezzi per asset e contenuti dichiarati (probabilità dei pacchetti incluse) |
| POST | `/api/orders` | `{ "productId", "quantity", "asset" }` + `Idempotency-Key` | Il prezzo **non** si invia: lo calcola il server dal listino. Risposta con istruzioni di pagamento `{ to, amount, asset, memo, expiresAt }` |
| GET | `/api/orders/{id}` | — | Solo il proprietario |
| POST | `/api/orders/{id}/payment-hint` | `{ "txId" }` | Suggerimento per accelerare la verifica; mai creduto senza lettura dalla catena |
| POST | `/api/orders/{id}/cancel` | — | Solo da `CREATED`/`PAYMENT_PENDING` |
| GET | `/api/orders` | — | Storico ordini dell'utente |

### Partite e verifica

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/api/games/{id}` | Metadati, esito, record e transazioni on-chain |
| GET | `/api/games/{id}/verification` | Esito del verificatore (§14 di 03) eseguito dal server; il client può rieseguirlo in locale |
| GET | `/api/games?mine=1` | Storico partite |

### Admin (ruolo separato, sessione con ri-autenticazione Keychain recente)

`/api/admin/refunds` (coda rimborsi, marcatura con txId del rimborso firmato a mano), `/api/admin/chain` (stato broadcaster, RC, anomalie del riconciliatore), `/api/admin/audit`.

## 3. WebSocket `/ws`

### 3.1 Connessione

- Upgrade accettato solo con cookie di sessione valido **e** `Origin` nella allowlist (i browser non applicano CORS al WebSocket: il controllo dell'`Origin` è obbligatorio, altrimenti un sito terzo può aprire una connessione con i cookie dell'utente).
- Una sola connessione attiva per utente: una nuova connessione sostituisce la precedente (che riceve `session.replaced` e viene chiusa).
- Heartbeat: il server invia ping ogni 20 s; senza pong per 45 s la connessione è chiusa.
- Messaggi massimo 4 KiB; token bucket 20 msg/s con burst 40; oltre soglia ripetuta → chiusura con codice 4008.

### 3.2 Envelope

```json
{ "t": "game.command", "id": "c-17", "d": { … } }
```

`t` tipo, `id` identificativo del messaggio del client (per correlare le risposte), `d` payload. Il server risponde con `{ "t": "…", "re": "<id>", "d": … }` quando è una risposta.

### 3.3 Client → server

| `t` | `d` | Effetto |
|---|---|---|
| `hello` | `{ "resume": { "gameId", "lastSeq" } \| null }` | Apertura; se c'è una partita attiva il server manda subito lo stato |
| `queue.join` | `{ "mode": "casual"\|"ranked", "deckId" }` | Il mazzo viene rivalidato (regole + possesso) e congelato |
| `queue.leave` | `{}` | |
| `game.entropy` | `{ "gameId", "entropy": "<hex32>" }` | Contributo al seed dopo aver ricevuto `seed_c` (03 §5) |
| `game.command` | `{ "gameId", "commandId": "<uuid>", "expectedVersion": 41, "command": { "type": "PLAY_CARD", "cardId": "c17", "targets": ["c3"] } }` | Il `playerId` non si invia: il server usa il posto dell'utente |
| `game.sync` | `{ "gameId", "sinceSeq" }` | Recupero eventi persi o snapshot completo |
| `game.concede` | `{ "gameId", "commandId" }` | Scorciatoia per `CONCEDE` |

### 3.4 Server → client

| `t` | `d` |
|---|---|
| `welcome` | `{ "user", "serverTime", "activeGame": { "gameId" } \| null }` |
| `queue.status` | `{ "state": "searching"\|"idle", "since", "estimatedWaitMs" }` |
| `match.found` | `{ "gameId", "seat", "opponent": { "account" }, "seedCommit": "<hex64>", "entropyDeadline" }` |
| `game.state` | `{ "gameId", "version", "lastSeq", "snapshot": <snapshot per prospettiva>, "clock": { "activeSeat", "turnEndsAt", "reserveMs": { "s0", "s1" } } }` |
| `game.events` | `{ "gameId", "fromSeq", "toSeq", "version", "events": [<eventi del motore redatti per prospettiva>], "head": "<hex64>" }` |
| `game.ack` | `{ "commandId", "ok": true, "version", "head" }` oppure `{ "commandId", "ok": false, "error": { "code" } }` |
| `game.over` | `{ "gameId", "winner", "reason", "verificationUrl" }` |
| `order.updated` | `{ "orderId", "status", "cards"?: [...] }` |
| `error` | `{ "code", "message" }` |

Codici d'errore del comando: quelli del motore (`NOT_YOUR_TURN`, `NOT_ALLOWED_IN_PHASE`, `INVALID_COMMAND`, …) più `STALE_VERSION`, `NOT_IN_GAME`, `GAME_NOT_ACTIVE`, `RATE_LIMITED`.

### 3.5 Ordine, concorrenza e idempotenza

- **Un attore per partita**: i comandi di una partita sono eseguiti uno alla volta nell'ordine di arrivo alla mailbox. Due comandi simultanei dello stesso giocatore non possono entrambi passare: il secondo trova `expectedVersion` superata → `STALE_VERSION`.
- **`commandId`** univoco per partita (vincolo DB): un reinvio dopo una disconnessione restituisce lo stesso ack.
- **Eventi numerati** (`seq`): il client applica solo `fromSeq = lastSeq + 1`; se vede un buco chiede `game.sync`.

### 3.6 Riconnessione e disconnessione

- Il client si riconnette con `hello { resume }`: riceve `game.state` completo e riprende da lì (lo stato del client è sempre sostituibile, mai sorgente di verità).
- Alla disconnessione il turno continua a scorrere; dopo 60 s di assenza (configurabile) il server esegue `FORCED_MOVE` `END_TURN` ai suoi turni; dopo 3 turni consecutivi forzati o 3 minuti di assenza totale, `FORCED_MOVE` `CONCEDE` (`why: "abandon"`).

### 3.7 Timer

- Timer di turno (es. 75 s) più riserva per giocatore (es. 60 s per partita), timer di risposta per i blocchi (20 s). Configurazione per modalità.
- Allo scadere, il server esegue la mossa forzata minima (`END_PHASE`, blocchi vuoti) registrata come `FORCED_MOVE` con `why: "timeout"`.
- I timer vivono nel `GameActor` (orologio iniettato → testabili con orologio finto).

### 3.8 Spettatori (predisposto)

Il motore produce già snapshot per prospettiva e uno omnisciente. Serve una prospettiva **pubblica** (nessuna mano visibile) con un ritardo configurabile per evitare lo streaming delle informazioni al giocatore. Il canale sarà `spectate.join { gameId }`, sola lettura.
