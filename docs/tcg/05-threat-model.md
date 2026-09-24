# 05 — Threat model

**Stato:** proposta, 2026-09-24. Da rivedere a ogni milestone e prima dell'apertura pubblica.

## 1. Asset da proteggere

| Asset | Perché ha valore |
|---|---|
| Fondi ricevuti dall'account shop | denaro reale |
| Inventario degli utenti (copie, serial, foil) | valore economico, soprattutto con trading futuro |
| Integrità delle partite e delle classifiche | reputazione, ricompense, tornei |
| Casualità di pacchetti e mescolamenti | equità percepita e reale; base legale delle probabilità pubblicate |
| Sessioni e identità degli utenti | accesso a inventario e ordini |
| Chiavi degli account del gioco (broadcaster, root) | attribuzione pubblica della storia on-chain |
| Segreti di partita e di epoca | conoscere le carte nascoste / i pacchetti futuri |

## 2. Attori ostili

- **Giocatore con client modificato** (DevTools, proxy, bot): il caso normale, non l'eccezione.
- **Utente che cerca di ottenere carte o ordini senza pagare** (replay, sostituzione di transazioni, race condition).
- **Sito terzo** che tenta CSRF, WebSocket hijacking, phishing di firme Keychain.
- **Chiunque sulla catena** (può pubblicare `custom_json` con i nostri id).
- **Coppie di account colluse** (farming di vittorie in classificata).
- **Nodo RPC malevolo o compromesso** (risposte false su transazioni e saldi).
- **Insider / compromissione del server** (lettura del DB, furto di chiavi).

## 3. Confini di fiducia

```
Browser (non fidato) ── HTTPS/WSS ──► API + Game server (fidato) ──► PostgreSQL (fidato)
      │                                   │
      └─ Keychain (fidato dall'utente)    ├── RPC STEEM (parzialmente fidato: più nodi, conferme)
                                          └── Chiave posting broadcaster (sul server, senza fondi)
Account shop: nessuna chiave sul server.  Account root: chiave active solo offline/Keychain dell'operatore.
```

## 4. Minacce e contromisure

