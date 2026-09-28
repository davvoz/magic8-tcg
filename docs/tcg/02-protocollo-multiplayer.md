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
| GET | `/api/collection` | `{ cards: [{ definitionId, copies: [{ id, edition, serial, status }] }] }` |
| GET | `/api/collection/cards/{instanceId}` | Dettaglio e storia di una copia propria; le copie altrui risultano 404 |
| GET/POST | `/api/decks` | Elenco `{ decks, limit }` / creazione `{ name, faction, cards: [{ cardId, count }] }` |
| GET/PUT/DELETE | `/api/decks/{id}` | Solo il proprietario (per gli altri 404). La versione viaggia come `ETag`; `PUT` richiede `If-Match` (manca → 428, versione vecchia → 412). `DELETE` è logica: le partite continuano a riferirsi al mazzo. |

**Regole dei mazzi.** Un mazzo si salva solo se usa carte possedute, nelle quantità possedute (altrimenti 422 `CARDS_NOT_OWNED`, con l'elenco delle mancanti). Può essere incompleto: in quel caso è una bozza con `playable: false` e l'elenco dei `problems` (dimensione, copie, fazione). `playable` si ricalcola a ogni lettura, perché il possesso può cambiare. Il matchmaking (M4) accetterà solo mazzi giocabili.

### Marketplace

| Metodo | Percorso | Corpo | Note |
|---|---|---|---|
| GET | `/api/products` | — | Pubblico. `{ products, dropTables, rarities }`: prodotti in vendita con prezzi (stringhe decimali esatte) e contenuti; drop table risolte con hash, probabilità per slot e pool di carte |
| GET | `/api/pack-epochs` | — | Pubblico. Epoche dei pacchetti: impegno (`commit`), apertura, chiusura e, solo quando tutti gli ordini dell'epoca sono chiusi, il segreto rivelato |
| POST | `/api/orders` | `{ "items": [{ "productId", "quantity" }], "asset" }` (carrello, 1–20 righe, ogni prodotto una volta) oppure `{ "productId", "quantity", "asset" }` (una riga) + `Idempotency-Key` | Il prezzo **non** si invia: lo calcola il server dal listino, riga per riga. Un ordine = un pagamento, qualunque sia il numero di righe; al massimo 1000 carte in tutto. Risposta con istruzioni di pagamento `{ to, amount, asset, memo, expiresAt }` |
| GET | `/api/orders/{id}` | — | Solo il proprietario |
| POST | `/api/orders/{id}/payment-hint` | `{ "txId" }` | 202 `{ order }`. Fa solo leggere prima lo storico dell'account shop (al massimo una volta ogni 3 s); il txId non viene mai creduto |
| POST | `/api/orders/{id}/cancel` | — | Solo da `CREATED`/`PAYMENT_PENDING` |
| GET | `/api/orders` | — | Storico ordini dell'utente (ultimi 50) |

**Ordine come lo vede il client:** `{ id, status, items: [{ productId, name, quantity, unitAmount }], total: { asset, amount }, payment: { network, from, to, asset, amount, memo, expiresAt } | null, rngEpochId, failureReason, createdAt, updatedAt }`; `payment` c'è solo finché l'ordine si può pagare. `GET /api/orders/{id}` aggiunge `fulfilment` per gli ordini evasi: `{ txId, cards: [{ id, definitionId, edition, serial, finish }], packs: [{ index, epoch, table, cards }] }`. Creare un ordine senza `Idempotency-Key` (16–64 caratteri) dà 428; la stessa chiave con un corpo diverso 409; più di 5 ordini non pagati 409 `LIMIT_REACHED`.

### Partite

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/api/games/{id}` | Metadati ed esito |
| GET | `/api/games?mine=1` | Storico partite |
| GET | `/api/games/live` | Partite in corso da guardare, prima le più seguite (pubblica; 10) |

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
| `game.session` | `{ "gameId", "key", "authorization" }` | v2: la chiave di sessione e la sua autorizzazione Keychain (12); risposta `game.session`. È anche l'accettazione della partita: si parte solo quando hanno firmato entrambi |
| `game.decline` | `{ "gameId" }` | v2, solo prima dell'avvio: il giocatore non firma (ha detto no a Keychain). Il server chiude la partita e manda `game.aborted` a entrambi; risposta `game.declined` (12) |
| `game.command` | `{ "gameId", "commandId": "<uuid>", "expectedVersion": 41, "command": { "type": "PLAY_CARD", "cardId": "c17", "targets": ["c3"] }, "signature"? }` | Il `playerId` non si invia: il server usa il posto dell'utente. In v2 `signature` è obbligatoria (12) |
| `game.sync` | `{ "gameId", "sinceSeq" }` | Recupero eventi persi o snapshot completo |
| `game.concede` | `{ "gameId", "commandId", "expectedVersion"?, "signature"? }` | Scorciatoia per `CONCEDE`; in v2 firmata come una mossa |
| `watch.start` | `{ "gameId" }` | Guarda una partita (una alla volta); risposta `watch.state` (10) |
| `watch.stop` | `{}` | Smette di guardare; risposta `watch.stopped` |

### 3.4 Server → client

| `t` | `d` |
|---|---|
| `welcome` | `{ "user", "serverTime", "activeGame": <vista della partita> \| null, "queue": { "state" }, "ackKey": "STM…" \| null }` (risposta a `hello`: chi rientra riceve subito lo stato completo della sua partita) |
| `queue.status` | `{ "state": "searching"\|"idle", "since", "estimatedWaitMs" }` |
| `match.found` | `{ "gameId", "seat", "opponent": { "account" }, "seedCommit": "<hex64>", "protocol": 1\|2, "entropyDeadline", "authorizeDeadline"? }` (`authorizeDeadline` solo in v2) |
| `game.joined` | `{ "gameId" }` (risposta a `game.entropy`) |
| `game.state` | la **vista della partita** (risposta a `game.sync`): `{ "gameId", "seat", "status", "opponent": { "account" }, "seedCommit", "entropyDeadline", "version", "lastSeq", "head", "snapshot": <snapshot per prospettiva> \| null, "clock": { "activeSeat", "deadline", "reserveMs": { "s0", "s1" } } }`; in v2 anche `"authorized": { "s0", "s1" }` (chi ha firmato) e `"authorizeDeadline"` (finché la partita aspetta). Prima dell'avvio arriva a entrambi dopo ogni firma |
| `game.events` | la vista della partita più `events`: gli eventi del motore redatti per prospettiva, per le animazioni. Il client **sostituisce** il proprio stato con lo snapshot ricevuto: non applica eventi e non ha mai un motore di una partita online |
| `game.ack` | `{ "commandId", "ok": true, "version", "head", "seq", "at", "key", "sig" }` (firmato, 11) oppure `{ "commandId", "ok": false, "error": { "code" } }` |
| `game.over` | `{ "gameId", "winner", "reason", "you" }` (l'URL di verifica arriva con M5) |
| `game.aborted` | `{ "gameId", "reason": "declined"\|"not_authorized", "seats": [...], "you" }`: v2, la partita è stata chiusa prima di iniziare perché i posti in `seats` non l'hanno accettata con Keychain (12). Nessun risultato |
| `watch.state`, `watch.events`, `watch.over` | la vista dello spettatore, gli aggiornamenti dopo ogni mossa, la fine (10) |
| `session.replaced` | `{}`: la connessione sta per essere chiusa (4000) perché l'utente si è connesso da un'altra scheda |
| `order.updated` | `{ "orderId", "status", "cards"?: [...] }` |
| `error` | `{ "code", "message" }` |

Codici d'errore del comando: quelli del motore (`NOT_YOUR_TURN`, `NOT_ALLOWED_IN_PHASE`, `INVALID_COMMAND`, …) più `STALE_VERSION`, `NOT_IN_GAME`, `GAME_NOT_ACTIVE`, `RATE_LIMITED` e, in v2, `SESSION_REQUIRED`, `INVALID_SIGNATURE`. Errori del canale: `BAD_MESSAGE` (envelope malformato; 10 volte → chiusura 4002), `UNKNOWN_MESSAGE`, `VALIDATION` (campi sconosciuti inclusi, come per HTTP). Ogni messaggio con `id` riceve una risposta.

**Implementazione (M4).** Gateway su `ws` 8.21.3 (versione fissata, nessuna dipendenza propria: Node non ha un server WebSocket incluso e un'implementazione verificata è più sicura di un parser RFC 6455 scritto a mano). La sessione viene riverificata ogni minuto: una sessione revocata chiude anche il socket (4001). La CSP della pagina elenca esplicitamente l'origine `ws(s)://` in `connect-src`.

### 3.5 Ordine, concorrenza e idempotenza

- **Un attore per partita**: i comandi di una partita sono eseguiti uno alla volta nell'ordine di arrivo alla mailbox. Due comandi simultanei dello stesso giocatore non possono entrambi passare: il secondo trova `expectedVersion` superata → `STALE_VERSION`.
- **`commandId`** univoco per partita (vincolo DB): un reinvio dopo una disconnessione restituisce lo stesso ack. Gli ack dei comandi accettati sono nel DB; quelli dei rifiutati solo in memoria (ultimi 64 per partita), così un client ostile non può riempire il DB di comandi rifiutati.
- `game.concede` viene eseguito dentro la mailbox dell'attore alla versione corrente: arrendersi non è mai "vecchio".
- **Eventi numerati** (`seq`): il client applica solo `fromSeq = lastSeq + 1`; se vede un buco chiede `game.sync`.

### 3.6 Riconnessione e disconnessione

- Il client si riconnette con `hello { resume }`: riceve `game.state` completo e riprende da lì (lo stato del client è sempre sostituibile, mai sorgente di verità).
- Alla disconnessione il turno continua a scorrere; dopo 60 s di assenza (configurabile) il server esegue `FORCED_MOVE` `END_TURN` ai suoi turni; dopo 3 turni consecutivi forzati o 3 minuti di assenza totale, `FORCED_MOVE` `CONCEDE` (`why: "abandon"`).
- Chi si disconnette esce dalla coda di matchmaking (non potrebbe vedere la partita iniziare).
- Al riavvio del server le partite non finite vengono ricostruite rigiocando le mosse salvate; i giocatori risultano assenti finché non si riconnettono.

### 3.7 Timer

- Timer di turno (es. 90 s) più riserva per giocatore (es. 90 s per partita), timer di risposta per i blocchi (60 s). Configurazione per modalità.
- Il client mostra un orologio col tempo restante della decisione corrente (`clock.deadline` in `game.state`/`game.events`), colorato più urgente sotto i 20/10 s; nessun timer nelle partite locali (in pratica, senza server).
- Allo scadere, il server esegue la mossa forzata minima (`END_PHASE`, blocchi vuoti) registrata come `FORCED_MOVE` con `why: "timeout"`.
- Prima dell'avvio: 15 s per l'entropia (poi la mette il server) e, in v2, 60 s per firmare con Keychain (`authorizeMs`; poi la partita viene chiusa, 12).
- I timer vivono nel `GameActor` (orologio iniettato → testabili con orologio finto).

### 3.8 Spettatori

Fatto in M7.2, vedi 10. La prospettiva è pubblica (`SPECTATOR`: nessuna mano, nessuna carta pescata) e **senza ritardo**: uno spettatore vede meno di ciascun giocatore, quindi non ha niente da passare a nessuno dei due. Il ritardo previsto qui all'inizio non serve; servirà solo per una eventuale modalità con le mani visibili. Il canale è `watch.start { gameId }`, sola lettura.