| # | Minaccia | Esempio concreto | Contromisure | Test |
|---|---|---|---|---|
| T1 | **Client modificato / comandi falsi** | invia `PLAY_CARD` di una carta non in mano o fuori turno | Il motore valida forma e regole di ogni comando; il server sovrascrive `playerId` con il posto dell'utente autenticato; nessuna logica di regola nel client | test del motore (fuzz esistente), test `GameActor` con comandi ostili |
| T2 | **Ownership spoofing** | modifica il `deckId` o i `definitionId` per giocare carte che non possiede | Deck validato server-side contro `collections` all'ingresso in coda e congelato in `game_players.deck_snapshot`; gli endpoint filtrano sempre per `owner_id = utente della sessione` | test `DeckService` (possesso), test di autorizzazione per ogni endpoint |
| T3 | **Manipolazione dei prezzi** | `POST /orders { price: 0.001 }` | Il client non invia prezzi: il server li legge dal listino e li congela in `order_items.unit_amount`; campi sconosciuti → 400 | test `MarketplaceService` |
| T4 | **Acquisti duplicati** | doppio click, retry di rete | `Idempotency-Key` obbligatoria, `UNIQUE (user_id, idempotency_key)`, `request_hash` | test di idempotenza e concorrenza |
| T5 | **Replay di un pagamento** | usa la stessa transazione per due ordini | `payments UNIQUE (network, tx_id, op_index)`; il pagamento è legato a un solo ordine tramite memo | test `PaymentVerifier` |
| T6 | **Sostituzione della transazione** | fornisce come `payment-hint` il txId di un altro utente o di un altro importo | Il suggerimento non è creduto: si verificano on-chain mittente = account dell'utente dell'ordine, destinatario = shop, asset, importo esatto, memo esatto, blocco irreversibile | test `PaymentVerifier` (ogni campo errato) |
| T7 | **Double spending logico / race** | due worker verificano lo stesso pagamento; pagamento arriva mentre l'ordine scade | Transizioni CAS; unico pagamento `APPLIED` per ordine (indice unico); pagamento tardivo → `REFUND_REQUIRED` | test di concorrenza sulla macchina a stati |
| T8 | **Pagamento revertito** | la tx finisce in un blocco poi scartato da un micro-fork | Fulfilment solo dopo il blocco irreversibile | test con provider finto che "perde" la tx |
| T9 | **Duplicazione di carte** | ripetere il fulfilment, race sul serial | Conio solo dentro la transazione `PAYMENT_VERIFIED → FULFILLED`; serial da contatore con lock; chiave di origine univoca; nessun endpoint di conio | test `InventoryService` concorrente |
| T10 | **Manipolazione dello stato di partita** | modificare lo snapshot nel client | Il client riceve solo proiezioni; lo stato del client viene sostituito a ogni `game.state` | — |
| T11 | **Informazioni nascoste** | leggere la mano avversaria dai messaggi | Snapshot per prospettiva e redazione degli eventi (già nel motore); checkpoint salati; seed segreto fino alla fine; mazzo avversario solo come impegno | test di redazione |
| T12 | **Predizione del RNG** | brute-force del seed a 32 bit (vedi 00, E1) | ChaCha20 con chiave 256 bit; seed da commit-reveal con entropia dei giocatori | test del generatore (vettori RFC 8439), test commit-reveal |
| T13 | **Abuso del WebSocket** | flood di messaggi, messaggi enormi, mille connessioni | Autenticazione all'upgrade, controllo `Origin`, limite dimensione, token bucket, una connessione per utente, timeout di heartbeat, backpressure sui buffer in uscita | test del gateway WS |
| T14 | **Cross-site WebSocket hijacking / CSRF** | pagina malevola apre `wss://…/ws` con i cookie dell'utente | allowlist `Origin` sull'upgrade; `SameSite=Strict`; header custom sulle richieste mutanti | test HTTP/WS |
| T15 | **Richieste fuori sequenza** | comando con versione vecchia, eventi saltati | `expectedVersion` (→ `STALE_VERSION`), sequenze contigue, `game.sync` | test `GameActor` |
| T16 | **Replay del login** | riusa una firma catturata | Nonce del server, monouso (consumato con CAS anche se la verifica fallisce), scadenza 120 s, messaggio legato a origine e account | test `AuthService` |
| T17 | **Phishing della firma** | un sito chiede di firmare il nostro messaggio di login | Il messaggio include l'origine: Keychain lo mostra all'utente; il server accetta solo challenge emessi da lui e per l'origine attesa. Rischio residuo documentato (l'utente deve leggere cosa firma). | — |
| T18 | **Chiave posting dell'utente cambiata** (compromessa e ruotata) | sessioni aperte con la chiave vecchia | `sessions.login_public_key`; job che revoca le sessioni se la chiave non è più nell'autorità posting | test del job |
| T19 | **Eventi blockchain falsificati** | un terzo pubblica `m8tcg_game` | Verificatore: solo firmatari autorizzati dal manifest; hash concatenati; riconciliatore segnala record sconosciuti | test del verificatore |
| T20 | **Desincronizzazione DB/blockchain** | tx scadute, micro-fork, record duplicati | Outbox immutabile, stati di ancoraggio, riconciliatore (03 §16) | test del riconciliatore con catena finta |
| T21 | **Nodo RPC bugiardo** | risponde che una tx di pagamento esiste | Per le decisioni di pagamento si interrogano almeno 2 nodi indipendenti e si richiede concordanza; validazione stretta delle risposte | test `SteemRpcClient` con nodi discordanti |
| T22 | **Compromissione della chiave del broadcaster** | un attaccante pubblica record falsi | La chiave ha solo autorità posting, nessun fondo; il riconciliatore rileva operazioni sconosciute; revoca via manifest firmato dalla root | runbook |
| T23 | **Compromissione del server** | furto del DB | Nessuna chiave dello shop sul server; token di sessione solo come hash; segreti cifrati con chiave fuori DB; audit log con catena di hash | — |
| T24 | **Collusione in classificata** | due account propri che si passano vittorie | Ricompense senza valore di mercato nella v1; rilevamento statistico (stesse coppie, concessioni rapide) nella milestone 7 | — |
| T25 | **Injection** | SQL, JSON prototype pollution, XSS nel canvas | Solo query parametrizzate; parser JSON con controllo di chiavi (`__proto__`, `constructor`) e limiti di profondità; il client disegna su canvas senza `innerHTML` (test di architettura esistente) | test di validazione |
| T26 | **Denial of service applicativo** | challenge di login a raffica, ordini a raffica | Rate limit per IP/utente, limiti di ordini aperti per utente, scadenza e pulizia dei challenge | test rate limiter |

## 5. Rischi residui accettati (v1)

1. Il server conosce le carte nascoste durante la partita (ipotesi di fiducia dichiarata, 03 §5).
2. Le mosse on-chain sono firmate dal broadcaster, non dai giocatori, fino alla v2 del protocollo (03 §18).
3. Un utente che firma messaggi senza leggerli può essere vittima di phishing: mitigato, non eliminato.
4. La conformità normativa della vendita di pacchetti casuali per criptovaluta va verificata con un professionista (00 §4.7).

## 6. Obiettivi di qualità statica

SonarQube: 0 bug, 0 vulnerabilità, 0 security hotspot non rivisti, duplicazione < 3 %, copertura ≥ 85 % su `engine`, `protocol`, `steem` e moduli di dominio del server. ESLint allineato alle regole Sonar (già configurato nel fork) più `no-restricted-syntax` per vietare `parseFloat` sugli importi e `JSON.parse` fuori dal parser sicuro nel server.
